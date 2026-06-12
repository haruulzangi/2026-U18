use super::{super::error::ApiError, attestation_verification_error};
use der_parser::{
    asn1_rs::{Class, Tag as DerTag},
    ber::BerObject,
    der::parse_der,
};
use x509_parser::prelude::*;

const ANDROID_KEY_ATTESTATION_OID: &str = "1.3.6.1.4.1.11129.2.1.17";
// Android attestation uses Keymaster purpose enum values, not KeyProperties bitmasks.
const KEY_PURPOSE_DECRYPT: u64 = 1;
const KEY_ORIGIN_GENERATED: u64 = 0;

#[derive(Debug, PartialEq, Eq)]
pub(super) struct AndroidKeyDescription<'a> {
    pub(super) attestation_version: u64,
    pub(super) attestation_security_level: u64,
    pub(super) keymaster_version: u64,
    pub(super) keymaster_security_level: u64,
    pub(super) attestation_challenge: &'a [u8],
    pub(super) unique_id: &'a [u8],
    pub(super) purpose_decrypt: bool,
    pub(super) origin_generated: bool,
    pub(super) software_authorizations: AuthorizationList<'a>,
    pub(super) tee_authorizations: AuthorizationList<'a>,
}

#[derive(Debug, Default, PartialEq, Eq)]
pub(super) struct AuthorizationList<'a> {
    pub(super) purpose_decrypt: bool,
    pub(super) origin_generated: bool,
    pub(super) os_version: Option<u64>,
    pub(super) os_patch_level: Option<u64>,
    pub(super) vendor_patch_level: Option<u64>,
    pub(super) boot_patch_level: Option<u64>,
    pub(super) attestation_application_id: Option<&'a [u8]>,
    pub(super) root_of_trust: Option<RootOfTrust<'a>>,
}

impl AuthorizationList<'_> {
    pub(super) fn has_attested_device_information(&self) -> bool {
        self.os_version.is_some()
            || self.os_patch_level.is_some()
            || self.vendor_patch_level.is_some()
            || self.boot_patch_level.is_some()
            || self.attestation_application_id.is_some()
            || self.root_of_trust.is_some()
    }
}

#[derive(Debug, PartialEq, Eq)]
pub(super) struct RootOfTrust<'a> {
    pub(super) verified_boot_key: &'a [u8],
    pub(super) device_locked: bool,
    pub(super) verified_boot_state: u64,
    pub(super) verified_boot_hash: &'a [u8],
}

pub(super) fn parse_android_key_description<'a>(
    certificate: &'a X509Certificate<'a>,
) -> Result<AndroidKeyDescription<'a>, ApiError> {
    let extension = certificate
        .iter_extensions()
        .find(|extension| extension.oid.to_id_string() == ANDROID_KEY_ATTESTATION_OID)
        .ok_or_else(|| {
            attestation_verification_error("missing Android key attestation extension")
        })?;

    parse_android_key_description_from_der(extension.value)
}

fn parse_android_key_description_from_der(
    input: &[u8],
) -> Result<AndroidKeyDescription<'_>, ApiError> {
    let (remaining, key_description) =
        parse_der(input).map_err(|_| invalid_attestation_extension())?;
    if !remaining.is_empty() {
        return Err(invalid_attestation_extension());
    }

    let fields = key_description
        .as_sequence()
        .map_err(|_| invalid_attestation_extension())?;
    if fields.len() != 8 {
        return Err(invalid_attestation_extension());
    }

    let attestation_version = fields[0]
        .as_u64()
        .map_err(|_| invalid_attestation_extension())?;
    let attestation_security_level = fields[1]
        .as_u64()
        .map_err(|_| invalid_attestation_extension())?;
    let keymaster_version = fields[2]
        .as_u64()
        .map_err(|_| invalid_attestation_extension())?;
    let keymaster_security_level = fields[3]
        .as_u64()
        .map_err(|_| invalid_attestation_extension())?;
    let attestation_challenge = fields[4]
        .as_slice()
        .map_err(|_| invalid_attestation_extension())?;
    let unique_id = fields[5]
        .as_slice()
        .map_err(|_| invalid_attestation_extension())?;

    let software_authorizations = parse_authorization_list(&fields[6])?;
    let tee_authorizations = parse_authorization_list(&fields[7])?;

    Ok(AndroidKeyDescription {
        attestation_version,
        attestation_security_level,
        keymaster_version,
        keymaster_security_level,
        attestation_challenge,
        unique_id,
        purpose_decrypt: software_authorizations.purpose_decrypt
            || tee_authorizations.purpose_decrypt,
        origin_generated: software_authorizations.origin_generated
            || tee_authorizations.origin_generated,
        software_authorizations,
        tee_authorizations,
    })
}

