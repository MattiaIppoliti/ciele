//! `GET /api/widget/{assistantId}/session`: whether the Visitor must sign in,
//! whether they have, and whether their Memory folder shows
//! (`apps/web/src/app/api/widget/[assistantId]/session/route.ts`).

use axum::extract::{Path, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::Response;
use serde_json::{Map, Value, json};

use super::gate::gate_for_org;
use super::publication::resolve;
use super::{WidgetState, now_ms, response, truthy};

pub async fn get(
    State(state): State<WidgetState>,
    Path(assistant_id): Path<String>,
    headers: HeaderMap,
) -> Response {
    let ctx = match resolve(&state.publications, &state.pool, assistant_id, &headers).await {
        Ok(ctx) => ctx,
        Err(response) => return *response,
    };
    let assistant = ctx.publication.assistant();
    let organization_id = ctx.publication.organization_id();
    let gate_valid = gate_for_org(&headers, &state.keys, organization_id, now_ms()).is_some();
    let require = assistant.get("requireSignIn");
    let required = truthy(require);

    // Provider is org-level, not in the snapshot: read live.
    let provider = if required {
        match sqlx::query_scalar::<_, String>(
            "select provider from public.sso_connections where organization_id = $1::text::uuid",
        )
        .bind(organization_id)
        .fetch_optional(&state.pool)
        .await
        {
            Ok(provider) => provider.map_or(Value::Null, Value::String),
            Err(error) => return response::internal(&error),
        }
    } else {
        Value::Null
    };
    // Only an SSO-signed Visitor of an Organization with memory on.
    let memories = if gate_valid {
        match memory_enabled(&state.pool, organization_id).await {
            Ok(enabled) => enabled,
            Err(error) => return response::internal(&error),
        }
    } else {
        false
    };

    let mut body = Map::new();
    if let Some(require) = require {
        body.insert("requireSignIn".into(), require.clone());
    }
    body.insert("authenticated".into(), json!(!required || gate_valid));
    body.insert("provider".into(), provider);
    body.insert("memories".into(), json!(memories));
    response::json(
        StatusCode::OK,
        &ctx.cors,
        &[("cache-control", "no-store")],
        &Value::Object(body),
    )
}

/// `getMemoryEnabled`.
pub async fn memory_enabled(
    pool: &sqlx::PgPool,
    organization_id: &str,
) -> Result<bool, sqlx::Error> {
    let enabled: Option<Option<bool>> = sqlx::query_scalar(
        "select memory_enabled from public.organizations where id = $1::text::uuid",
    )
    .bind(organization_id)
    .fetch_optional(pool)
    .await?;
    Ok(enabled.flatten().unwrap_or(false))
}
