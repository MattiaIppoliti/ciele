//! Opening a transaction as the caller.
//!
//! The web app reaches Postgres two ways, and an operation here has to see
//! exactly what it would have seen there:
//!
//! - **Session** (the console): PostgREST runs the query as `authenticated`
//!   with the Member's JWT claims, so RLS decides. The transaction does the
//!   same with `set local`, so the settings end with it and a pooled
//!   connection carries nothing into the next request.
//! - **Pinned** (an API key): the service role, which bypasses RLS. The
//!   org-pinned `Db` is what keeps such a call inside one Organization, and
//!   here that is every query filtering on `organization_id` itself.
//!
//! Both GUC spellings are set: `request.jwt.claims` is what current Supabase
//! reads, `request.jwt.claim.sub` what older `auth.uid()` bodies read.
//!
//! The claims are [`SESSION_CLAIMS`] and nothing else: a Member's real JWT
//! carries more (`app_metadata`, `user_metadata`, `session_id`, ...), which the
//! web app does not have to sign. No policy reads them today, and a test below
//! fails when a migration starts to.

use serde_json::{Map, Value, json};
use sqlx::{PgPool, Postgres, Transaction};

use crate::assertion::{Claims, DbScope};
use crate::error::ApiError;

/// The JWT claims a session transaction carries.
pub const SESSION_CLAIMS: [&str; 4] = ["sub", "role", "aud", "email"];

fn session_claims(claims: &Claims) -> Value {
    let mut jwt = Map::new();
    jwt.insert("sub".into(), json!(claims.sub));
    jwt.insert("role".into(), json!("authenticated"));
    jwt.insert("aud".into(), json!("authenticated"));
    if let Some(email) = &claims.email {
        jwt.insert("email".into(), json!(email));
    }
    Value::Object(jwt)
}

pub async fn begin(
    pool: &PgPool,
    claims: &Claims,
) -> Result<Transaction<'static, Postgres>, ApiError> {
    let mut tx = pool.begin().await?;
    match claims.scope {
        DbScope::Session => {
            sqlx::query(
                "select set_config('request.jwt.claims', $1, true), \
                        set_config('request.jwt.claim.sub', $2, true), \
                        set_config('request.jwt.claim.role', 'authenticated', true), \
                        set_config('request.jwt.claim.email', $3, true)",
            )
            .bind(session_claims(claims).to_string())
            .bind(&claims.sub)
            .bind(claims.email.as_deref().unwrap_or(""))
            .execute(&mut *tx)
            .await?;
            sqlx::query("set local role authenticated")
                .execute(&mut *tx)
                .await?;
        }
        DbScope::Pinned => {
            sqlx::query("set local role service_role")
                .execute(&mut *tx)
                .await?;
        }
    }
    Ok(tx)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    /// Every claim a migration reads, by the three ways a policy can read one.
    fn claims_read_by(sql: &str) -> Vec<String> {
        let sql = sql.to_lowercase();
        let mut read = Vec::new();
        if sql.contains("auth.uid()") {
            read.push("sub".to_owned());
        }
        if sql.contains("auth.role()") {
            read.push("role".to_owned());
        }
        if sql.contains("auth.email()") {
            read.push("email".to_owned());
        }
        for marker in ["auth.jwt()", "request.jwt.claim"] {
            for (at, _) in sql.match_indices(marker) {
                let rest = sql[at + marker.len()..].trim_start();
                // Only the expression right after the marker, not an arrow further on.
                let rest = rest
                    .char_indices()
                    .nth(60)
                    .map_or(rest, |(end, _)| &rest[..end]);
                // `request.jwt.claim.<key>` names the key in the setting itself;
                // `auth.jwt() ->> 'key'` and `request.jwt.claims' ...)::jsonb ->> 'key'`
                // name it after an arrow.
                let key = match rest.strip_prefix('.') {
                    Some(tail) => tail
                        .split(|c: char| !(c.is_alphanumeric() || c == '_'))
                        .next(),
                    None => rest
                        .split_once("->")
                        .map(|(_, tail)| tail.trim_start_matches('>').trim_start())
                        .and_then(|tail| tail.strip_prefix('\''))
                        .and_then(|tail| tail.split('\'').next()),
                };
                read.push(key.unwrap_or("<whole token>").to_owned());
            }
        }
        read
    }

    #[test]
    fn reads_claims_the_three_ways() {
        assert_eq!(claims_read_by("using (auth.uid() = user_id)"), ["sub"]);
        assert_eq!(claims_read_by("auth.jwt() ->> 'email'"), ["email"]);
        assert_eq!(
            claims_read_by("(auth.jwt() -> 'app_metadata' ->> 'org')"),
            ["app_metadata"]
        );
        assert_eq!(
            claims_read_by("current_setting('request.jwt.claim.sub', true)"),
            ["sub"]
        );
        assert_eq!(claims_read_by("select auth.jwt()"), ["<whole token>"]);
    }

    /// A session runs the existing policies unchanged only while they read
    /// claims this service sets. A policy reading another one would see null
    /// here and a value through PostgREST, so it fails here first.
    #[test]
    fn every_claim_a_migration_reads_is_one_a_session_sets() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
        let mut unset = Vec::new();
        let mut read = 0;
        for dir in ["supabase/migrations", "ee/migrations"] {
            let Ok(entries) = std::fs::read_dir(root.join(dir)) else {
                assert_eq!(dir, "ee/migrations", "{dir} is missing");
                continue; // `ee/` is not in the public mirror.
            };
            for entry in entries {
                let path = entry.unwrap().path();
                if path.extension().is_none_or(|ext| ext != "sql") {
                    continue;
                }
                read += 1;
                let sql = std::fs::read_to_string(&path).unwrap();
                for claim in claims_read_by(&sql) {
                    if !SESSION_CLAIMS.contains(&claim.as_str()) {
                        unset.push(format!("{}: {claim}", path.display()));
                    }
                }
            }
        }
        assert!(read > 0, "no migrations found under {}", root.display());
        assert!(
            unset.is_empty(),
            "migrations read claims a ciele-api session does not set: {unset:?}"
        );
    }

    #[test]
    fn a_session_carries_the_email_when_the_web_app_signed_one() {
        let claims = |email: Option<&str>| Claims {
            op: "alerts.list".into(),
            org: "o".into(),
            sub: "u".into(),
            email: email.map(Into::into),
            role: crate::assertion::Role::Viewer,
            scope: DbScope::Session,
            body: String::new(),
            exp: 0,
        };
        let with = session_claims(&claims(Some("a@b.c")));
        assert_eq!(with["email"], "a@b.c");
        assert!(session_claims(&claims(None)).get("email").is_none());
        for key in with.as_object().unwrap().keys() {
            assert!(SESSION_CLAIMS.contains(&key.as_str()));
        }
    }
}
