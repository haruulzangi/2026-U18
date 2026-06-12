use super::attestation::verify_key_attestation;
use super::error::{ApiError, ApiResult};
use crate::state::AppState;
use aes_gcm::{
    aead::{Aead, KeyInit, Payload},
    Aes256Gcm, Nonce,
};
use axum::Json;
use base64::{
    engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD},
    Engine,
};
use rand::RngCore;
use rsa::{pkcs8::DecodePublicKey, traits::PublicKeyParts, Oaep, RsaPublicKey};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

pub(crate) const CLIENT_NONCE_BYTES: usize = 32;
const MIN_RSA_PUBLIC_KEY_BITS: usize = 2048;
const SESSION_KEY_BYTES: usize = 32;
const FLAG_IV_BYTES: usize = 12;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FlagHandshakeRequest {
    pub(crate) client_nonce: Option<String>,
    pub(crate) public_key: Option<String>,
    pub(crate) attestation_certificates: Option<Vec<String>>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct EncryptedFlagResponse {
    pub(crate) encrypted_session_key: String,
    pub(crate) flag_iv: String,
    pub(crate) encrypted_flag: String,
    pub(crate) aad: String,
}

pub(crate) fn retrieve_encrypted_flag(
    state: &AppState,
    request: FlagHandshakeRequest,
    user_agent: &str,
) -> ApiResult<EncryptedFlagResponse> {
    let client_nonce =
        decode_required_base64_field("clientNonce", request.client_nonce.as_deref())?;
    if client_nonce.len() != CLIENT_NONCE_BYTES {
        return Err(client_verification_error(format!(
            "client nonce has invalid length {}",
            client_nonce.len()
        )));
    }

    let public_key_der = decode_required_base64_field("publicKey", request.public_key.as_deref())?;
    let public_key = RsaPublicKey::from_public_key_der(&public_key_der)
        .map_err(|error| client_verification_error(format!("invalid public key DER: {error}")))?;
    if public_key.n().bits() < MIN_RSA_PUBLIC_KEY_BITS {
        return Err(client_verification_error(format!(
            "public key modulus is smaller than {MIN_RSA_PUBLIC_KEY_BITS} bits"
        )));
    }
    let attestation_certificates = decode_attestation_certificates(
        "attestationCertificates",
        request.attestation_certificates.as_deref(),
    )?;
    let attested_device = verify_key_attestation(
        &attestation_certificates,
        &public_key_der,
        &client_nonce,
        &state.expected_app_certificate_digest,
        state.unsafe_disable_device_safety_checks,
    )?;

    let fingerprint = public_key_fingerprint(&public_key_der);
    let flag = generate_flag(&state.flag_template, &fingerprint);
    let aad = cbor_byte_string_32(&client_nonce);

    let mut rng = rand::rngs::OsRng;
    let mut session_key = [0u8; SESSION_KEY_BYTES];
    let mut flag_iv = [0u8; FLAG_IV_BYTES];
    rng.fill_bytes(&mut session_key);
    rng.fill_bytes(&mut flag_iv);

    let encrypted_session_key = public_key
        .encrypt(&mut rng, Oaep::new::<Sha256>(), &session_key)
        .map_err(|_| ApiError::internal("failed to encrypt session key"))?;

    let cipher = Aes256Gcm::new_from_slice(&session_key)
        .map_err(|_| ApiError::internal("failed to create AES cipher"))?;
    let encrypted_flag = cipher
        .encrypt(
            Nonce::from_slice(&flag_iv),
            Payload {
                msg: flag.as_bytes(),
                aad: &aad,
            },
        )
        .map_err(|_| ApiError::internal("failed to encrypt flag"))?;

    tracing::info!(
        flag = %flag,
        user_agent = %user_agent,
        attested_device_info_present = attested_device.present,
        attestation_version = attested_device.attestation_version,
        attestation_security_level = attested_device.attestation_security_level,
        keymaster_version = attested_device.keymaster_version,
        keymaster_security_level = attested_device.keymaster_security_level,
        attestation_unique_id = ?attested_device.unique_id,
        attestation_os_version = ?attested_device.os_version,
        attestation_os_patch_level = ?attested_device.os_patch_level,
        attestation_vendor_patch_level = ?attested_device.vendor_patch_level,
        attestation_boot_patch_level = ?attested_device.boot_patch_level,
        attestation_application_id = ?attested_device.attestation_application_id,
        attestation_device_locked = ?attested_device.device_locked,
        attestation_verified_boot_state = ?attested_device.verified_boot_state,
        attestation_verified_boot_state_name = ?attested_device.verified_boot_state_name,
        attestation_verified_boot_key = ?attested_device.verified_boot_key,
        attestation_verified_boot_hash = ?attested_device.verified_boot_hash,
        "issued flag"
    );

    Ok(Json(EncryptedFlagResponse {
        encrypted_session_key: STANDARD.encode(encrypted_session_key),
        flag_iv: STANDARD.encode(flag_iv),
        encrypted_flag: STANDARD.encode(encrypted_flag),
        aad: STANDARD.encode(aad),
    }))
}

fn decode_base64_field(_name: &str, value: &str) -> Result<Vec<u8>, ApiError> {
    if value.is_empty() {
        return Err(client_verification_error(format!("{_name} is empty")));
    }

    STANDARD
        .decode(value)
        .map_err(|error| client_verification_error(format!("{_name} is not valid base64: {error}")))
}

fn decode_required_base64_field(_name: &str, value: Option<&str>) -> Result<Vec<u8>, ApiError> {
    let value = value.ok_or_else(|| ApiError::bad_request("invalid request body"))?;
    if value.is_empty() {
        return Err(client_verification_error(format!("{_name} is empty")));
    }

    decode_base64_field(_name, value)
}

fn decode_attestation_certificates(
    _name: &str,
    values: Option<&[String]>,
) -> Result<Vec<Vec<u8>>, ApiError> {
    let values = values.ok_or_else(|| ApiError::bad_request("invalid request body"))?;
    if values.is_empty() {
        return Err(client_verification_error(format!("{_name} is empty")));
    }

    values
        .iter()
        .map(|value| {
            if value.is_empty() {
                return Err(client_verification_error(format!(
                    "{_name} contains an empty certificate"
                )));
            }
            STANDARD.decode(value).map_err(|error| {
                client_verification_error(format!(
                    "{_name} contains a certificate that is not valid base64: {error}"
                ))
            })
        })
        .collect()
}

pub(crate) fn cbor_byte_string_32(bytes: &[u8]) -> Vec<u8> {
    let mut aad = Vec::with_capacity(2 + bytes.len());
    aad.extend_from_slice(&[0x58, 0x20]);
    aad.extend_from_slice(bytes);
    aad
}

pub(crate) fn public_key_fingerprint(public_key_der: &[u8]) -> String {
    URL_SAFE_NO_PAD.encode(Sha256::digest(public_key_der))
}

fn generate_flag(template: &str, fingerprint: &str) -> String {
    template
        .replace("$fingerprint", fingerprint)
        .replace("{fingerprint}", fingerprint)
}

fn client_verification_error(reason: impl Into<String>) -> ApiError {
    ApiError::untrusted_client_reason(format!("client verification failed: {}", reason.into()))
}
