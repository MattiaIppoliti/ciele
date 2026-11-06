//! `GET help-desks`: the escalation menu, the desks the Publication selects
//! with their enabled channels in the widget-safe projection of
//! `apps/web/src/lib/escalation-desks.ts`. Channel credentials never leave.

use axum::extract::{Path, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::Response;
use serde_json::{Map, Value, json};
use sqlx::Row;

use super::publication::resolve;
use super::{WidgetState, response, truthy};
use crate::js::js_trim;

pub async fn get(
    State(state): State<WidgetState>,
    Path(assistant_id): Path<String>,
    headers: HeaderMap,
) -> Response {
    let ctx = match resolve(&state.publications, &state.pool, assistant_id, &headers).await {
        Ok(ctx) => ctx,
        Err(response) => return *response,
    };
    let selected: Vec<String> = ctx.publication.assistant()["helpDeskSettings"]["selectedIds"]
        .as_array()
        .map(|ids| {
            ids.iter()
                .filter_map(Value::as_str)
                .map(str::to_owned)
                .collect()
        })
        .unwrap_or_default();

    // The Organization's desks by name, kept only when selected: a selected id
    // of another Organization's desk matches nothing here.
    let rows = sqlx::query(
        "select d.id, d.name, \
           coalesce((select jsonb_agg(to_jsonb(c) order by c.position) \
                     from public.support_channels c where c.help_desk_id = d.id), '[]') as channels \
         from public.help_desks d \
         where d.organization_id = $1::text::uuid and d.id = any($2) \
         order by d.name",
    )
    .bind(ctx.publication.organization_id())
    .bind(&selected)
    .fetch_all(&state.pool)
    .await;
    let rows = match rows {
        Ok(rows) => rows,
        Err(error) => return response::internal(&error),
    };
    let mut desks = Vec::with_capacity(rows.len());
    for row in rows {
        let (id, name, channels): (String, String, Value) = match (
            row.try_get("id"),
            row.try_get("name"),
            row.try_get("channels"),
        ) {
            (Ok(id), Ok(name), Ok(channels)) => (id, name, channels),
            (Err(error), _, _) | (_, Err(error), _) | (_, _, Err(error)) => {
                return response::internal(&error);
            }
        };
        let channels: Vec<Value> = channels
            .as_array()
            .map(Vec::as_slice)
            .unwrap_or_default()
            .iter()
            .filter(|channel| truthy(channel.get("enabled")))
            .map(escalation_channel)
            .filter(|c| c["kind"] != "email" || !c["target"].is_null() || !c["form"].is_null())
            .collect();
        desks.push(json!({ "id": id, "name": name, "channels": channels }));
    }
    response::json(
        StatusCode::OK,
        &ctx.cors,
        &[],
        &json!({ "helpDesks": desks }),
    )
}

/// `String(value)` for what a channel config holds.
fn js_string(value: &Value) -> String {
    match value {
        Value::String(text) => text.clone(),
        other => other.to_string(),
    }
}

/// `visibleFormFields`: shown, and not a file upload.
fn visible_fields(form: &Value) -> Vec<Value> {
    form.as_array()
        .map(Vec::as_slice)
        .unwrap_or_default()
        .iter()
        .filter(|field| field.get("showInForm") != Some(&Value::Bool(false)))
        .filter(|field| field.get("type").and_then(Value::as_str) != Some("file"))
        .map(|field| {
            let mut out = Map::new();
            for key in [
                "id",
                "type",
                "label",
                "placeholder",
                "usePlaceholderAsDefault",
                "required",
                "options",
            ] {
                if let Some(value) = field.get(key) {
                    out.insert(key.to_owned(), value.clone());
                }
            }
            Value::Object(out)
        })
        .collect()
}

/// `toSupportChannel` then `toEscalationChannel`, from a `support_channels` row.
fn escalation_channel(row: &Value) -> Value {
    let kind = row["kind"].as_str().unwrap_or("");
    let config = match row.get("config") {
        None | Some(Value::Null) => json!({}),
        Some(config) => config.clone(),
    };
    let form_title = row["form_title"].as_str().unwrap_or("Send us a message");
    let form = row
        .get("form")
        .filter(|f| !f.is_null())
        .cloned()
        .unwrap_or(json!([]));
    let confirmation = row
        .get("confirmation_message")
        .filter(|m| !m.is_null())
        .cloned()
        .unwrap_or(json!(""));
    let title = match js_trim(form_title) {
        "" => "Helpdesk form",
        trimmed => trimmed,
    };
    let form_of = |fields: Vec<Value>| json!({ "title": title, "fields": fields, "confirmationMessage": confirmation });

    let (mut target, mut escalation_form) = (Value::Null, Value::Null);
    let set = |key: &str| truthy(config.get(key));
    match kind {
        "email" if set("destinationEmail") => {
            let fields = visible_fields(&form);
            if fields.is_empty() {
                target = json!(format!("mailto:{}", js_string(&config["destinationEmail"])));
            } else {
                escalation_form = form_of(fields);
            }
        }
        "phone" if set("phoneNumber") => {
            let digits: String = js_string(&config["phoneNumber"])
                .chars()
                .filter(|c| *c == '+' || c.is_ascii_digit())
                .collect();
            target = json!(format!("tel:{digits}"));
        }
        "live_chat" | "external_link" if set("url") => target = config["url"].clone(),
        "api_endpoint" if set("url") => escalation_form = form_of(visible_fields(&form)),
        _ => {}
    }
    json!({
        "id": row["id"],
        "kind": kind,
        "name": row["name"],
        "availability": availability(row.get("availability")),
        "target": target,
        "form": escalation_form,
    })
}

const WEEK_DAYS: [&str; 7] = [
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
    "sunday",
];

/// JavaScript's `!raw || typeof raw !== "object"`: arrays count as objects.
fn object_like(value: Option<&Value>) -> bool {
    matches!(value, Some(Value::Object(_) | Value::Array(_)))
}

/// `normalizeChannelAvailability` from `packages/core/src/defaults.ts`.
pub fn availability(raw: Option<&Value>) -> Value {
    let raw = raw.filter(|raw| object_like(Some(raw)));
    let hours = raw.and_then(|raw| raw.get("hours"));
    let days: Map<String, Value> = WEEK_DAYS
        .iter()
        .map(|day| {
            (
                (*day).to_owned(),
                day_availability(hours.and_then(|h| h.get(*day))),
            )
        })
        .collect();
    json!({
        "mode": if raw.and_then(|r| r.get("mode")).and_then(Value::as_str) == Some("limited") { "limited" } else { "always" },
        "timezone": raw.and_then(|r| r.get("timezone")).and_then(Value::as_str).unwrap_or("UTC"),
        "hours": days,
    })
}

fn day_availability(raw: Option<&Value>) -> Value {
    if !object_like(raw) {
        return json!({ "enabled": false, "ranges": [] });
    }
    let day = raw.unwrap_or(&Value::Null);
    let enabled = day.get("enabled") == Some(&Value::Bool(true));
    if let Some(ranges) = day.get("ranges").and_then(Value::as_array) {
        let ranges: Vec<Value> = ranges
            .iter()
            .enumerate()
            .filter_map(|(i, range)| time_range(range, i, None))
            .collect();
        return json!({ "enabled": enabled, "ranges": ranges });
    }
    // Legacy single window, `{ ...d, id: "r0" }`.
    let legacy = time_range(day, 0, Some("r0"));
    json!({ "enabled": enabled, "ranges": legacy.into_iter().collect::<Vec<_>>() })
}

fn time_range(raw: &Value, index: usize, id: Option<&str>) -> Option<Value> {
    if !object_like(Some(raw)) {
        return None;
    }
    let number = |key: &str| raw.get(key).filter(|v| v.is_number()).cloned();
    let (opens, closes) = (number("opensHour")?, number("closesHour")?);
    let id = match id {
        Some(id) => id.to_owned(),
        None => raw
            .get("id")
            .and_then(Value::as_str)
            .filter(|id| !id.is_empty())
            .map_or_else(|| format!("r{index}"), str::to_owned),
    };
    Some(json!({
        "id": id,
        "opensHour": opens,
        "opensMinute": number("opensMinute").unwrap_or(json!(0)),
        "closesHour": closes,
        "closesMinute": number("closesMinute").unwrap_or(json!(0)),
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_legacy_and_range_days() {
        let normal = availability(Some(&json!({
            "mode": "limited",
            "hours": {
                "monday": { "enabled": true, "opensHour": 9, "closesHour": 17 },
                "tuesday": { "enabled": true, "ranges": [{ "opensHour": 8, "closesHour": 12 }, { "opensHour": "x", "closesHour": 1 }] }
            }
        })));
        assert_eq!(normal["mode"], "limited");
        assert_eq!(normal["timezone"], "UTC");
        assert_eq!(normal["hours"]["monday"]["ranges"][0]["id"], "r0");
        assert_eq!(
            normal["hours"]["tuesday"]["ranges"]
                .as_array()
                .unwrap()
                .len(),
            1
        );
        assert_eq!(
            normal["hours"]["sunday"],
            json!({ "enabled": false, "ranges": [] })
        );
        assert_eq!(availability(None)["mode"], "always");
    }

    #[test]
    fn keeps_credentials_out_of_the_channel() {
        let channel = escalation_channel(&json!({
            "id": "c", "kind": "api_endpoint", "name": "Ticket", "enabled": true,
            "config": { "url": "https://t.example", "token": "secret" },
            "form_title": "", "form": [], "confirmation_message": "Thanks"
        }));
        assert!(!channel.to_string().contains("secret"));
        assert_eq!(channel["form"]["title"], "Helpdesk form");
        assert!(channel["target"].is_null());
    }
}
