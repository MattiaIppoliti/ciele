//! Organization API keys, verified here (#1134).
//!
//! The port of `resolveApiKeyContext` in `apps/web/src/lib/api-v1/auth.ts`,
//! for the `/api/v1` endpoints this service answers itself. Same steps, same
//! order, same one refusal for all of them:
//!
//! 1. `Authorization: Bearer ciele_sk_…`, split on single spaces exactly as
//!    `bearerApiKeySecret` splits it;
//! 2. the SHA-256 (hex) of the secret names a stored key, which is not revoked;
//! 3. the Member who minted it still belongs to its Organization;
//! 4. the key acts with the lower of its own Role and its creator's current
//!    one, so a demoted creator's key is demoted with them;
//! 5. `last_used_at` is stamped, before the operation runs and whether or not
//!    it then succeeds. The stamp is best effort, as `.catch(() => {})` makes
//!    it there: a failed stamp is logged and the request goes on.
//!
//! Keys have no expiry column; a key ends by being revoked or by its creator
//! leaving, and both are refused below.

use sha2::{Digest, Sha256};
use sqlx::PgPool;

use crate::assertion::Role;
use crate::error::ApiError;

/// `API_KEY_PREFIX` in `packages/core/src/api-keys.ts`.
pub const PREFIX: &str = "ciele_sk_";

/// Who a valid key acts as.
#[derive(Debug, Clone)]
pub struct KeyContext {
    pub organization_id: String,
    pub role: Role,
    /// What the key may do (ADR-0028): its Role's Capabilities intersected
    /// with its creator's. `None` when either has no Role row yet, and the
    /// role decides, as before Roles.
    pub caps: Option<Vec<String>>,
    pub key_id: String,
    /// The Member who minted the key, the `userId` its operations run as.
    pub actor_user_id: String,
}

/// `bearerApiKeySecret`: the secret, when the header is exactly
/// `<bearer, any case> <ciele_sk_…>`.
pub fn bearer_secret(header: Option<&str>) -> Option<&str> {
    let mut parts = header.unwrap_or("").split(' ');
    let scheme = parts.next()?;
    let secret = parts.next()?;
    let well_formed = scheme.eq_ignore_ascii_case("bearer")
        && !secret.is_empty()
        && parts.next().is_none()
        && secret.starts_with(PREFIX);
    well_formed.then_some(secret)
}