fn parse_authorization_list<'a>(input: &BerObject<'a>) -> Result<AuthorizationList<'a>, ApiError> {
    let entries = input
        .as_sequence()
        .map_err(|_| invalid_attestation_extension())?;
    let mut authorizations = AuthorizationList::default();

    for entry in entries {
        if entry.header.class() != Class::ContextSpecific {
            continue;
        }

        let value = parse_explicit_tagged_value(entry)?;
        match entry.header.tag() {
            DerTag(1) => {
                authorizations.purpose_decrypt =
                    parse_integer_set(&value)?.contains(&KEY_PURPOSE_DECRYPT);
            }
            DerTag(702) => {
                authorizations.origin_generated = value
                    .as_u64()
                    .map_err(|_| invalid_attestation_extension())?
                    == KEY_ORIGIN_GENERATED;
            }
            DerTag(704) => {
                authorizations.root_of_trust = Some(parse_root_of_trust(&value)?);
            }
            DerTag(705) => {
                authorizations.os_version = Some(
                    value
                        .as_u64()
                        .map_err(|_| invalid_attestation_extension())?,
                );
            }
            DerTag(706) => {
                authorizations.os_patch_level = Some(
                    value
                        .as_u64()
                        .map_err(|_| invalid_attestation_extension())?,
                );
            }
            DerTag(709) => {
                authorizations.attestation_application_id = Some(
                    value
                        .as_slice()
                        .map_err(|_| invalid_attestation_extension())?,
                );
            }
            DerTag(718) => {
                authorizations.vendor_patch_level = Some(
                    value
                        .as_u64()
                        .map_err(|_| invalid_attestation_extension())?,
                );
            }
            DerTag(719) => {
                authorizations.boot_patch_level = Some(
                    value
                        .as_u64()
                        .map_err(|_| invalid_attestation_extension())?,
                );
            }
            _ => {}
        }
    }

    Ok(authorizations)
}

fn parse_root_of_trust<'a>(input: &BerObject<'a>) -> Result<RootOfTrust<'a>, ApiError> {
    let fields = input
        .as_sequence()
        .map_err(|_| invalid_attestation_extension())?;
    if fields.len() != 4 {
        return Err(invalid_attestation_extension());
    }

    Ok(RootOfTrust {
        verified_boot_key: fields[0]
            .as_slice()
            .map_err(|_| invalid_attestation_extension())?,
        device_locked: fields[1]
            .as_bool()
            .map_err(|_| invalid_attestation_extension())?,
        verified_boot_state: fields[2]
            .as_u64()
            .map_err(|_| invalid_attestation_extension())?,
        verified_boot_hash: fields[3]
            .as_slice()
            .map_err(|_| invalid_attestation_extension())?,
    })
}

fn parse_explicit_tagged_value<'a>(input: &BerObject<'a>) -> Result<BerObject<'a>, ApiError> {
    let (remaining, value) = parse_der(
        input
            .as_slice()
            .map_err(|_| invalid_attestation_extension())?,
    )
    .map_err(|_| invalid_attestation_extension())?;
    if !remaining.is_empty() {
        return Err(invalid_attestation_extension());
    }

    Ok(value)
}

fn parse_integer_set(input: &BerObject<'_>) -> Result<Vec<u64>, ApiError> {
    input
        .as_set()
        .map_err(|_| invalid_attestation_extension())?
        .iter()
        .map(|value| value.as_u64().map_err(|_| invalid_attestation_extension()))
        .collect()
}

fn invalid_attestation_extension() -> ApiError {
    attestation_verification_error("invalid Android key attestation extension")
}

#[cfg(test)]
pub(crate) fn test_key_description(challenge: &[u8]) -> Vec<u8> {
    test_key_description_with_application_id(challenge, Some(&TEST_RELEASE_SIGNATURE_DIGEST_SHA256))
}

#[cfg(test)]
pub(crate) fn test_key_description_without_application_id(challenge: &[u8]) -> Vec<u8> {
    test_key_description_with_application_id(challenge, None)
}

