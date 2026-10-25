//! Public `/api/v1` reads served by the service itself, with no web function
//! in front (map #1111, #1126).
//!
//! Behind the forwarding seam a read cannot beat TypeScript: the web app still
//! authenticates the key and then pays a hop to reach this service. Served
//! here, the whole request is one SQL statement, which checks the key, stamps
//! `last_used_at` and reads the rows. The TypeScript route makes three
//! PostgREST round trips before its operation runs.
//!
//! The key is checked the way `apps/web/src/lib/api-v1/auth.ts` checks it:
//!
//! - the same `Bearer ciele_sk_…` header, refused otherwise;
//! - the same SHA-256 hex lookup;
//! - a revoked key refused;
//! - a key whose creator is no longer a member refused.
//!
//! All four answer the same 401 with the same body.
//!
//! These statements run on `AppState::direct_pool`, whose connections are
//! `service_role` for their whole session, so a request needs no `BEGIN` and
//! no `SET LOCAL`. Every statement filters on the key's own Organization,
//! exactly as the org-pinned Db does.

use axum::Json;
use axum::extract::{Query, State};
use axum::http::HeaderMap;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};

use crate::AppState;
use crate::error::ApiError;
use crate::improvements::{LIST_ITEM_JSON, finalize_page};
use crate::js::{js_number, js_number_to_safe_integer};
use crate::rows::{POSTGREST_MAX_ROWS, camelize_all};

const API_KEY_PREFIX: &str = "ciele_sk_";

/// `bearerApiKeySecret`: exactly `<scheme> <secret>`, split on single spaces,
/// scheme `bearer` in any case, secret with the key prefix.
pub fn bearer_secret(header: Option<&str>) -> Option<&str> {
    let mut parts = header.unwrap_or("").split(' ');
    let scheme = parts.next()?;
    let secret = parts.next()?;
    let well_formed = scheme.to_lowercase() == "bearer"
        && !secret.is_empty()
        && parts.next().is_none()
        && secret.starts_with(API_KEY_PREFIX);
    well_formed.then_some(secret)
}

