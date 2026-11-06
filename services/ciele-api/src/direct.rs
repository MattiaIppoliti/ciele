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

use std::collections::HashMap;

use axum::Json;
use axum::body::Bytes;
use axum::extract::{RawQuery, State};
use axum::http::{HeaderMap, Method, StatusCode};
use axum::response::{IntoResponse, Response};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use sqlx::Row;

use crate::AppState;
use crate::error::ApiError;
use crate::improvements::{COUNTS_JSON, LIST_ITEM_JSON, finalize_page};
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
/// the same statement, so a good key costs no extra round trip. `caller` adds
/// the Role the key acts with: its own, capped at its creator's current one,
/// as `resolveApiKeyContext` caps it.
const KEYED: &str = "with k as ( \
       select id, organization_id, created_by, role, role_id from public.organization_api_keys \
       where secret_hash = $1 and revoked_at is null \
     ), member as ( \
       select om.role::text as role, om.role_id from public.organization_members om, k \
       where om.organization_id = k.organization_id and om.user_id = k.created_by \
     ), touched as ( \
       update public.organization_api_keys set last_used_at = now() \
       where id = (select id from k) and exists (select 1 from member) \
       returning organization_id \
     ), caller as ( \
       select t.organization_id, k.id as key_id, \
         case when (case m.role when 'owner' then 4 when 'admin' then 3 when 'editor' then 2 when 'viewer' then 1 else 0 end) \
                 < (case k.role when 'owner' then 4 when 'admin' then 3 when 'editor' then 2 when 'viewer' then 1 else 0 end) \
              then m.role else k.role end as role, \
         (select array_agg(c) from (select unnest(kr.capabilities) as c \
            intersect select unnest(mr.capabilities)) x) as caps \
       from touched t, k, member m \
       left join public.org_roles kr on kr.id = (select role_id from k) \
       left join public.org_roles mr on mr.id = m.role_id \
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

/// Runs one keyed statement over the simple protocol, `$1` replaced with the
/// key's hash and `$2`, `$3` with `args`. Every value is ours to splice: the
/// hash is hex this service computed, the rest are integers. The simple
/// protocol is what leaves the connection idle when the statement fails (a
/// refused stamp, say), so the operation path can answer next on it.
async fn keyed(
    pool: &sqlx::PgPool,
    sql: &str,
    hash: &str,
    args: &[Option<i64>],
) -> Result<(bool, Value), sqlx::Error> {
    debug_assert!(hash.chars().all(|c| c.is_ascii_hexdigit()));
    let mut sql = sql.replace("$1", &format!("'{hash}'"));
    for (at, arg) in args.iter().enumerate().rev() {
        let literal = arg.map_or_else(|| "null".to_owned(), |n| n.to_string());
        sql = sql.replace(&format!("${}", at + 2), &literal);
    }
    let row = sqlx::raw_sql(&sql).fetch_one(pool).await?;
    Ok((row.try_get(0)?, row.try_get(1)?))
}

/// One statement answering `(authorized, rows)`.
fn answer((authorized, rows): (bool, Value)) -> Result<Value, ApiError> {
    if authorized {
        Ok(rows)
    } else {
        Err(ApiError::unauthorized_key())
    }
}

/// A direct answer, or the operation path's (`v1.rs`) for the same request
/// when the one statement failed. A trigger refusing the `last_used_at` stamp
/// fails the whole statement here, where the route only logs it and answers.
async fn or_operation(
    answer: Result<Json<Value>, ApiError>,
    path: &str,
    state: AppState,
    query: Option<String>,
    headers: HeaderMap,
) -> Response {
    match answer {
        Err(error) if error.status == StatusCode::INTERNAL_SERVER_ERROR => {
            operation(path, state, query, headers).await
        }
        answer => answer.into_response(),
    }
}

/// The operation path's answer for a direct read.
async fn operation(
    path: &str,
    state: AppState,
    query: Option<String>,
    headers: HeaderMap,
) -> Response {
    let endpoint = crate::v1::ENDPOINTS
        .iter()
        .find(|endpoint| endpoint.method == Method::GET && endpoint.path == path)
        .expect("every direct read is a registered endpoint");
    crate::v1::handle(
        endpoint,
        state,
        HashMap::new(),
        query,
        headers,
        Bytes::new(),
    )
    .await
}

/// `GET /api/v1/alerts`: `{ "data": [Alert…] }`, newest first.
pub async fn alerts(
    State(state): State<AppState>,
    RawQuery(query): RawQuery,
    headers: HeaderMap,
) -> Response {
    let answer = alerts_statement(&state, &headers).await;
    or_operation(answer, "/alerts", state, query, headers).await
}