#[cfg(test)]
pub(crate) fn test_key_description_with_wrong_signature_digest(challenge: &[u8]) -> Vec<u8> {
    test_key_description_with_application_id(challenge, Some(&TEST_DEBUG_SIGNATURE_DIGEST_SHA256))
}

#[cfg(test)]
pub(crate) fn test_key_description_with_mixed_application_id(challenge: &[u8]) -> Vec<u8> {
    test_key_description_with_options(
        challenge,
        Some(TestApplicationId::MixedPackageAndDigest),
        Some(TestRootOfTrust::safe()),
    )
}

#[cfg(test)]
pub(crate) fn test_key_description_without_root_of_trust(challenge: &[u8]) -> Vec<u8> {
    test_key_description_with_options(challenge, Some(TestApplicationId::Release), None)
}

#[cfg(test)]
pub(crate) fn test_key_description_with_unlocked_device(challenge: &[u8]) -> Vec<u8> {
    test_key_description_with_options(
        challenge,
        Some(TestApplicationId::Release),
        Some(TestRootOfTrust {
            device_locked: false,
            ..TestRootOfTrust::safe()
        }),
    )
}

#[cfg(test)]
pub(crate) fn test_key_description_with_unverified_boot_state(challenge: &[u8]) -> Vec<u8> {
    test_key_description_with_options(
        challenge,
        Some(TestApplicationId::Release),
        Some(TestRootOfTrust {
            verified_boot_state: 2,
            ..TestRootOfTrust::safe()
        }),
    )
}

#[cfg(test)]
pub(crate) fn test_key_description_with_zero_verified_boot_key(challenge: &[u8]) -> Vec<u8> {
    test_key_description_with_options(
        challenge,
        Some(TestApplicationId::Release),
        Some(TestRootOfTrust {
            verified_boot_key: &TEST_ZERO_VERIFIED_BOOT_KEY,
            ..TestRootOfTrust::safe()
        }),
    )
}

#[cfg(test)]
pub(crate) fn test_key_description_with_zero_verified_boot_hash(challenge: &[u8]) -> Vec<u8> {
    test_key_description_with_options(
        challenge,
        Some(TestApplicationId::Release),
        Some(TestRootOfTrust {
            verified_boot_hash: &TEST_ZERO_VERIFIED_BOOT_HASH,
            ..TestRootOfTrust::safe()
        }),
    )
}

#[cfg(test)]
fn test_key_description_with_application_id(
    challenge: &[u8],
    signature_digest: Option<&[u8; 32]>,
) -> Vec<u8> {
    test_key_description_with_options(
        challenge,
        signature_digest.map(TestApplicationId::SingleDigest),
        Some(TestRootOfTrust::safe()),
    )
}

#[cfg(test)]
fn test_key_description_with_options(
    challenge: &[u8],
    application_id: Option<TestApplicationId>,
    root_of_trust: Option<TestRootOfTrust>,
) -> Vec<u8> {
    yasna::construct_der(|writer| {
        writer.write_sequence(|writer| {
            writer.next().write_u64(200);
            writer.next().write_enum(0);
            writer.next().write_u64(200);
            writer.next().write_enum(0);
            writer.next().write_bytes(challenge);
            writer.next().write_bytes(&[]);
            writer.next().write_sequence(|writer| {
                writer
                    .next()
                    .write_tagged(yasna::Tag::context(1), |writer| {
                        writer.write_set_of(|writer| {
                            writer.next().write_u64(KEY_PURPOSE_DECRYPT);
                        });
                    });
                writer
                    .next()
                    .write_tagged(yasna::Tag::context(702), |writer| {
                        writer.write_u64(KEY_ORIGIN_GENERATED);
                    });
                if let Some(application_id) = application_id {
                    writer
                        .next()
                        .write_tagged(yasna::Tag::context(709), |writer| {
                            writer.write_bytes(&test_attestation_application_id(application_id));
                        });
                }
            });
            writer.next().write_sequence(|writer| {
                if let Some(root_of_trust) = root_of_trust {
                    writer
                        .next()
                        .write_tagged(yasna::Tag::context(704), |writer| {
                            writer.write_sequence(|writer| {
                                writer.next().write_bytes(root_of_trust.verified_boot_key);
                                writer.next().write_bool(root_of_trust.device_locked);
                                writer
                                    .next()
                                    .write_enum(root_of_trust.verified_boot_state as i64);
                                writer.next().write_bytes(root_of_trust.verified_boot_hash);
                            });
                        });
                }
            });
        });
    })
}

