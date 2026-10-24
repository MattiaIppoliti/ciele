//! The caller assertion: who an operation runs as, signed by the web app.
//!
//! The web app has already authenticated the caller (a session cookie or an
//! API key), checked the operation's capability and validated the input. It
//! then signs what it resolved, and this service trusts nothing else. Wire
//! format, mirrored by `packages/ops/src/remote.ts`:
//!
//! ```text
//! x-ciele-assertion: base64url(json claims) "." base64url(hmac_sha256(secret, base64url(json claims)))
//! ```
//!
//! The claims name the operation and carry the SHA-256 of the exact body bytes
//! (`body`, base64url), so an assertion minted for `alerts.list` cannot run
//! `alerts.update`, and one minted to resolve one Alert cannot resolve
//! another. They expire after at most [`MAX_TTL_SECS`]. Inside that window the
//! same request can be replayed, which repeats what the caller already asked
//! for; the web app mints one per call and the service is only reachable from
//! it.

use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use hmac::{Hmac, Mac};
use serde::Deserialize;
use serde::Serialize;
use sha2::{Digest, Sha256};

use crate::error::ApiError;

pub const HEADER: &str = "x-ciele-assertion";
/// The longest validity the service accepts, whatever `exp` says.
pub const MAX_TTL_SECS: i64 = 60;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DbScope {
    /// The web console: the Member's own RLS session.
    Session,
    /// An API key: the service role, pinned to one Organization by the queries.
    Pinned,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Role {
    Viewer,
    Editor,
    Admin,
    Owner,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Claims {
    pub op: String,
    pub org: String,
    /// The acting Member's user id. Empty where the surface has nobody to name.
    pub sub: String,
    /// The Member's email, where the surface knows it. A session puts it in
    /// `request.jwt.claims`, as the Member's own JWT does.
    #[serde(default)]
    pub email: Option<String>,
    pub role: Role,
    pub scope: DbScope,
    /// base64url SHA-256 of the request body.
    pub body: String,
    /// Unix seconds.
    pub exp: i64,
}

impl Claims {
    /// `sub` as the nullable uuid text a `resolved_by` column takes.
    pub fn actor(&self) -> Option<&str> {
        (!self.sub.is_empty()).then_some(self.sub.as_str())
    }
}

/// What `body` in the claims must equal for these bytes.
pub fn body_digest(body: &[u8]) -> String {
    URL_SAFE_NO_PAD.encode(Sha256::digest(body))
}

pub fn verify(
    secret: &[u8],
    token: &str,
    operation: &str,
    body: &[u8],
    now: i64,
) -> Result<Claims, ApiError> {
    let (payload, signature) = token.split_once('.').ok_or_else(ApiError::unauthorized)?;
    let signature = URL_SAFE_NO_PAD
        .decode(signature)
        .map_err(|_| ApiError::unauthorized())?;
    let mut mac = Hmac::<Sha256>::new_from_slice(secret).map_err(|_| ApiError::unauthorized())?;
    mac.update(payload.as_bytes());
    // Constant-time comparison.
    mac.verify_slice(&signature)
        .map_err(|_| ApiError::unauthorized())?;

    let json = URL_SAFE_NO_PAD
        .decode(payload)
        .map_err(|_| ApiError::unauthorized())?;
    let claims: Claims = serde_json::from_slice(&json).map_err(|_| ApiError::unauthorized())?;
    if claims.op != operation || claims.exp <= now || claims.exp > now + MAX_TTL_SECS {
        return Err(ApiError::unauthorized());
    }
    if claims.body != body_digest(body) {
        return Err(ApiError::unauthorized());
    }
    if claims.scope == DbScope::Session && claims.sub.is_empty() {
        // A session always has a Member; without one RLS would see an anonymous caller.
        return Err(ApiError::unauthorized());
    }
    Ok(claims)
}

#[cfg(test)]
pub fn sign(secret: &[u8], claims: &serde_json::Value) -> String {
    let payload = URL_SAFE_NO_PAD.encode(claims.to_string());
    let mut mac = Hmac::<Sha256>::new_from_slice(secret).unwrap();
    mac.update(payload.as_bytes());
    format!(
        "{payload}.{}",
        URL_SAFE_NO_PAD.encode(mac.finalize().into_bytes())
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    const SECRET: &[u8] = b"0123456789abcdef0123456789abcdef";

    const BODY: &[u8] = br#"{"id":"al-1"}"#;

    fn claims(op: &str, exp: i64) -> serde_json::Value {
        json!({ "op": op, "org": "o", "sub": "u", "role": "editor", "scope": "session", "body": body_digest(BODY), "exp": exp })
    }

    #[test]
    fn accepts_a_fresh_assertion_for_its_operation() {
        let token = sign(SECRET, &claims("alerts.list", 1030));
        let verified = verify(SECRET, &token, "alerts.list", BODY, 1000).unwrap();
        assert_eq!(verified.role, Role::Editor);
        assert_eq!(verified.scope, DbScope::Session);
    }

    #[test]
    fn refuses_another_operation_an_expired_one_and_a_long_lived_one() {
        let token = sign(SECRET, &claims("alerts.list", 1030));
        assert!(verify(SECRET, &token, "alerts.update", BODY, 1000).is_err());
        assert!(verify(SECRET, &token, "alerts.list", BODY, 1030).is_err());
        let long = sign(SECRET, &claims("alerts.list", 1000 + MAX_TTL_SECS + 1));
        assert!(verify(SECRET, &long, "alerts.list", BODY, 1000).is_err());
    }

    #[test]
    fn refuses_the_assertion_over_another_body() {
        let token = sign(SECRET, &claims("alerts.resolve", 1030));
        assert!(verify(SECRET, &token, "alerts.resolve", BODY, 1000).is_ok());
        assert!(verify(SECRET, &token, "alerts.resolve", br#"{"id":"al-2"}"#, 1000).is_err());
        assert!(verify(SECRET, &token, "alerts.resolve", br#"{"id": "al-1"}"#, 1000).is_err());
        assert!(verify(SECRET, &token, "alerts.resolve", b"", 1000).is_err());
    }

    #[test]
    fn refuses_a_forged_or_mangled_signature() {
        let token = sign(
            b"another-secret-another-secret-xx",
            &claims("alerts.list", 1030),
        );
        assert!(verify(SECRET, &token, "alerts.list", BODY, 1000).is_err());
        assert!(verify(SECRET, "garbage", "alerts.list", BODY, 1000).is_err());
        let (payload, _) = sign(SECRET, &claims("alerts.list", 1030))
            .split_once('.')
            .map(|(p, s)| (p.to_owned(), s.to_owned()))
            .unwrap();
        assert!(
            verify(
                SECRET,
                &format!("{payload}.AAAA"),
                "alerts.list",
                BODY,
                1000
            )
            .is_err()
        );
    }

    #[test]
    fn refuses_a_session_with_nobody_in_it() {
        let mut anonymous = claims("alerts.list", 1030);
        anonymous["sub"] = json!("");
        assert!(verify(SECRET, &sign(SECRET, &anonymous), "alerts.list", BODY, 1000).is_err());
        anonymous["scope"] = json!("pinned");
        assert!(verify(SECRET, &sign(SECRET, &anonymous), "alerts.list", BODY, 1000).is_ok());
    }
}
