//! The sealed SSO gate cookie (`apps/web/src/lib/sso/session.ts`) and the
//! sealing it rides on (`sealSecret`/`openSecret` in `packages/core/src/crypto.ts`).
//!
//! A sealed value is `base64(iv).base64(tag).base64(ciphertext)`, AES-256-GCM
//! under `sha256(APP_ENCRYPTION_KEY)`, with the purpose (`sso_gate`) as
//! additional authenticated data, so a value sealed for anything else fails
//! the tag check here. `APP_ENCRYPTION_KEY_PREVIOUS` is tried second, as on the
//! TypeScript side. Every failure is "no gate": the caller is anonymous.

use aes_gcm::aead::{Aead, Payload};
use aes_gcm::{Aes256Gcm, KeyInit, Nonce};
use axum::http::HeaderMap;
use base64::Engine;
use base64::alphabet::STANDARD;
use base64::engine::{DecodePaddingMode, GeneralPurpose, GeneralPurposeConfig};
use serde_json::Value;
use sha2::{Digest, Sha256};

pub const SSO_GATE_COOKIE: &str = "sso_gate";

/// Node's `Buffer.from(…, "base64")` does not insist on padding.
const BASE64: GeneralPurpose = GeneralPurpose::new(
    &STANDARD,
    GeneralPurposeConfig::new().with_decode_padding_mode(DecodePaddingMode::Indifferent),
);

pub struct SealKeys {
    current: Option<[u8; 32]>,
    previous: Option<[u8; 32]>,
}

fn derive(secret: Option<&str>) -> Option<[u8; 32]> {
    secret
        .filter(|secret| !secret.is_empty())
        .map(|secret| Sha256::digest(secret.as_bytes()).into())
}

impl SealKeys {
    pub fn new(current: Option<&str>, previous: Option<&str>) -> Self {
        Self {
            current: derive(current),
            previous: derive(previous),
        }
    }

    /// `openSecret(stored, purpose)`. A purpose-bound value is never the
    /// legacy `plain:` form; a stored credential (no purpose) may be.
    pub fn open(&self, stored: &str, purpose: Option<&str>) -> Option<String> {
        if let Some(plain) = stored.strip_prefix("plain:") {
            return purpose.is_none().then(|| plain.to_owned());
        }
        // Without the current key `openSecret` throws before trying the previous one.
        let current = self.current.as_ref()?;
        decrypt(stored, current, purpose)
            .or_else(|| decrypt(stored, self.previous.as_ref()?, purpose))
    }
}

fn decrypt(stored: &str, key: &[u8; 32], purpose: Option<&str>) -> Option<String> {
    let mut parts = stored.split('.');
    let iv = BASE64.decode(parts.next()?).ok()?;
    let tag = BASE64.decode(parts.next()?).ok()?;
    let data = BASE64.decode(parts.next()?).ok()?;
    if iv.len() != 12 || tag.len() != 16 {
        return None;
    }
    let cipher = Aes256Gcm::new_from_slice(key).ok()?;
    let mut message = data;
    message.extend_from_slice(&tag);
    let plaintext = cipher
        .decrypt(
            Nonce::from_slice(&iv),
            Payload {
                msg: &message,
                aad: purpose.unwrap_or("").as_bytes(),
            },
        )
        .ok()?;
    String::from_utf8(plaintext).ok()
}

/// One cookie's value as Next.js `request.cookies.get(name)` reads it: pairs
/// split on `;`, the last one of a name wins, values URI-decoded, and a value
/// that does not decode is skipped.
pub fn cookie(headers: &HeaderMap, name: &str) -> Option<String> {
    let mut found = None;
    for header in headers.get_all("cookie") {
        let Ok(line) = header.to_str() else { continue };
        for pair in line.split(';') {
            let pair = pair.trim_start_matches(' ');
            let Some((key, value)) = pair.split_once('=') else {
                continue;
            };
            if key == name
                && let Some(decoded) = decode_uri_component(value)
            {
                found = Some(decoded);
            }
        }
    }
    found
}

/// `decodeURIComponent`, which throws on a `%` not followed by two hex digits.
fn decode_uri_component(value: &str) -> Option<String> {
    let bytes = value.as_bytes();
    for (i, byte) in bytes.iter().enumerate() {
        if *byte == b'%'
            && !(bytes.get(i + 1).is_some_and(u8::is_ascii_hexdigit)
                && bytes.get(i + 2).is_some_and(u8::is_ascii_hexdigit))
        {
            return None;
        }
    }
    percent_encoding::percent_decode_str(value)
        .decode_utf8()
        .ok()
        .map(|decoded| decoded.into_owned())
}

/// The verified gate payload.
pub struct Gate {
    pub subject_id: String,
}

