use super::parser::AndroidKeyDescription;
use base64::{engine::general_purpose::STANDARD, Engine};
use der_parser::{ber::BerObject, der::parse_der};
use std::str;

#[derive(Debug, Default, PartialEq, Eq)]
pub(crate) struct AttestedDeviceInfo {
    pub(crate) present: bool,
    pub(crate) attestation_version: u64,
    pub(crate) attestation_security_level: &'static str,
    pub(crate) keymaster_version: u64,
    pub(crate) keymaster_security_level: &'static str,
    pub(crate) unique_id: Option<String>,
    pub(crate) os_version: Option<u64>,
    pub(crate) os_patch_level: Option<u64>,
    pub(crate) vendor_patch_level: Option<u64>,
    pub(crate) boot_patch_level: Option<u64>,
    pub(crate) attestation_application_id: Option<AttestationApplicationId>,
    pub(crate) device_locked: Option<bool>,
    pub(crate) verified_boot_state: Option<u64>,
    pub(crate) verified_boot_state_name: Option<&'static str>,
    pub(crate) verified_boot_key: Option<String>,
    pub(crate) verified_boot_hash: Option<String>,
}

#[derive(Debug, PartialEq, Eq)]
pub(crate) struct AttestationApplicationId {
    pub(crate) packages: Vec<AttestationPackageInfo>,
    pub(crate) signature_digests: Vec<String>,
}

#[derive(Debug, PartialEq, Eq)]
pub(crate) struct AttestationPackageInfo {
    pub(crate) package_name: String,
    pub(crate) version: u64,
}

impl AttestedDeviceInfo {
    pub(super) fn has_unambiguous_package_identity(&self, package_name: &str) -> bool {
        self.attestation_application_id
            .as_ref()
            .is_some_and(|application_id| {
                application_id.packages.len() == 1
                    && application_id
                        .packages
                        .first()
                        .is_some_and(|package| package.package_name == package_name)
            })
    }

    pub(super) fn includes_application_signature_digest(&self, signature_digest: &str) -> bool {
        self.attestation_application_id
            .as_ref()
            .is_some_and(|application_id| {
                application_id
                    .signature_digests
                    .iter()
                    .any(|digest| digest.eq_ignore_ascii_case(signature_digest))
            })
    }
}

impl AndroidKeyDescription<'_> {
    pub(super) fn attested_device_info(&self) -> AttestedDeviceInfo {
        let device_authorizations = if self.tee_authorizations.has_attested_device_information() {
            &self.tee_authorizations
        } else {
            &self.software_authorizations
        };
        let root_of_trust = self.tee_authorizations.root_of_trust.as_ref();

        AttestedDeviceInfo {
            present: self
                .software_authorizations
                .has_attested_device_information()
                || self.tee_authorizations.has_attested_device_information(),
            attestation_version: self.attestation_version,
            attestation_security_level: security_level_name(self.attestation_security_level),
            keymaster_version: self.keymaster_version,
            keymaster_security_level: security_level_name(self.keymaster_security_level),
            unique_id: non_empty_b64(self.unique_id),
            os_version: device_authorizations.os_version,
            os_patch_level: device_authorizations.os_patch_level,
            vendor_patch_level: device_authorizations.vendor_patch_level,
            boot_patch_level: device_authorizations.boot_patch_level,
            attestation_application_id: self
                .software_authorizations
                .attestation_application_id
                .and_then(decode_attestation_application_id),
            device_locked: root_of_trust.map(|root| root.device_locked),
            verified_boot_state: root_of_trust.map(|root| root.verified_boot_state),
            verified_boot_state_name: root_of_trust
                .map(|root| verified_boot_state_name(root.verified_boot_state)),
            verified_boot_key: root_of_trust.map(|root| STANDARD.encode(root.verified_boot_key)),
            verified_boot_hash: root_of_trust.map(|root| STANDARD.encode(root.verified_boot_hash)),
        }
    }
}