/// `hashApiKeySecret`.
fn hash_secret(secret: &str) -> String {
    Sha256::digest(secret.as_bytes())
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

/// The prefix every direct statement shares. `$1` is the key's hash; `touched`
/// holds the key's Organization when, and only when, the key is good: found,
/// not revoked, and its creator still a member. Stamping `last_used_at` is in
/// the same statement, so a good key costs no extra round trip.
const KEYED: &str = "with k as ( \
       select id, organization_id, created_by from public.organization_api_keys \
       where secret_hash = $1 and revoked_at is null \
     ), member as ( \
       select 1 from public.organization_members om, k \
       where om.organization_id = k.organization_id and om.user_id = k.created_by \
     ), touched as ( \
       update public.organization_api_keys set last_used_at = now() \
       where id = (select id from k) and exists (select 1 from member) \
       returning organization_id \
     ) ";

fn key_hash(headers: &HeaderMap) -> Result<String, ApiError> {
    bearer_secret(
        headers
            .get("authorization")
            .and_then(|value| value.to_str().ok()),
    )
    .map(hash_secret)
    .ok_or_else(ApiError::unauthorized_key)
}

/// One statement answering `(authorized, rows)`.
fn answer((authorized, rows): (bool, Value)) -> Result<Value, ApiError> {
    if authorized {
        Ok(rows)
    } else {
        Err(ApiError::unauthorized_key())
    }
}

/// `GET /api/v1/alerts`: `{ "data": [Alert…] }`, newest first.
pub async fn alerts(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Value>, ApiError> {
    let hash = key_hash(&headers)?;
    let sql = format!(
        "{KEYED} select exists (select 1 from touched), \
           (select coalesce(jsonb_agg(to_jsonb(a) order by a.detected_at desc), '[]'::jsonb) \
            from (select * from public.alerts \
                  where organization_id = (select organization_id from touched) \
                  order by detected_at desc limit $2) a)"
    );
    let rows = answer(
        sqlx::query_as(&sql)
            .bind(hash)
            .bind(POSTGREST_MAX_ROWS)
            .fetch_one(&state.direct_pool)
            .await?,
    )?;
    Ok(Json(json!({ "data": camelize_all(rows) })))
}

/// `GET /api/v1/task-labels`: `{ "data": [TaskLabel…] }`, by name.
pub async fn task_labels(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Value>, ApiError> {
    let hash = key_hash(&headers)?;
    let sql = format!(
        "{KEYED} select exists (select 1 from touched), \
           (select coalesce(jsonb_agg(to_jsonb(l) order by l.name, l.id), '[]'::jsonb) \
            from public.task_labels l \
            where l.organization_id = (select organization_id from touched))"
    );
    let rows = answer(
        sqlx::query_as(&sql)
            .bind(hash)
            .fetch_one(&state.direct_pool)
            .await?,
    )?;
    Ok(Json(json!({ "data": camelize_all(rows) })))
}

/// `parseListParams`: `?limit=` read by `Number`, truncated and clamped to
/// [1, 100], 50 when absent or not a number; `?cursor=` the first one given.
fn list_params(query: &[(String, String)]) -> (i64, Option<String>) {
    let first = |name: &str| {
        query
            .iter()
            .find(|(key, _)| key == name)
            .map(|(_, value)| value.clone())
    };
    let raw = first("limit").map_or(50.0, |value| js_number(&value));
    let limit = if raw.is_finite() {
        raw.trunc().clamp(1.0, 100.0) as i64
    } else {
        50
    };
    (limit, first("cursor"))
}

/// `GET /api/v1/improvements`: `{ "data": [ImprovementListItem…],
/// "nextCursor" }`, newest key first, one page.
pub async fn improvements(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<Vec<(String, String)>>,
) -> Result<Json<Value>, ApiError> {
    let hash = key_hash(&headers)?;
    let (limit, cursor) = list_params(&query);
    // zod refuses an empty cursor; the key is checked first all the same.
    let before_seq = cursor.as_deref().and_then(js_number_to_safe_integer);
    let sql = format!(
        "{KEYED} select exists (select 1 from touched), \
           (select coalesce(jsonb_agg(item order by seq desc), '[]'::jsonb) from ( \
              select {LIST_ITEM_JSON} as item, i.seq from public.improvements i \
              where i.organization_id = (select organization_id from touched) \
                and ($2::bigint is null or i.seq < $2) \
              order by i.seq desc limit $3) page)"
    );
    let rows = answer(
        sqlx::query_as(&sql)
            .bind(hash)
            .bind(before_seq)
            .bind(limit + 1)
            .fetch_one(&state.direct_pool)
            .await?,
    )?;
    if cursor.as_deref() == Some("") {
        return Err(ApiError::invalid_input("cursor must not be empty"));
    }
    let page = finalize_page(rows, limit as usize);
    Ok(Json(
        json!({ "data": page["items"], "nextCursor": page["nextCursor"] }),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_bearer_header_the_way_the_web_app_does() {
        assert_eq!(
            bearer_secret(Some("Bearer ciele_sk_abc")),
            Some("ciele_sk_abc")
        );
        assert_eq!(
            bearer_secret(Some("bEaReR ciele_sk_abc")),
            Some("ciele_sk_abc")
        );
        assert_eq!(bearer_secret(Some("Bearer  ciele_sk_abc")), None);
        assert_eq!(bearer_secret(Some("Bearer ciele_sk_abc extra")), None);
        assert_eq!(bearer_secret(Some("Bearer sk_abc")), None);
        assert_eq!(bearer_secret(Some("Basic ciele_sk_abc")), None);
        assert_eq!(bearer_secret(Some("Bearer")), None);
        assert_eq!(bearer_secret(None), None);
    }

    #[test]
    fn hashes_like_hash_api_key_secret() {
        // createHash("sha256").update("ciele_sk_test").digest("hex"), from Node.
        assert_eq!(
            hash_secret("ciele_sk_test"),
            "22af4e0848af833f1b6c7fac8f5e2d74c68a3989f8f7325d98ca21520fb91937"
        );
    }

    #[test]
    fn reads_list_params_like_parse_list_params() {
        let q = |pairs: &[(&str, &str)]| {
            list_params(
                &pairs
                    .iter()
                    .map(|(k, v)| (k.to_string(), v.to_string()))
                    .collect::<Vec<_>>(),
            )
        };
        assert_eq!(q(&[]), (50, None));
        assert_eq!(q(&[("limit", "2.7")]), (2, None));
        assert_eq!(q(&[("limit", "0")]), (1, None));
        assert_eq!(q(&[("limit", "500")]), (100, None));
        assert_eq!(q(&[("limit", "abc")]), (50, None));
        assert_eq!(q(&[("limit", "")]), (1, None));
        assert_eq!(
            q(&[("cursor", "7"), ("cursor", "9")]),
            (50, Some("7".into()))
        );
    }
}
