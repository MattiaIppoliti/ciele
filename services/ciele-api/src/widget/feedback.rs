//! `POST feedback` (one answer) and `POST conversation-feedback` (the whole
//! Conversation), from `apps/web/src/app/api/widget/[assistantId]/…/route.ts`.

use axum::body::Bytes;
use axum::extract::{Path, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::Response;
use serde_json::{Value, json};

use super::publication::resolve;
use super::response;
use super::subject::{body_visitor_id, conversation_owner, message_owner, widget_subject};
use super::{WidgetState, truthy};
use crate::js::js_trim;

/// `FEEDBACK_REACTIONS` in `packages/core/src/feedback-reactions.ts`, id and score.
const REACTIONS: [(&str, i32); 3] = [("positive", 1), ("neutral", 0), ("negative", -1)];

/// `await request.json()`: a body that is not JSON throws, and so does
/// reading a field off `null`; Next.js answers both with a bare 500, which is
/// what `None` means to the caller.
pub fn json_body(body: &Bytes) -> Option<Value> {
    serde_json::from_slice::<Value>(body)
        .ok()
        .filter(|value| !value.is_null())
}

/// An id the route passes to a PostgREST `eq` filter, which stringifies it.
/// `None` for a value no row id can equal.
pub fn id_param(value: Option<&Value>) -> Option<String> {
    match value? {
        Value::String(id) => Some(id.clone()),
        Value::Number(n) => Some(n.to_string()),
        Value::Bool(b) => Some(b.to_string()),
        _ => None,
    }
}

pub async fn rate_message(
    State(state): State<WidgetState>,
    Path(assistant_id): Path<String>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    let ctx = match resolve(&state.publications, &state.pool, assistant_id, &headers).await {
        Ok(ctx) => ctx,
        Err(response) => return *response,
    };
    let Some(body) = json_body(&body) else {
        return response::bare_500();
    };
    let reaction = body.get("reaction");
    let has_reaction = reaction.is_some();
    let known = reaction
        .and_then(Value::as_str)
        .and_then(|id| REACTIONS.iter().find(|(known, _)| *known == id));
    let subject = widget_subject(
        &headers,
        &state.keys,
        ctx.publication.organization_id(),
        body_visitor_id(&body),
    );
    let legacy = body
        .get("feedback")
        .and_then(Value::as_f64)
        .filter(|score| [-1.0, 0.0, 1.0].contains(score));
    if !truthy(body.get("messageId"))
        || subject.id.is_missing()
        || (has_reaction && !reaction.is_some_and(Value::is_null) && known.is_none())
        || (!has_reaction && legacy.is_none())
    {
        return response::text(StatusCode::BAD_REQUEST, &ctx.cors, "Bad request");
    }

    let not_found = || response::not_found(&ctx.cors);
    let Some(message_id) = id_param(body.get("messageId")) else {
        return not_found();
    };
    match message_owner(&state.pool, &message_id).await {
        Ok(Some(owner)) if owner.is(&ctx.assistant_id, &subject) => {}
        Ok(_) => return not_found(),
        Err(error) => return response::internal(&error),
    }

    let (score, stored_reaction) = if has_reaction {
        (
            known.map_or(0, |(_, score)| *score),
            known.map(|(id, _)| *id),
        )
    } else {
        (legacy.unwrap_or(0.0) as i32, None)
    };
    let written = sqlx::query(
        "update public.messages set feedback = $2::int, feedback_reaction = $3 where id = $1",
    )
    .bind(&message_id)
    .bind(score)
    .bind(stored_reaction)
    .execute(&state.pool)
    .await;
    if let Err(error) = written {
        return response::internal(&error);
    }
    response::json(StatusCode::OK, &ctx.cors, &[], &json!({ "ok": true }))
}

pub async fn rate_conversation(
    State(state): State<WidgetState>,
    Path(assistant_id): Path<String>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    let ctx = match resolve(&state.publications, &state.pool, assistant_id, &headers).await {
        Ok(ctx) => ctx,
        Err(response) => return *response,
    };
    let Some(body) = json_body(&body) else {
        return response::bare_500();
    };
    // `body.text?.trim()`: anything but a string or nothing throws.
    let text = match body.get("text") {
        None | Some(Value::Null) => String::new(),
        Some(Value::String(text)) => js_trim(text).to_owned(),
        Some(_) => return response::bare_500(),
    };
    let subject = widget_subject(
        &headers,
        &state.keys,
        ctx.publication.organization_id(),
        body_visitor_id(&body),
    );
    if !truthy(body.get("conversationId")) || subject.id.is_missing() || text.is_empty() {
        return response::text(StatusCode::BAD_REQUEST, &ctx.cors, "Bad request");
    }
    let not_found = || response::not_found(&ctx.cors);
    let Some(conversation_id) = id_param(body.get("conversationId")) else {
        return not_found();
    };
    match conversation_owner(&state.pool, &conversation_id).await {
        Ok(Some(owner)) if owner.is(&ctx.assistant_id, &subject) => {}
        Ok(_) => return not_found(),
        Err(error) => return response::internal(&error),
    }

    let patch = json!({
        "feedbackText": utf16_prefix(&text, 2000),
        "feedbackAt": iso_now(),
    });
    let written = sqlx::query("select public.merge_conversation_metadata($1, $2)")
        .bind(&conversation_id)
        .bind(sqlx::types::Json(patch))
        .execute(&state.pool)
        .await;
    if let Err(error) = written {
        return response::internal(&error);
    }
    response::json(StatusCode::OK, &ctx.cors, &[], &json!({ "ok": true }))
}

/// `text.slice(0, max)`, which counts UTF-16 code units. A pair cut in half
/// cannot be stored as jsonb on either side, so it is dropped here.
pub fn utf16_prefix(text: &str, max: usize) -> String {
    let mut units = 0;
    let mut out = String::new();
    for c in text.chars() {
        units += c.len_utf16();
        if units > max {
            break;
        }
        out.push(c);
    }
    out
}

/// `new Date().toISOString()`.
pub fn iso_now() -> String {
    iso_from_ms(super::now_ms() as i64)
}

pub fn iso_from_ms(ms: i64) -> String {
    let (secs, millis) = (ms.div_euclid(1000), ms.rem_euclid(1000));
    let (days, rem) = (secs.div_euclid(86_400), secs.rem_euclid(86_400));
    // Howard Hinnant's civil_from_days.
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + i64::from(month <= 2);
    format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}.{millis:03}Z",
        rem / 3600,
        rem % 3600 / 60,
        rem % 60
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn formats_instants_like_to_iso_string() {
        assert_eq!(iso_from_ms(0), "1970-01-01T00:00:00.000Z");
        assert_eq!(iso_from_ms(1_792_000_000_123), "2026-10-14T17:46:40.123Z");
        assert_eq!(iso_from_ms(951_782_400_000), "2000-02-29T00:00:00.000Z");
    }

    #[test]
    fn slices_by_utf16_units() {
        assert_eq!(utf16_prefix("abc", 2), "ab");
        assert_eq!(utf16_prefix("a😀b", 3), "a😀");
        assert_eq!(utf16_prefix("a😀b", 2), "a");
    }

    #[test]
    fn stringifies_ids_as_a_filter_does() {
        assert_eq!(id_param(Some(&json!("m-1"))).as_deref(), Some("m-1"));
        assert_eq!(id_param(Some(&json!(5))).as_deref(), Some("5"));
        assert_eq!(id_param(Some(&json!({}))), None);
    }
}
