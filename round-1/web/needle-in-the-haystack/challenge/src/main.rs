use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce,
};
use axum::{
    extract::{Query, State},
    http::{HeaderMap, StatusCode},
    response::Json,
    routing::get,
    Router,
};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use hkdf::Hkdf;
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::Sha256;
use std::sync::Arc;
use tower_http::services::ServeDir;
use x25519_dalek::{EphemeralSecret, PublicKey};

#[derive(Clone)]
struct AppState {
    flag_template: Arc<String>,
}

#[derive(Deserialize)]
struct FlagQuery {
    pub_key: String,
}

#[derive(Serialize)]
struct FlagResponse {
    server_pub_key: String,
    nonce: String,
    ciphertext: String,
}

async fn get_flag(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<FlagQuery>,
) -> Result<Json<FlagResponse>, StatusCode> {
    // Reject non-browser clients
    let ua = headers
        .get("user-agent")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    if !ua.contains("Mozilla") {
        return Err(StatusCode::INTERNAL_SERVER_ERROR);
    }

    // Decode client's X25519 public key (32 bytes, base64url)
    let client_pub_bytes = URL_SAFE_NO_PAD
        .decode(&query.pub_key)
        .map_err(|_| StatusCode::BAD_REQUEST)?;
    if client_pub_bytes.len() != 32 {
        return Err(StatusCode::BAD_REQUEST);
    }
    let client_pub_array: [u8; 32] = client_pub_bytes.try_into().unwrap();
    let client_pub_key = PublicKey::from(client_pub_array);

    // Generate ephemeral server keypair and compute shared secret
    let server_secret = EphemeralSecret::random_from_rng(rand::rngs::OsRng);
    let server_pub_key = PublicKey::from(&server_secret);
    let shared_secret = server_secret.diffie_hellman(&client_pub_key);

    // Derive AES-256 key via HKDF-SHA256
    let hkdf = Hkdf::<Sha256>::new(None, shared_secret.as_bytes());
    let mut aes_key_bytes = [0u8; 32];
    hkdf.expand(b"needle-in-the-haystack", &mut aes_key_bytes)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    // Encrypt flag with AES-256-GCM
    let flag = generate_flag(&state.flag_template);
    let cipher = Aes256Gcm::new_from_slice(&aes_key_bytes)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let mut nonce_bytes = [0u8; 12];
    rand::rngs::OsRng.fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);
    let ciphertext = cipher
        .encrypt(nonce, flag.as_bytes())
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    Ok(Json(FlagResponse {
        server_pub_key: URL_SAFE_NO_PAD.encode(server_pub_key.as_bytes()),
        nonce: URL_SAFE_NO_PAD.encode(nonce_bytes),
        ciphertext: URL_SAFE_NO_PAD.encode(ciphertext),
    }))
}

fn generate_flag(template: &str) -> String {
    let mut seen = std::collections::HashMap::new();
    let re = regex::Regex::new(r"\$\d+").unwrap();
    re.replace_all(template, |caps: &regex::Captures| {
        let placeholder = caps[0].to_string();
        seen.entry(placeholder)
            .or_insert_with(|| {
                let mut bytes = [0u8; 8];
                rand::rngs::OsRng.fill_bytes(&mut bytes);
                URL_SAFE_NO_PAD.encode(bytes)
            })
            .clone()
    })
    .into_owned()
}

#[tokio::main]
async fn main() {
    let flag_template = std::env::var("FLAG").expect("FLAG env var must be set");
    let state = AppState {
        flag_template: Arc::new(flag_template),
    };

    let app = Router::new()
        .route("/flag", get(get_flag))
        .fallback_service(ServeDir::new("static"))
        .with_state(state);

    let listener = tokio::net::TcpListener::bind("0.0.0.0:3000").await.unwrap();
    println!("Listening on http://0.0.0.0:3000");
    axum::serve(listener, app).await.unwrap();
}
