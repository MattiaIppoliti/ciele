//! `GET /api/widget/{assistantId}/config`: what the launcher and the chat
//! window draw from (`apps/web/src/app/api/widget/[assistantId]/config/route.ts`).

use axum::extract::{Path, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::Response;
use serde_json::{Map, Value, json};
use sqlx::{PgPool, Row};

use super::models::{self, Connection, PlatformModel};
use super::publication::resolve;
use super::{WidgetState, response, truthy};

pub async fn get(
    State(state): State<WidgetState>,
    Path(assistant_id): Path<String>,
    headers: HeaderMap,
) -> Response {
    let ctx = match resolve(&state.publications, &state.pool, assistant_id, &headers).await {
        Ok(ctx) => ctx,
        Err(response) => return *response,
    };
    let config = &ctx.publication.config;
    let assistant = ctx.publication.assistant();
    let flows = config
        .get("flows")
        .and_then(Value::as_array)
        .map_or(&[][..], Vec::as_slice);

    // Connections are read live, as the route does, so revoking a credential
    // closes the picker without a republish. With fewer than two choices the
    // answer is no picker whatever they hold, so they are not read at all.
    let choices = models::choices(assistant);
    let models = if choices.len() < 2 {
        Vec::new()
    } else {
        match picker_inputs(&state.pool, ctx.publication.organization_id()).await {
            Ok((connections, platform_models)) => models::options(
                &choices,
                &connections,
                &platform_models,
                &state.platform,
                &state.keys,
            ),
            Err(error) => return response::internal(&error),
        }
    };

    let mut body = Map::new();
    body.insert("version".into(), json!(ctx.publication.version));
    // `assistant.nickname || assistant.title`
    let nickname = if truthy(assistant.get("nickname")) {
        assistant.get("nickname")
    } else {
        assistant.get("title")
    };
    if let Some(nickname) = nickname {
        body.insert("nickname".into(), nickname.clone());
    }
    body.insert(
        "avatarUrl".into(),
        assistant.get("avatarUrl").cloned().unwrap_or(Value::Null),
    );
    for key in ["welcomeMessage", "aiDisclaimer", "suggestedQuestions"] {
        copy(&mut body, assistant, key);
    }
    body.insert(
        "quickReplies".into(),
        match assistant.get("quickReplies") {
            Some(Value::Null) | None => json!([]),
            Some(replies) => replies.clone(),
        },
    );
    copy(&mut body, assistant, "chatLauncherEnabled");
    copy(&mut body, assistant, "style");
    copy(&mut body, config, "collections");
    body.insert("proactiveTriggers".into(), json!(proactive_triggers(flows)));
    body.insert(
        "proactiveDwellSeconds".into(),
        json!(proactive_dwell_seconds(flows)),
    );
    body.insert("models".into(), Value::Array(models));

    response::json(
        StatusCode::OK,
        &ctx.cors,
        &[
            ("cache-control", "public, max-age=300, must-revalidate"),
            ("vary", "Origin"),
        ],
        &Value::Object(body),
    )
}

/// A key `JSON.stringify` keeps: present in the snapshot, `null` included.
fn copy(body: &mut Map<String, Value>, from: &Value, key: &str) {
    if let Some(value) = from.get(key) {
        body.insert(key.to_owned(), value.clone());
    }
}

/// The Organization's provider connections, oldest first, and the platform
/// owner's catalogue additions, in one round trip.
async fn picker_inputs(
    pool: &PgPool,
    organization_id: &str,
) -> Result<(Vec<Connection>, Vec<PlatformModel>), sqlx::Error> {
    let row = sqlx::query(
        "select \
           coalesce((select jsonb_agg(jsonb_build_object('provider', provider, 'type', type, \
                       'encrypted_key', encrypted_key, 'config', coalesce(config, '{}'::jsonb)) \
                       order by created_at) \
                     from public.provider_connections where organization_id = $1::text::uuid), '[]') as connections, \
           coalesce((select jsonb_agg(jsonb_build_array(provider, model_id, label) order by provider, label) \
                     from public.platform_eval_models), '[]') as platform_models",
    )
    .bind(organization_id)
    .fetch_one(pool)
    .await?;
    let connections: Value = row.try_get("connections")?;
    let platform_models: Value = row.try_get("platform_models")?;
    let text = |value: &Value| value.as_str().unwrap_or("").to_owned();
    Ok((
        connections
            .as_array()
            .map(|rows| {
                rows.iter()
                    .map(|row| Connection {
                        provider: text(&row["provider"]),
                        kind: text(&row["type"]),
                        encrypted_key: row["encrypted_key"].as_str().map(str::to_owned),
                        config: row["config"].clone(),
                    })
                    .collect()
            })
            .unwrap_or_default(),
        platform_models
            .as_array()
            .map(|rows| {
                rows.iter()
                    .map(|row| (text(&row[0]), text(&row[1]), text(&row[2])))
                    .collect()
            })
            .unwrap_or_default(),
    ))
}

const PROACTIVE_TRIGGERS: [&str; 3] = ["page_load", "time_on_page", "chat_open"];
const DEFAULT_DWELL_SECONDS: u64 = 30;

/// `proactiveFlowCandidates(flows, trigger, { elapsedSeconds: Infinity })`:
/// with no page URL and no clock, every objective condition is unevaluatable
/// and so never disqualifies, and no dwell is short of infinity.
fn candidates<'a>(flows: &'a [Value], trigger: &str) -> impl Iterator<Item = &'a Value> {
    flows.iter().filter(move |flow| {
        let actions = flow
            .get("actions")
            .and_then(Value::as_array)
            .map_or(&[][..], Vec::as_slice);
        truthy(flow.get("enabled"))
            && !truthy(flow.get("isDefault"))
            && flow
                .get("trigger")
                .and_then(Value::as_str)
                .unwrap_or("message")
                == trigger
            && !actions.is_empty()
            && actions.iter().all(|action| action == "notification")
    })
}

