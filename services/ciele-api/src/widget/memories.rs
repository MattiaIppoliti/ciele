//! `GET` and `DELETE memories`: the Memory folder of an SSO-signed end-user
//! (`apps/web/src/app/api/widget/[assistantId]/memories/route.ts`). The
//! subject comes only from the sealed gate; everyone else, and everyone while
//! the Organization's memory is off, gets a 404.

use axum::extract::{Path, RawQuery, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::Response;
use serde_json::{Value, json};

use super::conversations::query_param;
use super::gate::gate_for_org;
use super::publication::{WidgetContext, resolve};
use super::session::memory_enabled;
use super::{WidgetState, now_ms, response};
use crate::rows::POSTGREST_MAX_ROWS;

/// `listMemories`, newest first, `id` breaking a tie, at most a PostgREST page.
const OWN: &str = "select id, text, created_at from public.memories \
                   where organization_id = $1::text::uuid and subject_id = $2 \
                   order by created_at desc, id desc limit $3";

async fn context(
    state: &WidgetState,
    assistant_id: String,
    headers: &HeaderMap,
) -> Result<(WidgetContext, String), Box<Response>> {
    let ctx = resolve(&state.publications, &state.pool, assistant_id, headers).await?;
    let organization_id = ctx.publication.organization_id();
    let Some(gate) = gate_for_org(headers, &state.keys, organization_id, now_ms()) else {
        return Err(Box::new(response::not_found(&ctx.cors)));
    };
    match memory_enabled(&state.pool, organization_id).await {
        Ok(true) => Ok((ctx, gate.subject_id)),
        Ok(false) => Err(Box::new(response::not_found(&ctx.cors))),
        Err(error) => Err(Box::new(response::internal(&error))),
    }
}

pub async fn list(
    State(state): State<WidgetState>,
    Path(assistant_id): Path<String>,
    headers: HeaderMap,
) -> Response {
    let (ctx, subject_id) = match context(&state, assistant_id, &headers).await {
        Ok(found) => found,
        Err(response) => return *response,
    };
    let listed: Result<Value, sqlx::Error> = sqlx::query_scalar(&format!(
        "select coalesce(jsonb_agg(jsonb_build_object('id', id, 'text', text, 'createdAt', created_at) \
                                   order by created_at desc, id desc), '[]') from ({OWN}) own"
    ))
    .bind(ctx.publication.organization_id())
    .bind(&subject_id)
    .bind(POSTGREST_MAX_ROWS)
    .fetch_one(&state.pool)
    .await;
    match listed {
        Ok(memories) => response::json(
            StatusCode::OK,
            &ctx.cors,
            &[("cache-control", "no-store")],
            &json!({ "memories": memories }),
        ),
        Err(error) => response::internal(&error),
    }
}

pub async fn delete(
    State(state): State<WidgetState>,
    Path(assistant_id): Path<String>,
    RawQuery(query): RawQuery,
    headers: HeaderMap,
) -> Response {
    let (ctx, subject_id) = match context(&state, assistant_id, &headers).await {
        Ok(found) => found,
        Err(response) => return *response,
    };
    let id = query_param(query.as_deref(), "id").unwrap_or_default();
    // Only a memory the subject's own list holds, the list the route reads.
    let deleted = sqlx::query(&format!(
        "delete from public.memories where id = $4 and id in (select id from ({OWN}) own)"
    ))
    .bind(ctx.publication.organization_id())
    .bind(&subject_id)
    .bind(POSTGREST_MAX_ROWS)
    .bind(&id)
    .execute(&state.pool)
    .await;
    match deleted {
        Ok(done) if done.rows_affected() > 0 => {
            response::json(StatusCode::OK, &ctx.cors, &[], &json!({ "ok": true }))
        }
        Ok(_) => response::not_found(&ctx.cors),
        Err(error) => response::internal(&error),
    }
}
