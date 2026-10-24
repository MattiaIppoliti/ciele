//! `alerts.list`, `alerts.resolve` and `alerts.update`, the ports of the
//! operations in `packages/ops/src/configuration.ts` (#1121).
//!
//! Each returns what the TypeScript operation returns, byte for byte where the
//! database decides it: rows leave Postgres through `to_jsonb`, which formats
//! timestamps the way PostgREST does, and [`camelize`](crate::rows::camelize) applies the same
//! top-level key rename as `rowToDomain`. The parity test in
//! `packages/ops/src/rust-parity.test.ts` holds both sides to that.

use serde::Deserialize;
use serde_json::{Map, Value};
use sqlx::PgConnection;

use crate::assertion::Claims;
use crate::error::ApiError;
use crate::input::{parse, parse_object, present, require_id};
use crate::js::{js_length, js_trim};
use crate::rows::{POSTGREST_MAX_ROWS, camelize, camelize_all};

const TYPES: [&str; 6] = [
    "integration",
    "crawl",
    "provider",
    "ingestion",
    "knowledge",
    "system",
];
const STATUSES: [&str; 2] = ["active", "resolved"];

/// Newest first, and no more than PostgREST hands the TypeScript body.
pub async fn list(conn: &mut PgConnection, claims: &Claims) -> Result<Value, ApiError> {
    let rows: Value = sqlx::query_scalar(
        "select coalesce(jsonb_agg(to_jsonb(a) order by a.detected_at desc), '[]'::jsonb) \
         from (select * from public.alerts where organization_id = $1::uuid \
               order by detected_at desc limit $2) a",
    )
    .bind(&claims.org)
    .bind(POSTGREST_MAX_ROWS)
    .fetch_one(&mut *conn)
    .await?;
    Ok(camelize_all(rows))
}

#[derive(Deserialize)]
struct ResolveInput {
    id: String,
}

pub async fn resolve(
    conn: &mut PgConnection,
    claims: &Claims,
    input: Value,
) -> Result<Value, ApiError> {
    let ResolveInput { id } = parse(input)?;
    require_id(&id)?;
    require_visible(conn, claims, &id).await?;
    let row: Value = sqlx::query_scalar(
        "update public.alerts a \
         set status = 'resolved', resolved_at = now(), resolved_by = $3::uuid \
         where a.id = $1 and a.organization_id = $2::uuid \
         returning to_jsonb(a)",
    )
    .bind(&id)
    .bind(&claims.org)
    .bind(claims.actor())
    .fetch_one(&mut *conn)
    .await?;
    Ok(camelize(row))
}

#[derive(Deserialize)]
struct UpdateInput {
    id: String,
    patch: Map<String, Value>,
}

/// Strict, like the zod schema: a key outside these four is refused.
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Patch {
    #[serde(rename = "type", default, deserialize_with = "present")]
    kind: Option<String>,
    #[serde(default, deserialize_with = "present")]
    title: Option<String>,
    #[serde(default, deserialize_with = "present")]
    detail: Option<String>,
    #[serde(default, deserialize_with = "present")]
    status: Option<String>,
}

impl Patch {
    fn validate(mut self) -> Result<Self, ApiError> {
        if let Some(kind) = &self.kind
            && !TYPES.contains(&kind.as_str())
        {
            return Err(ApiError::invalid_input("Invalid alert type"));
        }
        if let Some(status) = &self.status
            && !STATUSES.contains(&status.as_str())
        {
            return Err(ApiError::invalid_input("Invalid alert status"));
        }
        if let Some(title) = self.title.take() {
            let title = js_trim(&title).to_owned();
            let length = js_length(&title);
            if length == 0 || length > 500 {
                return Err(ApiError::invalid_input("Title must be 1 to 500 characters"));
            }
            self.title = Some(title);
        }
        if self
            .detail
            .as_deref()
            .is_some_and(|detail| js_length(detail) > 10_000)
        {
            return Err(ApiError::invalid_input(
                "Detail must be at most 10000 characters",
            ));
        }
        Ok(self)
    }
}

pub async fn update(
    conn: &mut PgConnection,
    claims: &Claims,
    input: Value,
) -> Result<Value, ApiError> {
    let UpdateInput { id, patch } = parse(input)?;
    require_id(&id)?;
    let patch = parse_object::<Patch>(patch)?.validate()?;
    require_visible(conn, claims, &id).await?;
    // A status in the patch moves the resolution stamp with it, as `updateAlert` does.
    let row: Value = sqlx::query_scalar(
        "update public.alerts a set \
           type = coalesce($3, a.type), \
           title = coalesce($4, a.title), \
           detail = coalesce($5, a.detail), \
           status = coalesce($6, a.status), \
           resolved_at = case when $6::text is null then a.resolved_at \
                              when $6 = 'resolved' then now() else null end, \
           resolved_by = case when $6::text is null then a.resolved_by \
                              when $6 = 'resolved' then $7::uuid else null end \
         where a.id = $1 and a.organization_id = $2::uuid \
         returning to_jsonb(a)",
    )
    .bind(&id)
    .bind(&claims.org)
    .bind(patch.kind)
    .bind(patch.title)
    .bind(patch.detail)
    .bind(patch.status)
    .bind(claims.actor())
    .fetch_one(&mut *conn)
    .await?;
    Ok(camelize(row))
}

/// The TypeScript operations look the id up in the caller's own list first,
/// so another Organization's Alert and a missing one answer the same.
async fn require_visible(
    conn: &mut PgConnection,
    claims: &Claims,
    id: &str,
) -> Result<(), ApiError> {
    let found: bool = sqlx::query_scalar(
        "select exists (select 1 from (select id from public.alerts where organization_id = $2::uuid order by detected_at desc limit $3) visible where id = $1)",
    )
    .bind(id)
    .bind(&claims.org)
    .bind(POSTGREST_MAX_ROWS)
    .fetch_one(&mut *conn)
    .await?;
    if found {
        Ok(())
    } else {
        Err(ApiError::not_found("Alert not found"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn validates_a_patch_like_the_zod_schema() {
        let patch = |value: Value| {
            parse::<Patch>(value)
                .map_err(|_| ())
                .and_then(|p| p.validate().map_err(|_| ()))
        };
        assert_eq!(
            patch(json!({ "title": "  Crawl failed \u{feff}" }))
                .unwrap()
                .title
                .as_deref(),
            Some("Crawl failed")
        );
        assert!(patch(json!({ "title": "   " })).is_err());
        assert!(patch(json!({ "title": "x".repeat(501) })).is_err());
        // Two UTF-16 code units each, so 5001 of them is over the limit.
        assert!(patch(json!({ "detail": "😀".repeat(5001) })).is_err());
        assert!(patch(json!({ "type": "billing" })).is_err());
        assert!(patch(json!({ "status": "snoozed" })).is_err());
        assert!(patch(json!({ "sourceKey": "x" })).is_err());
        assert!(patch(json!({ "title": null })).is_err());
        // JavaScript's trim keeps NEL, so this title is one character long.
        assert!(patch(json!({ "title": "\u{85}" })).is_ok());
        assert!(patch(json!({ "type": "knowledge", "status": "resolved" })).is_ok());
    }
}