/// `hashApiKeySecret`: hex SHA-256 of the secret's UTF-8 bytes.
pub fn hash(secret: &str) -> String {
    Sha256::digest(secret.as_bytes())
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

/// The lower of the two Roles, `memberRoleRank(creator) < memberRoleRank(key)`.
pub fn effective_role(key: Role, creator: Role) -> Role {
    key.min(creator)
}

/// The stored key and its creator's current Role, as one lookup reads them.
#[derive(sqlx::FromRow)]
struct KeyRow {
    id: String,
    organization_id: String,
    role: String,
    created_by: Option<String>,
    revoked: bool,
    /// `None` when the creator no longer belongs to the key's Organization.
    creator_role: Option<String>,
    /// The key's Role's Capabilities, and its creator's (ADR-0028).
    key_caps: Option<Vec<String>>,
    creator_caps: Option<Vec<String>>,
}

/// `None` is the 401: no such key, revoked, or its creator is gone. A database
/// failure in the lookup is an error, as it throws on the TypeScript side.
pub async fn authenticate(pool: &PgPool, secret: &str) -> Result<Option<KeyContext>, ApiError> {
    // As `service_role`, the client `getApiV1Db` uses, in a transaction of its
    // own that commits before the operation's begins.
    let mut tx = crate::scope::begin_service(pool).await?;
    let row: Option<KeyRow> = sqlx::query_as(
        "select k.id::text as id, k.organization_id::text as organization_id, k.role::text as role, \
                k.created_by::text as created_by, k.revoked_at is not null as revoked, \
                (select m.role::text from public.organization_members m \
                  where m.organization_id = k.organization_id and m.user_id = k.created_by) as creator_role, \
                (select r.capabilities from public.org_roles r where r.id = k.role_id) as key_caps, \
                (select r.capabilities from public.organization_members m join public.org_roles r on r.id = m.role_id \
                  where m.organization_id = k.organization_id and m.user_id = k.created_by) as creator_caps \
         from public.organization_api_keys k where k.secret_hash = $1",
    )
    .bind(hash(secret))
    .fetch_optional(&mut *tx)
    .await?;
    tx.commit().await?;

    let Some(row) = row else {
        return Ok(None);
    };
    let (Some(actor_user_id), Some(creator_role)) = (row.created_by, row.creator_role) else {
        return Ok(None);
    };
    if row.revoked {
        return Ok(None);
    }
    let (Some(key_role), Some(creator_role)) = (parse_role(&row.role), parse_role(&creator_role))
    else {
        // A Role this build does not know: refused rather than ranked, as
        // `roleAllowsCapability` refuses a capability it does not know.
        return Ok(None);
    };
    stamp(pool, &row.id).await;
    let caps = match (row.key_caps, row.creator_caps) {
        (Some(key), Some(creator)) => Some(
            key.into_iter()
                .filter(|cap| creator.contains(cap))
                .collect(),
        ),
        _ => None,
    };
    Ok(Some(KeyContext {
        organization_id: row.organization_id,
        role: effective_role(key_role, creator_role),
        caps,
        key_id: row.id,
        actor_user_id,
    }))
}

/// `touchApiKeyLastUsed(key.id).catch(() => {})`: best effort, before the
/// operation runs. A stamp that fails is logged and the request goes on, as
/// the TypeScript route swallows it, because a key that works must not stop
/// working over a bookkeeping column.
async fn stamp(pool: &PgPool, key_id: &str) {
    // The id was read from the table a moment ago, so it is a uuid; checked
    // anyway, because it is spliced into the statement below.
    if !is_uuid(key_id) {
        tracing::warn!(key_id, "not stamping a key whose id is not a uuid");
        return;
    }
    // One simple-protocol query string is one implicit transaction: `set local`
    // holds for the update, and a failure rolls both back and leaves the
    // connection idle, so the next request on it starts clean.
    let statement = format!(
        "set local role service_role; \
         update public.organization_api_keys set last_used_at = now() where id = '{key_id}'"
    );
    if let Err(error) = sqlx::raw_sql(&statement).execute(pool).await {
        tracing::warn!(key_id, %error, "could not stamp the API key's last use");
    }
}

fn is_uuid(text: &str) -> bool {
    text.len() == 36
        && text.char_indices().all(|(i, c)| match i {
            8 | 13 | 18 | 23 => c == '-',
            _ => c.is_ascii_hexdigit(),
        })
}

fn parse_role(text: &str) -> Option<Role> {
    serde_json::from_value(serde_json::Value::String(text.to_owned())).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_header_as_bearer_api_key_secret_does() {
        let key = "ciele_sk_abc";
        assert_eq!(bearer_secret(Some("Bearer ciele_sk_abc")), Some(key));
        assert_eq!(bearer_secret(Some("bEaReR ciele_sk_abc")), Some(key));
        for refused in [
            None,
            Some(""),
            Some("Bearer"),
            Some("Bearer "),
            Some("Bearer  ciele_sk_abc"),
            Some("Bearer ciele_sk_abc "),
            Some("Bearer ciele_sk_abc extra"),
            Some("Basic ciele_sk_abc"),
            Some("Bearer sk_abc"),
            Some("ciele_sk_abc"),
        ] {
            assert_eq!(bearer_secret(refused), None, "{refused:?}");
        }
    }

    #[test]
    fn hashes_as_hash_api_key_secret_does() {
        // createHash("sha256").update("ciele_sk_test").digest("hex")
        assert_eq!(
            hash("ciele_sk_test"),
            "22af4e0848af833f1b6c7fac8f5e2d74c68a3989f8f7325d98ca21520fb91937"
        );
        assert_eq!(
            hash(""),
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
    }

    #[test]
    fn splices_only_a_uuid_into_the_stamp() {
        assert!(is_uuid("1a82d34b-874e-4f89-82e0-8480810acc82"));
        for refused in [
            "",
            "1a82d34b874e4f8982e08480810acc82",
            "1a82d34b-874e-4f89-82e0-8480810acc8'",
            "1a82d34b-874e-4f89-82e0-8480810acc82; drop",
        ] {
            assert!(!is_uuid(refused), "{refused}");
        }
    }

    #[test]
    fn a_key_acts_with_the_lower_of_its_role_and_its_creators() {
        assert_eq!(effective_role(Role::Admin, Role::Viewer), Role::Viewer);
        assert_eq!(effective_role(Role::Editor, Role::Owner), Role::Editor);
    }
}