fn decode_attestation_application_id(input: &[u8]) -> Option<AttestationApplicationId> {
    let (remaining, application_id) = parse_der(input).ok()?;
    if !remaining.is_empty() {
        return None;
    }

    let fields = application_id.as_sequence().ok()?;
    if fields.len() != 2 {
        return None;
    }

    let packages = fields[0]
        .as_set()
        .ok()?
        .iter()
        .map(decode_attestation_package_info)
        .collect::<Option<Vec<_>>>()?;
    let signature_digests = fields[1]
        .as_set()
        .ok()?
        .iter()
        .map(|digest| digest.as_slice().ok().map(hex_upper_colon))
        .collect::<Option<Vec<_>>>()?;

    Some(AttestationApplicationId {
        packages,
        signature_digests,
    })
}

fn decode_attestation_package_info(input: &BerObject<'_>) -> Option<AttestationPackageInfo> {
    let fields = input.as_sequence().ok()?;
    if fields.len() != 2 {
        return None;
    }

    let package_name = fields[0].as_slice().ok()?;
    let package_name = str::from_utf8(package_name).ok()?.to_owned();
    let version = fields[1].as_u64().ok()?;

    Some(AttestationPackageInfo {
        package_name,
        version,
    })
}

fn hex_upper_colon(bytes: &[u8]) -> String {
    bytes
        .iter()
        .map(|byte| format!("{byte:02X}"))
        .collect::<Vec<_>>()
        .join(":")
}

fn non_empty_b64(bytes: &[u8]) -> Option<String> {
    (!bytes.is_empty()).then(|| STANDARD.encode(bytes))
}

fn security_level_name(value: u64) -> &'static str {
    match value {
        0 => "Software",
        1 => "TrustedEnvironment",
        2 => "StrongBox",
        _ => "Unknown",
    }
}

fn verified_boot_state_name(value: u64) -> &'static str {
    match value {
        0 => "Verified",
        1 => "SelfSigned",
        2 => "Unverified",
        3 => "Failed",
        _ => "Unknown",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::api::attestation::parser::{AuthorizationList, RootOfTrust};
    use base64::engine::general_purpose::STANDARD;

    #[test]
    fn keeps_application_id_from_software_when_tee_has_device_info() {
        let application_id = STANDARD
            .decode(
                "ME0xJzAlBCBtbi5oYXJ1dWx6YW5naS51MThfMjAyNi5teV92YXVsdAIBATEiBCBKZpqIYxpP/ZgwINcKsGWYoJQboboj3ofNe1WD49W2Fw==",
            )
            .unwrap();
        let boot_key = b"boot-key";
        let boot_hash = b"boot-hash";
        let key_description = AndroidKeyDescription {
            attestation_version: 200,
            attestation_security_level: 1,
            keymaster_version: 200,
            keymaster_security_level: 1,
            attestation_challenge: b"challenge",
            unique_id: b"",
            purpose_decrypt: true,
            origin_generated: true,
            software_authorizations: AuthorizationList {
                attestation_application_id: Some(&application_id),
                ..AuthorizationList::default()
            },
            tee_authorizations: AuthorizationList {
                os_version: Some(140000),
                root_of_trust: Some(RootOfTrust {
                    verified_boot_key: boot_key,
                    device_locked: true,
                    verified_boot_state: 0,
                    verified_boot_hash: boot_hash,
                }),
                ..AuthorizationList::default()
            },
        };

        let info = key_description.attested_device_info();

        assert!(info.present);
        assert_eq!(
            info.attestation_application_id,
            Some(AttestationApplicationId {
                packages: vec![AttestationPackageInfo {
                    package_name: "mn.haruulzangi.u18_2026.my_vault".to_string(),
                    version: 1,
                }],
                signature_digests: vec![
                    "4A:66:9A:88:63:1A:4F:FD:98:30:20:D7:0A:B0:65:98:A0:94:1B:A1:BA:23:DE:87:CD:7B:55:83:E3:D5:B6:17"
                        .to_string(),
                ],
            })
        );
        assert_eq!(info.os_version, Some(140000));
        assert_eq!(info.device_locked, Some(true));
        assert_eq!(info.verified_boot_state_name, Some("Verified"));
        assert_eq!(info.verified_boot_key, Some(STANDARD.encode(boot_key)));
        assert_eq!(info.verified_boot_hash, Some(STANDARD.encode(boot_hash)));
    }
}