async fn alerts_statement(state: &AppState, headers: &HeaderMap) -> Result<Json<Value>, ApiError> {
    let hash = key_hash(headers)?;
    let sql = format!(
        "{KEYED} select exists (select 1 from touched), \
           (select coalesce(jsonb_agg(to_jsonb(a) order by a.detected_at desc), '[]'::jsonb) \
            from (select * from public.alerts \
                  where organization_id = (select organization_id from touched) \
                  order by detected_at desc limit $2) a)"
    );
    let rows = answer(keyed(&state.direct_pool, &sql, &hash, &[Some(POSTGREST_MAX_ROWS)]).await?)?;
    Ok(Json(json!({ "data": camelize_all(rows) })))
}

/// `GET /api/v1/task-labels`: `{ "data": [TaskLabel…] }`, by name.
pub async fn task_labels(
    State(state): State<AppState>,
    RawQuery(query): RawQuery,
    headers: HeaderMap,
) -> Response {
    let answer = task_labels_statement(&state, &headers).await;
    or_operation(answer, "/task-labels", state, query, headers).await
}

async fn task_labels_statement(
    state: &AppState,
    headers: &HeaderMap,
) -> Result<Json<Value>, ApiError> {
    let hash = key_hash(headers)?;
    let sql = format!(
        "{KEYED} select exists (select 1 from touched), \
           (select coalesce(jsonb_agg(to_jsonb(l) order by l.name, l.id), '[]'::jsonb) \
            from public.task_labels l \
            where l.organization_id = (select organization_id from touched))"
    );
    let rows = answer(keyed(&state.direct_pool, &sql, &hash, &[]).await?)?;
    Ok(Json(json!({ "data": camelize_all(rows) })))
}