/// `proactiveTriggers`: the proactive triggers some Flow answers, in the
/// fixed order the embed arms them.
pub fn proactive_triggers(flows: &[Value]) -> Vec<&'static str> {
    PROACTIVE_TRIGGERS
        .into_iter()
        .filter(|trigger| candidates(flows, trigger).next().is_some())
        .collect()
}

/// `proactiveDwellSeconds`: the distinct Time-on-page thresholds, ascending.
pub fn proactive_dwell_seconds(flows: &[Value]) -> Vec<u64> {
    let mut dwells: Vec<u64> = candidates(flows, "time_on_page")
        .map(flow_dwell_seconds)
        .collect();
    dwells.sort_unstable();
    dwells.dedup();
    dwells
}

/// `flowDwellSeconds`: whole minutes and seconds, each `Number()`-coerced and
/// floored at zero; a total of zero means the default.
fn flow_dwell_seconds(flow: &Value) -> u64 {
    let dwell = &flow["triggerSettings"]["timeOnPage"];
    let part = |key: &str| {
        let n = js_number(dwell.get(key).unwrap_or(&Value::Null));
        if n.is_finite() {
            n.floor().max(0.0) as u64
        } else {
            0
        }
    };
    let total = part("minutes") * 60 + part("seconds");
    if total > 0 {
        total
    } else {
        DEFAULT_DWELL_SECONDS
    }
}

/// `Number(value)` for what a JSON snapshot can hold. `?? 0` has already
/// turned an absent key into 0, which `Value::Null` stands for here.
fn js_number(value: &Value) -> f64 {
    match value {
        Value::Null => 0.0,
        Value::Bool(b) => f64::from(u8::from(*b)),
        Value::Number(n) => n.as_f64().unwrap_or(f64::NAN),
        Value::String(text) => {
            let text = crate::js::js_trim(text);
            if text.is_empty() {
                return 0.0;
            }
            let digits = text.trim_start_matches(['+', '-']);
            let numeric = digits.starts_with(|c: char| c.is_ascii_digit() || c == '.')
                || digits == "Infinity";
            if !numeric || digits.starts_with("0x") || digits.starts_with("0X") {
                return crate::js::js_number_to_safe_integer(text).map_or(f64::NAN, |n| n as f64);
            }
            text.parse().unwrap_or(f64::NAN)
        }
        Value::Array(items) if items.is_empty() => 0.0,
        Value::Array(items) if items.len() == 1 => js_number(&items[0]),
        _ => f64::NAN,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn flow(trigger: &str, dwell: Value, actions: Value) -> Value {
        json!({ "enabled": true, "isDefault": false, "trigger": trigger, "position": 0,
                "actions": actions, "triggerSettings": { "timeOnPage": dwell } })
    }

    #[test]
    fn lists_only_triggers_a_notification_flow_answers() {
        let flows = [
            flow("chat_open", json!(null), json!(["notification"])),
            flow("page_load", json!(null), json!(["custom_message"])),
            json!({ "enabled": false, "trigger": "page_load", "actions": ["notification"] }),
            flow("message", json!(null), json!(["notification"])),
        ];
        assert_eq!(proactive_triggers(&flows), ["chat_open"]);
    }

    #[test]
    fn dwells_are_distinct_ascending_and_default_to_thirty() {
        let flows = [
            flow(
                "time_on_page",
                json!({ "minutes": 1, "seconds": 30 }),
                json!(["notification"]),
            ),
            flow(
                "time_on_page",
                json!({ "minutes": "0", "seconds": "90" }),
                json!(["notification"]),
            ),
            flow(
                "time_on_page",
                json!({ "minutes": -2, "seconds": 0 }),
                json!(["notification"]),
            ),
            flow(
                "time_on_page",
                json!({ "seconds": "soon" }),
                json!(["notification"]),
            ),
            flow(
                "time_on_page",
                json!({ "seconds": 5.9 }),
                json!(["notification"]),
            ),
        ];
        assert_eq!(proactive_dwell_seconds(&flows), [5, 30, 90]);
    }
}