/// `gateForOrg`: a valid, unexpired gate minted for this Organization.
pub fn gate_for_org(
    headers: &HeaderMap,
    keys: &SealKeys,
    organization_id: &str,
    now_ms: f64,
) -> Option<Gate> {
    let sealed = cookie(headers, SSO_GATE_COOKIE)?;
    if sealed.is_empty() {
        return None;
    }
    let payload: Value = serde_json::from_str(&keys.open(&sealed, Some("sso_gate"))?).ok()?;
    let exp = payload.get("exp")?.as_f64()?;
    if exp * 1000.0 < now_ms {
        return None;
    }
    if payload.get("organizationId")?.as_str()? != organization_id {
        return None;
    }
    Some(Gate {
        subject_id: payload.get("subjectId")?.as_str()?.to_owned(),
    })
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use aes_gcm::aead::AeadCore;
    use axum::http::HeaderValue;
    use serde_json::json;

    /// `sealSecret`, for building fixtures.
    pub(crate) fn seal(secret: &str, plaintext: &str, purpose: &str) -> String {
        let key: [u8; 32] = Sha256::digest(secret.as_bytes()).into();
        let cipher = Aes256Gcm::new_from_slice(&key).unwrap();
        let nonce = Aes256Gcm::generate_nonce(&mut aes_gcm::aead::OsRng);
        let sealed = cipher
            .encrypt(
                &nonce,
                Payload {
                    msg: plaintext.as_bytes(),
                    aad: purpose.as_bytes(),
                },
            )
            .unwrap();
        let (data, tag) = sealed.split_at(sealed.len() - 16);
        let b64 = base64::engine::general_purpose::STANDARD;
        format!(
            "{}.{}.{}",
            b64.encode(nonce),
            b64.encode(tag),
            b64.encode(data)
        )
    }

    fn headers(cookie: &str) -> HeaderMap {
        let mut headers = HeaderMap::new();
        headers.insert("cookie", HeaderValue::from_str(cookie).unwrap());
        headers
    }

    fn encoded(value: &str) -> String {
        percent_encoding::utf8_percent_encode(value, percent_encoding::NON_ALPHANUMERIC).to_string()
    }

    const NOW_MS: f64 = 1_800_000_000_000.0;

    #[test]
    fn opens_a_gate_for_its_organization_only() {
        let keys = SealKeys::new(Some("k"), None);
        let payload = json!({ "organizationId": "org-1", "subjectId": "sub-1", "provider": "entra", "exp": 1_900_000_000 });
        let sealed = seal("k", &payload.to_string(), "sso_gate");
        let headers = headers(&format!("a=b; sso_gate={}", encoded(&sealed)));
        assert_eq!(
            gate_for_org(&headers, &keys, "org-1", NOW_MS).map(|g| g.subject_id),
            Some("sub-1".to_owned())
        );
        assert!(gate_for_org(&headers, &keys, "org-2", NOW_MS).is_none());
    }

    #[test]
    fn refuses_expired_foreign_purpose_wrong_key_and_plain_values() {
        let keys = SealKeys::new(Some("k"), None);
        let expired = json!({ "organizationId": "o", "subjectId": "s", "exp": 1 }).to_string();
        let fresh =
            json!({ "organizationId": "o", "subjectId": "s", "exp": 1_900_000_000 }).to_string();
        for cookie in [
            seal("k", &expired, "sso_gate"),
            seal("k", &fresh, "attachment"),
            seal("other", &fresh, "sso_gate"),
            format!("plain:{fresh}"),
            "garbage".to_owned(),
        ] {
            let headers = headers(&format!("sso_gate={}", encoded(&cookie)));
            assert!(
                gate_for_org(&headers, &keys, "o", NOW_MS).is_none(),
                "{cookie}"
            );
        }
    }

    #[test]
    fn falls_back_to_the_previous_key_and_needs_a_current_one() {
        let fresh =
            json!({ "organizationId": "o", "subjectId": "s", "exp": 1_900_000_000 }).to_string();
        let sealed = seal("old", &fresh, "sso_gate");
        let headers = headers(&format!("sso_gate={}", encoded(&sealed)));
        assert!(
            gate_for_org(
                &headers,
                &SealKeys::new(Some("new"), Some("old")),
                "o",
                NOW_MS
            )
            .is_some()
        );
        assert!(gate_for_org(&headers, &SealKeys::new(None, Some("old")), "o", NOW_MS).is_none());
    }

    #[test]
    fn opens_a_stored_credential_with_no_purpose() {
        let keys = SealKeys::new(Some("k"), None);
        assert_eq!(
            keys.open(&seal("k", "sk-1", ""), None).as_deref(),
            Some("sk-1")
        );
        assert_eq!(keys.open("plain:sk-2", None).as_deref(), Some("sk-2"));
        assert_eq!(keys.open("plain:sk-2", Some("sso_gate")), None);
    }

    #[test]
    fn reads_cookies_as_next_does() {
        let headers = headers("sso_gate=a; other=1;sso_gate=b%2Bc");
        assert_eq!(cookie(&headers, "sso_gate").as_deref(), Some("b+c"));
        let headers = self::headers("sso_gate=ok; sso_gate=%zz");
        assert_eq!(cookie(&headers, "sso_gate").as_deref(), Some("ok"));
    }
}
