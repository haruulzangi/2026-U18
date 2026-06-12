mod api;
mod shutdown;
mod state;

use api::app;
use shutdown::shutdown_signal;
use state::{AppState, DEFAULT_EXPECTED_APP_CERTIFICATE_DIGEST, DEFAULT_FLAG_TEMPLATE};
use std::{net::SocketAddr, sync::Arc};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

const DEFAULT_BIND_ADDR: &str = "0.0.0.0:3000";

#[tokio::main]
async fn main() {
    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "my_vault_server=info,tower_http=info".into()),
        )
        .with(tracing_subscriber::fmt::layer())
        .init();

    let flag_template = std::env::var("FLAG_TEMPLATE")
        .or_else(|_| std::env::var("FLAG"))
        .unwrap_or_else(|_| DEFAULT_FLAG_TEMPLATE.to_string());
    let expected_app_certificate_digest = std::env::var("UNSAFE_EXPECTED_APP_CERTIFICATE_DIGEST")
        .unwrap_or_else(|_| DEFAULT_EXPECTED_APP_CERTIFICATE_DIGEST.to_string());
    if expected_app_certificate_digest == "*" {
        log_unsafe_warning(
            "UNSAFE_EXPECTED_APP_CERTIFICATE_DIGEST",
            "app signing certificate digest check is disabled",
        );
    } else if expected_app_certificate_digest != DEFAULT_EXPECTED_APP_CERTIFICATE_DIGEST {
        tracing::warn!(
            flag = "UNSAFE_EXPECTED_APP_CERTIFICATE_DIGEST",
            expected_app_certificate_digest = %expected_app_certificate_digest,
            "using non-default app signing certificate digest"
        );
        eprintln!(
            "WARNING: UNSAFE_EXPECTED_APP_CERTIFICATE_DIGEST: using non-default app signing certificate digest: expected_app_certificate_digest={expected_app_certificate_digest}"
        );
    }
    let unsafe_disable_device_safety_checks =
        env_flag_enabled("UNSAFE_DISABLE_DEVICE_SAFETY_CHECKS");
    if unsafe_disable_device_safety_checks {
        log_unsafe_warning(
            "UNSAFE_DISABLE_DEVICE_SAFETY_CHECKS",
            "device safety attestation checks are disabled",
        );
    }

    let state = AppState {
        flag_template: Arc::from(flag_template),
        expected_app_certificate_digest: Arc::from(expected_app_certificate_digest),
        unsafe_disable_device_safety_checks,
    };

    let bind_addr = std::env::var("BIND_ADDR").unwrap_or_else(|_| DEFAULT_BIND_ADDR.to_string());
    let bind_addr: SocketAddr = bind_addr
        .parse()
        .unwrap_or_else(|err| panic!("invalid BIND_ADDR: {err}"));

    let app = app(state);
    let listener = tokio::net::TcpListener::bind(bind_addr)
        .await
        .unwrap_or_else(|err| panic!("failed to bind {bind_addr}: {err}"));

    tracing::info!("listening on http://{bind_addr}");
    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await
        .expect("server failed");
}

fn env_flag_enabled(name: &str) -> bool {
    std::env::var(name).is_ok_and(|value| {
        value == "1"
            || value.eq_ignore_ascii_case("true")
            || value.eq_ignore_ascii_case("yes")
            || value.eq_ignore_ascii_case("on")
    })
}

fn log_unsafe_warning(flag: &'static str, message: &'static str) {
    tracing::warn!(flag = flag, "{message}");
    eprintln!("WARNING: {flag}: {message}");
}