#[cfg(test)]
#[derive(Clone, Copy)]
enum TestApplicationId<'a> {
    SingleDigest(&'a [u8; 32]),
    Release,
    MixedPackageAndDigest,
}

#[cfg(test)]
#[derive(Clone, Copy)]
struct TestRootOfTrust {
    verified_boot_key: &'static [u8],
    device_locked: bool,
    verified_boot_state: u64,
    verified_boot_hash: &'static [u8],
}

#[cfg(test)]
impl TestRootOfTrust {
    fn safe() -> Self {
        Self {
            verified_boot_key: &TEST_VERIFIED_BOOT_KEY,
            device_locked: true,
            verified_boot_state: 0,
            verified_boot_hash: &TEST_VERIFIED_BOOT_HASH,
        }
    }
}

#[cfg(test)]
const TEST_VERIFIED_BOOT_KEY: [u8; 32] = [0x11; 32];
#[cfg(test)]
const TEST_VERIFIED_BOOT_HASH: [u8; 32] = [0x22; 32];
#[cfg(test)]
const TEST_ZERO_VERIFIED_BOOT_KEY: [u8; 32] = [0; 32];
#[cfg(test)]
const TEST_ZERO_VERIFIED_BOOT_HASH: [u8; 32] = [0; 32];

#[cfg(test)]
const TEST_RELEASE_SIGNATURE_DIGEST_SHA256: [u8; 32] = [
    0x41, 0x03, 0xf8, 0x79, 0x3d, 0xc7, 0x77, 0x61, 0xaf, 0x7f, 0x1f, 0x0d, 0x65, 0x96, 0x43, 0x46,
    0x17, 0x35, 0x5f, 0x56, 0x51, 0x7f, 0x94, 0xd3, 0xab, 0x3d, 0x4a, 0x94, 0xb4, 0xa9, 0x3a, 0xf3,
];

#[cfg(test)]
const TEST_DEBUG_SIGNATURE_DIGEST_SHA256: [u8; 32] = [
    0x4a, 0x66, 0x9a, 0x88, 0x63, 0x1a, 0x4f, 0xfd, 0x98, 0x30, 0x20, 0xd7, 0x0a, 0xb0, 0x65, 0x98,
    0xa0, 0x94, 0x1b, 0xa1, 0xba, 0x23, 0xde, 0x87, 0xcd, 0x7b, 0x55, 0x83, 0xe3, 0xd5, 0xb6, 0x17,
];

#[cfg(test)]
fn test_attestation_application_id(application_id: TestApplicationId) -> Vec<u8> {
    yasna::construct_der(|writer| {
        writer.write_sequence(|writer| {
            writer.next().write_set_of(|writer| {
                write_test_package_info(writer, super::EXPECTED_ANDROID_PACKAGE_NAME);
                if matches!(application_id, TestApplicationId::MixedPackageAndDigest) {
                    write_test_package_info(writer, "com.attacker");
                }
            });
            writer.next().write_set_of(|writer| match application_id {
                TestApplicationId::SingleDigest(signature_digest) => {
                    writer.next().write_bytes(signature_digest);
                }
                TestApplicationId::Release => {
                    writer
                        .next()
                        .write_bytes(&TEST_RELEASE_SIGNATURE_DIGEST_SHA256);
                }
                TestApplicationId::MixedPackageAndDigest => {
                    writer
                        .next()
                        .write_bytes(&TEST_DEBUG_SIGNATURE_DIGEST_SHA256);
                    writer
                        .next()
                        .write_bytes(&TEST_RELEASE_SIGNATURE_DIGEST_SHA256);
                }
            });
        });
    })
}

#[cfg(test)]
fn write_test_package_info(writer: &mut yasna::DERWriterSet<'_>, package_name: &str) {
    writer.next().write_sequence(|writer| {
        writer.next().write_bytes(package_name.as_bytes());
        writer.next().write_u64(1);
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_nonce_bound_decrypt_generated_authorizations() {
        let challenge = [9u8; 32];
        let extension = test_key_description(&challenge);
        let parsed = parse_android_key_description_from_der(&extension).unwrap();

        assert_eq!(parsed.attestation_challenge, challenge);
        assert!(parsed.purpose_decrypt);
        assert!(parsed.origin_generated);
    }
}