/// `GET /api/v1/whoami`: the key's Organization, Role and id.
pub async fn whoami(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Value>, ApiError> {
    let hash = key_hash(&headers)?;
    let sql = format!(
        "{KEYED} select exists (select 1 from touched), \
           coalesce((select jsonb_build_object('organizationId', organization_id, 'role', role, 'keyId', key_id) \
            from caller), 'null'::jsonb)"
    );
    let who = answer(keyed(&state.direct_pool, &sql, &hash, &[]).await?)?;
    Ok(Json(who))
}

/// `GET /api/v1/skills`: `{ "data": [Skill…] }`, oldest first.
pub async fn skills(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Value>, ApiError> {
    let hash = key_hash(&headers)?;
    let sql = format!(
        "{KEYED} select exists (select 1 from touched), \
           (select coalesce(jsonb_agg(to_jsonb(s) order by s.created_at, s.id), '[]'::jsonb) \
            from public.skills s \
            where s.organization_id = (select organization_id from touched))"
    );
    let rows = answer(keyed(&state.direct_pool, &sql, &hash, &[]).await?)?;
    Ok(Json(json!({ "data": camelize_all(rows) })))
}

/// `Boolean(value)` over a JSON value.
const JS_TRUTHY: &str = "case jsonb_typeof(v) \
       when 'string' then (v #>> '{}') <> '' \
       when 'boolean' then v::text::boolean \
       when 'number' then v::text::numeric <> 0 \
       when 'null' then false \
       when 'object' then true when 'array' then true \
       else false end";

/// `GET /api/v1/help-desks`: `{ "data": [HelpDeskView…] }`, by name. The
/// ticketing integration leaves as `publicHelpDesk` shapes it: its id,
/// platform, name and connection time, and whether credentials are stored,
/// never the credentials. A key the integration lacks stays absent, as
/// `JSON.stringify` drops an `undefined`; so does `ticketingTarget` on a
/// database that predates its column.
pub async fn help_desks(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Value>, ApiError> {
    let hash = key_hash(&headers)?;
    let truthy = |path: &str| JS_TRUTHY.replace('v', &format!("(ti->'config'->'{path}')"));
    let sql = format!(
        "{KEYED} select exists (select 1 from touched), \
           (select coalesce(jsonb_agg(desk order by name), '[]'::jsonb) from ( \
              select d.name, jsonb_build_object( \
                'id', d.id, 'organizationId', d.organization_id, 'name', d.name, \
                'description', coalesce(d.description, ''), \
                'autoGenerateImprovements', coalesce(d.auto_generate_improvements, false), \
                'ticketingIntegration', case when ti is null or jsonb_typeof(ti) = 'null' then null else \
                  coalesce((select jsonb_object_agg(key, ti->key) from unnest(array['id','platform','name','connectedAt']) key \
                            where ti ? key), '{{}}'::jsonb) \
                  || jsonb_build_object('hasCredentials', ({secret}) or ({password})) end, \
                'createdAt', d.created_at, 'updatedAt', coalesce(d.updated_at, d.created_at)) \
                || case when to_jsonb(d) ? 'ticketing_target' \
                   then jsonb_build_object('ticketingTarget', to_jsonb(d)->'ticketing_target') \
                   else '{{}}'::jsonb end as desk \
              from public.help_desks d, lateral (select d.ticketing_integration as ti) t \
              where d.organization_id = (select organization_id from touched)) desks)",
        secret = truthy("clientSecret"),
        password = truthy("password"),
    );
    let rows = answer(keyed(&state.direct_pool, &sql, &hash, &[]).await?)?;
    Ok(Json(json!({ "data": rows })))
}

/// `GET /api/v1/invites`: `{ "data": [Invite…] }`, pending, newest first.
/// Needs `manageMembers` (admin or owner), refused with
/// `requireApiCapability`'s 403 otherwise.
pub async fn invites(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Value>, ApiError> {
    let hash = key_hash(&headers)?;
    let sql = format!(
        "{KEYED} select exists (select 1 from touched), \
           jsonb_build_object('role', (select role from caller), 'caps', (select to_jsonb(caps) from caller), 'rows', \
             (select coalesce(jsonb_agg(to_jsonb(i) || jsonb_build_object('role_name', \
                 coalesce(r.name, case i.role::text when 'support_agent' then 'Support Agent' else initcap(i.role::text) end)) \
                 order by i.created_at desc), '[]'::jsonb) \
              from public.organization_invites i \
              left join public.org_roles r on r.id = i.role_id \
              where i.organization_id = (select organization_id from touched) \
                and i.accepted_at is null))"
    );
    let answered = answer(keyed(&state.direct_pool, &sql, &hash, &[]).await?)?;
    // The key's Capabilities when its Role and its creator's have rows
    // (ADR-0028), else the tier as before.
    let allowed = match answered["caps"].as_array() {
        Some(caps) => caps.iter().any(|cap| cap == "members:manage"),
        None => matches!(answered["role"].as_str().unwrap_or(""), "admin" | "owner"),
    };
    if !allowed {
        return Err(ApiError::forbidden_capability("members:manage"));
    }
    Ok(Json(
        json!({ "data": camelize_all(answered["rows"].clone()) }),
    ))
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

/// The query parameters `apps/web/src/app/api/v1/improvements/route.ts` reads
/// besides `limit` and `cursor`.
const IMPROVEMENT_FILTER_PARAMS: [&str; 6] = [
    "search",
    "status",
    "priority",
    "projectId",
    "assistantId",
    "assigneeId",
];

/// `GET /api/v1/improvements`: `{ "data": [ImprovementListItem…],
/// "nextCursor", "counts" }`, newest key first, one page. Served here in one
/// statement when unfiltered; a filtered request runs the operation.
pub async fn improvements(
    State(state): State<AppState>,
    RawQuery(query): RawQuery,
    headers: HeaderMap,
) -> Response {
    let pairs: Vec<(String, String)> =
        form_urlencoded::parse(query.as_deref().unwrap_or("").as_bytes())
            .into_owned()
            .collect();
    // zod refuses an empty cursor after the key check, in its own words. A
    // filter or a lane also takes the operation path: its parameters need
    // zod's wording when malformed, and its predicate is
    // `public.matching_improvements`, which `improvements::list_page` reads.
    let filtered = pairs
        .iter()
        .any(|(key, _)| IMPROVEMENT_FILTER_PARAMS.contains(&key.as_str()));
    if filtered || list_params(&pairs).1.as_deref() == Some("") {
        return operation("/improvements", state, query, headers).await;
    }
    let answer = improvements_statement(&state, &headers, &pairs).await;
    or_operation(answer, "/improvements", state, query, headers).await
}

async fn improvements_statement(
    state: &AppState,
    headers: &HeaderMap,
    query: &[(String, String)],
) -> Result<Json<Value>, ApiError> {
    let hash = key_hash(headers)?;
    let (limit, cursor) = list_params(query);
    let before_seq = cursor.as_deref().and_then(js_number_to_safe_integer);
    let sql = format!(
        "{KEYED} select exists (select 1 from touched), jsonb_build_object( \
           'items', (select coalesce(jsonb_agg(item order by seq desc), '[]'::jsonb) from ( \
              select {LIST_ITEM_JSON} as item, i.seq from public.improvements i \
              where i.organization_id = (select organization_id from touched) \
                and ($2::bigint is null or i.seq < $2) \
              order by i.seq desc limit $3) page), \
           'counts', (select {COUNTS_JSON} from public.improvements i \
              where i.organization_id = (select organization_id from touched)))"
    );
    let answered = answer(
        keyed(
            &state.direct_pool,
            &sql,
            &hash,
            &[before_seq, Some(limit + 1)],
        )
        .await?,
    )?;
    let page = finalize_page(answered["items"].clone(), limit as usize);
    Ok(Json(json!({
        "data": page["items"],
        "nextCursor": page["nextCursor"],
        "counts": answered["counts"],
    })))
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
