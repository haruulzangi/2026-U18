use std::sync::Arc;

pub(crate) const DEFAULT_FLAG_TEMPLATE: &str = "HZU18{my_vault_$fingerprint}";
pub(crate) const DEFAULT_EXPECTED_APP_CERTIFICATE_DIGEST: &str =
    "41:03:F8:79:3D:C7:77:61:AF:7F:1F:0D:65:96:43:46:17:35:5F:56:51:7F:94:D3:AB:3D:4A:94:B4:A9:3A:F3";

#[derive(Clone)]
pub(crate) struct AppState {
    pub(crate) flag_template: Arc<str>,
    pub(crate) expected_app_certificate_digest: Arc<str>,
    pub(crate) unsafe_disable_device_safety_checks: bool,
}
