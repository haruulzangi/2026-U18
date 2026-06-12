mod attestation;
mod error;
mod flag;

use crate::state::AppState;
use axum::{
    body::{to_bytes, Body},
    extract::State,
    http::{header::USER_AGENT, HeaderMap, Method, Request, StatusCode},
    routing::{any, get},
    Router,
};
use error::{ApiError, ApiResult};
use flag::{retrieve_encrypted_flag, EncryptedFlagResponse, FlagHandshakeRequest};

pub(crate) const MAX_BODY_BYTES: usize = 64 * 1024;

pub(crate) fn app(state: AppState) -> Router {
    Router::new()
        .route("/api/flag", any(flag_endpoint))
        .route("/healthz", get(healthz))
        .fallback(not_found)
        .with_state(state)
}

async fn healthz() -> &'static str {
    "ok"
}

async fn not_found() -> ApiError {
    ApiError {
        status: StatusCode::NOT_FOUND,
        error: "not found".to_string(),
    }
}

async fn flag_endpoint(
    State(state): State<AppState>,
    method: Method,
    request: Request<Body>,
) -> ApiResult<EncryptedFlagResponse> {
    if method != Method::POST {
        return Err(ApiError::method_not_allowed());
    }

    let user_agent = okhttp_user_agent(request.headers())
        .ok_or_else(ApiError::untrusted_client)?
        .to_owned();

    let body = to_bytes(request.into_body(), MAX_BODY_BYTES)
        .await
        .map_err(|_| ApiError::bad_request("invalid request body"))?;
    let request = serde_json::from_slice::<FlagHandshakeRequest>(&body)
        .map_err(|_| ApiError::bad_request("invalid request body"))?;

    retrieve_encrypted_flag(&state, request, &user_agent)
}

fn okhttp_user_agent(headers: &HeaderMap) -> Option<&str> {
    headers
        .get(USER_AGENT)
        .and_then(|value| value.to_str().ok())
        .filter(|user_agent| {
            user_agent.len() > "okhttp/".len()
                && user_agent
                    .get(.."okhttp/".len())
                    .is_some_and(|prefix| prefix.eq_ignore_ascii_case("okhttp/"))
        })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::{DEFAULT_EXPECTED_APP_CERTIFICATE_DIGEST, DEFAULT_FLAG_TEMPLATE};
    use aes_gcm::{
        aead::{Aead, KeyInit, Payload},
        Aes256Gcm, Nonce,
    };
    use axum::{body::to_bytes, http::StatusCode};
    use base64::{engine::general_purpose::STANDARD, Engine};
    use error::{ApiError, ErrorResponse};
    use flag::{cbor_byte_string_32, public_key_fingerprint};
    use rcgen::{
        BasicConstraints, CertificateParams, CustomExtension, DnType, IsCa, Issuer, KeyPair,
        KeyUsagePurpose, SubjectPublicKeyInfo,
    };
    use rsa::{pkcs8::EncodePublicKey, Oaep, RsaPrivateKey};
    use serde_json::json;
    use sha2::Sha256;
    use std::sync::Arc;
    use tower::ServiceExt;

    const TEST_ROOT_KEY_PEM: &str = "-----BEGIN PRIVATE KEY-----\n\
MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgzgAK2eqtiq4gE9Eg\n\
S8Vdk8ZCWoaYp+f1XmKafduNEnahRANCAAR8QOtMvTag3SVN6mXBsCcC0UrG6zNq\n\
nmSz+C7DnpYkt4kONo2xepZcYMWWQJ9faHaDhPYGkt7Q9jDMdO6+AMv1\n\
-----END PRIVATE KEY-----\n";

    #[tokio::test]
    async fn encrypts_fingerprint_derived_flag_for_valid_handshake() {
        let mut rng = rand::rngs::OsRng;
        let private_key = RsaPrivateKey::new(&mut rng, 2048).unwrap();
        let public_key_der = private_key
            .to_public_key()
            .to_public_key_der()
            .unwrap()
            .as_bytes()
            .to_vec();
        let client_nonce = [7u8; flag::CLIENT_NONCE_BYTES];

        let app = app(AppState {
            flag_template: Arc::from("HZU18{vault_$fingerprint}"),
            expected_app_certificate_digest: Arc::from(DEFAULT_EXPECTED_APP_CERTIFICATE_DIGEST),
            unsafe_disable_device_safety_checks: false,
        });
        let body = json!({
            "clientNonce": STANDARD.encode(client_nonce),
            "publicKey": STANDARD.encode(&public_key_der),
            "attestationCertificates": attestation_certificates(&public_key_der, &client_nonce),
        });

        let response = app
            .oneshot(
                Request::builder()
                    .method(Method::POST)
                    .uri("/api/flag")
                    .header("content-type", "application/json")
                    .header("user-agent", "okhttp/4.12.0")
                    .body(Body::from(body.to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
        let bytes = to_bytes(response.into_body(), MAX_BODY_BYTES)
            .await
            .unwrap();
        let response: EncryptedFlagResponse = serde_json::from_slice(&bytes).unwrap();

        let encrypted_session_key = STANDARD.decode(response.encrypted_session_key).unwrap();
        let session_key = private_key
            .decrypt(Oaep::new::<Sha256>(), &encrypted_session_key)
            .unwrap();
        let iv = STANDARD.decode(response.flag_iv).unwrap();
        let aad = STANDARD.decode(response.aad).unwrap();
        let encrypted_flag = STANDARD.decode(response.encrypted_flag).unwrap();

        assert_eq!(aad, cbor_byte_string_32(&client_nonce));
        let cipher = Aes256Gcm::new_from_slice(&session_key).unwrap();
        let plaintext = cipher
            .decrypt(
                Nonce::from_slice(&iv),
                Payload {
                    msg: &encrypted_flag,
                    aad: &aad,
                },
            )
            .unwrap();

        let expected_flag = format!("HZU18{{vault_{}}}", public_key_fingerprint(&public_key_der));
        assert_eq!(String::from_utf8(plaintext).unwrap(), expected_flag);
    }

    #[tokio::test]
    async fn rejects_non_post_with_json_405() {
        let app = app(AppState {
            flag_template: Arc::from(DEFAULT_FLAG_TEMPLATE),
            expected_app_certificate_digest: Arc::from(DEFAULT_EXPECTED_APP_CERTIFICATE_DIGEST),
            unsafe_disable_device_safety_checks: false,
        });

        let response = app
            .oneshot(
                Request::builder()
                    .method(Method::GET)
                    .uri("/api/flag")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::METHOD_NOT_ALLOWED);
        let bytes = to_bytes(response.into_body(), MAX_BODY_BYTES)
            .await
            .unwrap();
        let error: ErrorResponse = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(error.error, ApiError::method_not_allowed().error);
    }

    #[tokio::test]
    async fn rejects_missing_okhttp_user_agent() {
        let app = app(AppState {
            flag_template: Arc::from(DEFAULT_FLAG_TEMPLATE),
            expected_app_certificate_digest: Arc::from(DEFAULT_EXPECTED_APP_CERTIFICATE_DIGEST),
            unsafe_disable_device_safety_checks: false,
        });

        let response = app
            .oneshot(
                Request::builder()
                    .method(Method::POST)
                    .uri("/api/flag")
                    .header("content-type", "application/json")
                    .body(Body::from("{}"))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::FORBIDDEN);
        let bytes = to_bytes(response.into_body(), MAX_BODY_BYTES)
            .await
            .unwrap();
        let error: ErrorResponse = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(error.error, ApiError::untrusted_client().error);
    }

    #[tokio::test]
    async fn rejects_non_okhttp_user_agent() {
        let app = app(AppState {
            flag_template: Arc::from(DEFAULT_FLAG_TEMPLATE),
            expected_app_certificate_digest: Arc::from(DEFAULT_EXPECTED_APP_CERTIFICATE_DIGEST),
            unsafe_disable_device_safety_checks: false,
        });

        let response = app
            .oneshot(
                Request::builder()
                    .method(Method::POST)
                    .uri("/api/flag")
                    .header("content-type", "application/json")
                    .header("user-agent", "curl/8.0.0")
                    .body(Body::from("{}"))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::FORBIDDEN);
        let bytes = to_bytes(response.into_body(), MAX_BODY_BYTES)
            .await
            .unwrap();
        let error: ErrorResponse = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(error.error, ApiError::untrusted_client().error);
    }

    #[tokio::test]
    async fn rejects_bad_nonce_length() {
        let mut rng = rand::rngs::OsRng;
        let private_key = RsaPrivateKey::new(&mut rng, 2048).unwrap();
        let public_key_der = private_key
            .to_public_key()
            .to_public_key_der()
            .unwrap()
            .as_bytes()
            .to_vec();

        let app = app(AppState {
            flag_template: Arc::from(DEFAULT_FLAG_TEMPLATE),
            expected_app_certificate_digest: Arc::from(DEFAULT_EXPECTED_APP_CERTIFICATE_DIGEST),
            unsafe_disable_device_safety_checks: false,
        });
        let body = json!({
            "clientNonce": STANDARD.encode([1u8; 31]),
            "publicKey": STANDARD.encode(public_key_der),
        });

        let response = app
            .oneshot(
                Request::builder()
                    .method(Method::POST)
                    .uri("/api/flag")
                    .header("content-type", "application/json")
                    .header("user-agent", "okhttp/4.12.0")
                    .body(Body::from(body.to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::FORBIDDEN);
        let bytes = to_bytes(response.into_body(), MAX_BODY_BYTES)
            .await
            .unwrap();
        let error: ErrorResponse = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(error.error, ApiError::untrusted_client().error);
    }

    #[tokio::test]
    async fn rejects_small_rsa_public_key() {
        let mut rng = rand::rngs::OsRng;
        let private_key = RsaPrivateKey::new(&mut rng, 1024).unwrap();
        let public_key_der = private_key
            .to_public_key()
            .to_public_key_der()
            .unwrap()
            .as_bytes()
            .to_vec();
        let client_nonce = [2u8; flag::CLIENT_NONCE_BYTES];

        let app = app(AppState {
            flag_template: Arc::from(DEFAULT_FLAG_TEMPLATE),
            expected_app_certificate_digest: Arc::from(DEFAULT_EXPECTED_APP_CERTIFICATE_DIGEST),
            unsafe_disable_device_safety_checks: false,
        });
        let body = json!({
            "clientNonce": STANDARD.encode(client_nonce),
            "publicKey": STANDARD.encode(&public_key_der),
            "attestationCertificates": attestation_certificates(&public_key_der, &client_nonce),
        });

        let response = app
            .oneshot(
                Request::builder()
                    .method(Method::POST)
                    .uri("/api/flag")
                    .header("content-type", "application/json")
                    .header("user-agent", "okhttp/4.12.0")
                    .body(Body::from(body.to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::FORBIDDEN);
        let bytes = to_bytes(response.into_body(), MAX_BODY_BYTES)
            .await
            .unwrap();
        let error: ErrorResponse = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(error.error, ApiError::untrusted_client().error);
    }

    #[tokio::test]
    async fn rejects_missing_client_nonce_with_400() {
        let mut rng = rand::rngs::OsRng;
        let private_key = RsaPrivateKey::new(&mut rng, 2048).unwrap();
        let public_key_der = private_key
            .to_public_key()
            .to_public_key_der()
            .unwrap()
            .as_bytes()
            .to_vec();

        let app = app(AppState {
            flag_template: Arc::from(DEFAULT_FLAG_TEMPLATE),
            expected_app_certificate_digest: Arc::from(DEFAULT_EXPECTED_APP_CERTIFICATE_DIGEST),
            unsafe_disable_device_safety_checks: false,
        });
        let body = json!({
            "publicKey": STANDARD.encode(&public_key_der),
            "attestationCertificates": attestation_certificates(&public_key_der, &[1u8; flag::CLIENT_NONCE_BYTES]),
        });

        let response = app
            .oneshot(
                Request::builder()
                    .method(Method::POST)
                    .uri("/api/flag")
                    .header("content-type", "application/json")
                    .header("user-agent", "okhttp/4.12.0")
                    .body(Body::from(body.to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
        let bytes = to_bytes(response.into_body(), MAX_BODY_BYTES)
            .await
            .unwrap();
        let error: ErrorResponse = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(
            error.error,
            ApiError::bad_request("invalid request body").error
        );
    }

    #[tokio::test]
    async fn rejects_missing_public_key_with_400() {
        let app = app(AppState {
            flag_template: Arc::from(DEFAULT_FLAG_TEMPLATE),
            expected_app_certificate_digest: Arc::from(DEFAULT_EXPECTED_APP_CERTIFICATE_DIGEST),
            unsafe_disable_device_safety_checks: false,
        });
        let body = json!({
            "clientNonce": STANDARD.encode([1u8; flag::CLIENT_NONCE_BYTES]),
            "attestationCertificates": [STANDARD.encode([1u8; 3])],
        });

        let response = app
            .oneshot(
                Request::builder()
                    .method(Method::POST)
                    .uri("/api/flag")
                    .header("content-type", "application/json")
                    .header("user-agent", "okhttp/4.12.0")
                    .body(Body::from(body.to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
        let bytes = to_bytes(response.into_body(), MAX_BODY_BYTES)
            .await
            .unwrap();
        let error: ErrorResponse = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(
            error.error,
            ApiError::bad_request("invalid request body").error
        );
    }

    #[tokio::test]
    async fn rejects_missing_attestation_certificates_with_400() {
        let mut rng = rand::rngs::OsRng;
        let private_key = RsaPrivateKey::new(&mut rng, 2048).unwrap();
        let public_key_der = private_key
            .to_public_key()
            .to_public_key_der()
            .unwrap()
            .as_bytes()
            .to_vec();

        let app = app(AppState {
            flag_template: Arc::from(DEFAULT_FLAG_TEMPLATE),
            expected_app_certificate_digest: Arc::from(DEFAULT_EXPECTED_APP_CERTIFICATE_DIGEST),
            unsafe_disable_device_safety_checks: false,
        });
        let body = json!({
            "clientNonce": STANDARD.encode([1u8; flag::CLIENT_NONCE_BYTES]),
            "publicKey": STANDARD.encode(public_key_der),
        });

        let response = app
            .oneshot(
                Request::builder()
                    .method(Method::POST)
                    .uri("/api/flag")
                    .header("content-type", "application/json")
                    .header("user-agent", "okhttp/4.12.0")
                    .body(Body::from(body.to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
        let bytes = to_bytes(response.into_body(), MAX_BODY_BYTES)
            .await
            .unwrap();
        let error: ErrorResponse = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(
            error.error,
            ApiError::bad_request("invalid request body").error
        );
    }

    #[tokio::test]
    async fn rejects_empty_attestation_certificates_with_untrusted_client() {
        let mut rng = rand::rngs::OsRng;
        let private_key = RsaPrivateKey::new(&mut rng, 2048).unwrap();
        let public_key_der = private_key
            .to_public_key()
            .to_public_key_der()
            .unwrap()
            .as_bytes()
            .to_vec();

        let app = app(AppState {
            flag_template: Arc::from(DEFAULT_FLAG_TEMPLATE),
            expected_app_certificate_digest: Arc::from(DEFAULT_EXPECTED_APP_CERTIFICATE_DIGEST),
            unsafe_disable_device_safety_checks: false,
        });
        let body = json!({
            "clientNonce": STANDARD.encode([1u8; flag::CLIENT_NONCE_BYTES]),
            "publicKey": STANDARD.encode(public_key_der),
            "attestationCertificates": [],
        });

        let response = app
            .oneshot(
                Request::builder()
                    .method(Method::POST)
                    .uri("/api/flag")
                    .header("content-type", "application/json")
                    .header("user-agent", "okhttp/4.12.0")
                    .body(Body::from(body.to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::FORBIDDEN);
        let bytes = to_bytes(response.into_body(), MAX_BODY_BYTES)
            .await
            .unwrap();
        let error: ErrorResponse = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(error.error, ApiError::untrusted_client().error);
    }

    #[tokio::test]
    async fn rejects_invalid_attestation_certificate_with_403() {
        let mut rng = rand::rngs::OsRng;
        let private_key = RsaPrivateKey::new(&mut rng, 2048).unwrap();
        let public_key_der = private_key
            .to_public_key()
            .to_public_key_der()
            .unwrap()
            .as_bytes()
            .to_vec();

        let app = app(AppState {
            flag_template: Arc::from(DEFAULT_FLAG_TEMPLATE),
            expected_app_certificate_digest: Arc::from(DEFAULT_EXPECTED_APP_CERTIFICATE_DIGEST),
            unsafe_disable_device_safety_checks: false,
        });
        let body = json!({
            "clientNonce": STANDARD.encode([1u8; flag::CLIENT_NONCE_BYTES]),
            "publicKey": STANDARD.encode(public_key_der),
            "attestationCertificates": [STANDARD.encode([1u8; 3])],
        });

        let response = app
            .oneshot(
                Request::builder()
                    .method(Method::POST)
                    .uri("/api/flag")
                    .header("content-type", "application/json")
                    .header("user-agent", "okhttp/4.12.0")
                    .body(Body::from(body.to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::FORBIDDEN);
    }

    #[tokio::test]
    async fn rejects_attestation_certificate_with_invalid_chain_signature() {
        let mut rng = rand::rngs::OsRng;
        let private_key = RsaPrivateKey::new(&mut rng, 2048).unwrap();
        let public_key_der = private_key
            .to_public_key()
            .to_public_key_der()
            .unwrap()
            .as_bytes()
            .to_vec();
        let client_nonce = [4u8; flag::CLIENT_NONCE_BYTES];
        let mut chain = test_attestation_chain(
            &public_key_der,
            attestation::test_key_description(&client_nonce),
        );
        let leaf_signature_byte = chain[0].last_mut().unwrap();
        *leaf_signature_byte ^= 1;

        let app = app(AppState {
            flag_template: Arc::from(DEFAULT_FLAG_TEMPLATE),
            expected_app_certificate_digest: Arc::from(DEFAULT_EXPECTED_APP_CERTIFICATE_DIGEST),
            unsafe_disable_device_safety_checks: false,
        });
        let body = json!({
            "clientNonce": STANDARD.encode(client_nonce),
            "publicKey": STANDARD.encode(&public_key_der),
            "attestationCertificates": chain
                .into_iter()
                .map(|certificate| STANDARD.encode(certificate))
                .collect::<Vec<_>>(),
        });

        let response = app
            .oneshot(
                Request::builder()
                    .method(Method::POST)
                    .uri("/api/flag")
                    .header("content-type", "application/json")
                    .header("user-agent", "okhttp/4.12.0")
                    .body(Body::from(body.to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::FORBIDDEN);
    }

    #[tokio::test]
    async fn rejects_attestation_challenge_mismatch() {
        let mut rng = rand::rngs::OsRng;
        let private_key = RsaPrivateKey::new(&mut rng, 2048).unwrap();
        let public_key_der = private_key
            .to_public_key()
            .to_public_key_der()
            .unwrap()
            .as_bytes()
            .to_vec();
        let client_nonce = [5u8; flag::CLIENT_NONCE_BYTES];
        let attestation_nonce = [6u8; flag::CLIENT_NONCE_BYTES];

        let app = app(AppState {
            flag_template: Arc::from(DEFAULT_FLAG_TEMPLATE),
            expected_app_certificate_digest: Arc::from(DEFAULT_EXPECTED_APP_CERTIFICATE_DIGEST),
            unsafe_disable_device_safety_checks: false,
        });
        let body = json!({
            "clientNonce": STANDARD.encode(client_nonce),
            "publicKey": STANDARD.encode(&public_key_der),
            "attestationCertificates": attestation_certificates(&public_key_der, &attestation_nonce),
        });

        let response = app
            .oneshot(
                Request::builder()
                    .method(Method::POST)
                    .uri("/api/flag")
                    .header("content-type", "application/json")
                    .header("user-agent", "okhttp/4.12.0")
                    .body(Body::from(body.to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::FORBIDDEN);
    }

    #[tokio::test]
    async fn rejects_unsafe_device_attestations() {
        let unsafe_key_descriptions: [fn(&[u8]) -> Vec<u8>; 5] = [
            attestation::test_key_description_without_root_of_trust,
            attestation::test_key_description_with_unlocked_device,
            attestation::test_key_description_with_unverified_boot_state,
            attestation::test_key_description_with_zero_verified_boot_key,
            attestation::test_key_description_with_zero_verified_boot_hash,
        ];

        for key_description in unsafe_key_descriptions {
            let mut rng = rand::rngs::OsRng;
            let private_key = RsaPrivateKey::new(&mut rng, 2048).unwrap();
            let public_key_der = private_key
                .to_public_key()
                .to_public_key_der()
                .unwrap()
                .as_bytes()
                .to_vec();
            let client_nonce = [12u8; flag::CLIENT_NONCE_BYTES];

            let app = app(AppState {
                flag_template: Arc::from(DEFAULT_FLAG_TEMPLATE),
                expected_app_certificate_digest: Arc::from(DEFAULT_EXPECTED_APP_CERTIFICATE_DIGEST),
                unsafe_disable_device_safety_checks: false,
            });
            let body = json!({
                "clientNonce": STANDARD.encode(client_nonce),
                "publicKey": STANDARD.encode(&public_key_der),
                "attestationCertificates": test_attestation_chain(
                    &public_key_der,
                    key_description(&client_nonce),
                )
                .into_iter()
                .map(|certificate| STANDARD.encode(certificate))
                .collect::<Vec<_>>(),
            });

            let response = app
                .oneshot(
                    Request::builder()
                        .method(Method::POST)
                        .uri("/api/flag")
                        .header("content-type", "application/json")
                        .header("user-agent", "okhttp/4.12.0")
                        .body(Body::from(body.to_string()))
                        .unwrap(),
                )
                .await
                .unwrap();

            assert_eq!(response.status(), StatusCode::FORBIDDEN);
        }
    }

    #[tokio::test]
    async fn allows_unsafe_device_attestation_when_device_safety_checks_disabled() {
        let mut rng = rand::rngs::OsRng;
        let private_key = RsaPrivateKey::new(&mut rng, 2048).unwrap();
        let public_key_der = private_key
            .to_public_key()
            .to_public_key_der()
            .unwrap()
            .as_bytes()
            .to_vec();
        let client_nonce = [13u8; flag::CLIENT_NONCE_BYTES];

        let app = app(AppState {
            flag_template: Arc::from(DEFAULT_FLAG_TEMPLATE),
            expected_app_certificate_digest: Arc::from(DEFAULT_EXPECTED_APP_CERTIFICATE_DIGEST),
            unsafe_disable_device_safety_checks: true,
        });
        let body = json!({
            "clientNonce": STANDARD.encode(client_nonce),
            "publicKey": STANDARD.encode(&public_key_der),
            "attestationCertificates": test_attestation_chain(
                &public_key_der,
                attestation::test_key_description_without_root_of_trust(&client_nonce),
            )
            .into_iter()
            .map(|certificate| STANDARD.encode(certificate))
            .collect::<Vec<_>>(),
        });

        let response = app
            .oneshot(
                Request::builder()
                    .method(Method::POST)
                    .uri("/api/flag")
                    .header("content-type", "application/json")
                    .header("user-agent", "okhttp/4.12.0")
                    .body(Body::from(body.to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn rejects_missing_attestation_application_id() {
        let mut rng = rand::rngs::OsRng;
        let private_key = RsaPrivateKey::new(&mut rng, 2048).unwrap();
        let public_key_der = private_key
            .to_public_key()
            .to_public_key_der()
            .unwrap()
            .as_bytes()
            .to_vec();
        let client_nonce = [8u8; flag::CLIENT_NONCE_BYTES];

        let app = app(AppState {
            flag_template: Arc::from(DEFAULT_FLAG_TEMPLATE),
            expected_app_certificate_digest: Arc::from(DEFAULT_EXPECTED_APP_CERTIFICATE_DIGEST),
            unsafe_disable_device_safety_checks: false,
        });
        let body = json!({
            "clientNonce": STANDARD.encode(client_nonce),
            "publicKey": STANDARD.encode(&public_key_der),
            "attestationCertificates": attestation_certificates_without_application_id(&public_key_der, &client_nonce),
        });

        let response = app
            .oneshot(
                Request::builder()
                    .method(Method::POST)
                    .uri("/api/flag")
                    .header("content-type", "application/json")
                    .header("user-agent", "okhttp/4.12.0")
                    .body(Body::from(body.to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::FORBIDDEN);
    }

    #[tokio::test]
    async fn rejects_attestation_signature_digest_mismatch() {
        let mut rng = rand::rngs::OsRng;
        let private_key = RsaPrivateKey::new(&mut rng, 2048).unwrap();
        let public_key_der = private_key
            .to_public_key()
            .to_public_key_der()
            .unwrap()
            .as_bytes()
            .to_vec();
        let client_nonce = [9u8; flag::CLIENT_NONCE_BYTES];

        let app = app(AppState {
            flag_template: Arc::from(DEFAULT_FLAG_TEMPLATE),
            expected_app_certificate_digest: Arc::from(DEFAULT_EXPECTED_APP_CERTIFICATE_DIGEST),
            unsafe_disable_device_safety_checks: false,
        });
        let body = json!({
            "clientNonce": STANDARD.encode(client_nonce),
            "publicKey": STANDARD.encode(&public_key_der),
            "attestationCertificates": attestation_certificates_with_wrong_signature_digest(&public_key_der, &client_nonce),
        });

        let response = app
            .oneshot(
                Request::builder()
                    .method(Method::POST)
                    .uri("/api/flag")
                    .header("content-type", "application/json")
                    .header("user-agent", "okhttp/4.12.0")
                    .body(Body::from(body.to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::FORBIDDEN);
    }

    #[tokio::test]
    async fn rejects_mixed_attestation_application_id_identity() {
        let mut rng = rand::rngs::OsRng;
        let private_key = RsaPrivateKey::new(&mut rng, 2048).unwrap();
        let public_key_der = private_key
            .to_public_key()
            .to_public_key_der()
            .unwrap()
            .as_bytes()
            .to_vec();
        let client_nonce = [14u8; flag::CLIENT_NONCE_BYTES];

        let app = app(AppState {
            flag_template: Arc::from(DEFAULT_FLAG_TEMPLATE),
            expected_app_certificate_digest: Arc::from(DEFAULT_EXPECTED_APP_CERTIFICATE_DIGEST),
            unsafe_disable_device_safety_checks: false,
        });
        let body = json!({
            "clientNonce": STANDARD.encode(client_nonce),
            "publicKey": STANDARD.encode(&public_key_der),
            "attestationCertificates": attestation_certificates_with_mixed_application_id(&public_key_der, &client_nonce),
        });

        let response = app
            .oneshot(
                Request::builder()
                    .method(Method::POST)
                    .uri("/api/flag")
                    .header("content-type", "application/json")
                    .header("user-agent", "okhttp/4.12.0")
                    .body(Body::from(body.to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::FORBIDDEN);
    }

    #[tokio::test]
    async fn allows_configured_attestation_signature_digest() {
        let mut rng = rand::rngs::OsRng;
        let private_key = RsaPrivateKey::new(&mut rng, 2048).unwrap();
        let public_key_der = private_key
            .to_public_key()
            .to_public_key_der()
            .unwrap()
            .as_bytes()
            .to_vec();
        let client_nonce = [11u8; flag::CLIENT_NONCE_BYTES];

        let app = app(AppState {
            flag_template: Arc::from(DEFAULT_FLAG_TEMPLATE),
            expected_app_certificate_digest: Arc::from(
                "4A:66:9A:88:63:1A:4F:FD:98:30:20:D7:0A:B0:65:98:A0:94:1B:A1:BA:23:DE:87:CD:7B:55:83:E3:D5:B6:17",
            ),
            unsafe_disable_device_safety_checks: false,
        });
        let body = json!({
            "clientNonce": STANDARD.encode(client_nonce),
            "publicKey": STANDARD.encode(&public_key_der),
            "attestationCertificates": attestation_certificates_with_wrong_signature_digest(&public_key_der, &client_nonce),
        });

        let response = app
            .oneshot(
                Request::builder()
                    .method(Method::POST)
                    .uri("/api/flag")
                    .header("content-type", "application/json")
                    .header("user-agent", "okhttp/4.12.0")
                    .body(Body::from(body.to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn allows_attestation_signature_digest_mismatch_when_wildcard_digest_expected() {
        let mut rng = rand::rngs::OsRng;
        let private_key = RsaPrivateKey::new(&mut rng, 2048).unwrap();
        let public_key_der = private_key
            .to_public_key()
            .to_public_key_der()
            .unwrap()
            .as_bytes()
            .to_vec();
        let client_nonce = [10u8; flag::CLIENT_NONCE_BYTES];

        let app = app(AppState {
            flag_template: Arc::from(DEFAULT_FLAG_TEMPLATE),
            expected_app_certificate_digest: Arc::from("*"),
            unsafe_disable_device_safety_checks: false,
        });
        let body = json!({
            "clientNonce": STANDARD.encode(client_nonce),
            "publicKey": STANDARD.encode(&public_key_der),
            "attestationCertificates": attestation_certificates_with_wrong_signature_digest(&public_key_der, &client_nonce),
        });

        let response = app
            .oneshot(
                Request::builder()
                    .method(Method::POST)
                    .uri("/api/flag")
                    .header("content-type", "application/json")
                    .header("user-agent", "okhttp/4.12.0")
                    .body(Body::from(body.to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
    }

    fn attestation_certificates(public_key_der: &[u8], challenge: &[u8]) -> Vec<String> {
        test_attestation_chain(public_key_der, attestation::test_key_description(challenge))
            .into_iter()
            .map(|certificate| STANDARD.encode(certificate))
            .collect()
    }

    fn attestation_certificates_without_application_id(
        public_key_der: &[u8],
        challenge: &[u8],
    ) -> Vec<String> {
        test_attestation_chain(
            public_key_der,
            attestation::test_key_description_without_application_id(challenge),
        )
        .into_iter()
        .map(|certificate| STANDARD.encode(certificate))
        .collect()
    }

    fn attestation_certificates_with_wrong_signature_digest(
        public_key_der: &[u8],
        challenge: &[u8],
    ) -> Vec<String> {
        test_attestation_chain(
            public_key_der,
            attestation::test_key_description_with_wrong_signature_digest(challenge),
        )
        .into_iter()
        .map(|certificate| STANDARD.encode(certificate))
        .collect()
    }

    fn attestation_certificates_with_mixed_application_id(
        public_key_der: &[u8],
        challenge: &[u8],
    ) -> Vec<String> {
        test_attestation_chain(
            public_key_der,
            attestation::test_key_description_with_mixed_application_id(challenge),
        )
        .into_iter()
        .map(|certificate| STANDARD.encode(certificate))
        .collect()
    }

    fn test_attestation_chain(public_key_der: &[u8], key_description: Vec<u8>) -> Vec<Vec<u8>> {
        let root_key = KeyPair::from_pem(TEST_ROOT_KEY_PEM).unwrap();
        let mut root_params = CertificateParams::new(Vec::<String>::new()).unwrap();
        root_params.is_ca = IsCa::Ca(BasicConstraints::Unconstrained);
        root_params
            .key_usages
            .push(KeyUsagePurpose::DigitalSignature);
        root_params.key_usages.push(KeyUsagePurpose::KeyCertSign);
        root_params.key_usages.push(KeyUsagePurpose::CrlSign);
        let root_cert = root_params.self_signed(&root_key).unwrap();
        let root_issuer = Issuer::new(root_params, root_key);

        let public_key = SubjectPublicKeyInfo::from_der(public_key_der).unwrap();
        let mut leaf_params = CertificateParams::new(Vec::<String>::new()).unwrap();
        leaf_params
            .distinguished_name
            .push(DnType::CommonName, "Android Keystore Key");
        leaf_params
            .custom_extensions
            .push(CustomExtension::from_oid_content(
                &[1, 3, 6, 1, 4, 1, 11129, 2, 1, 17],
                key_description,
            ));
        let leaf_cert = leaf_params.signed_by(&public_key, &root_issuer).unwrap();

        vec![leaf_cert.der().to_vec(), root_cert.der().to_vec()]
    }
}
