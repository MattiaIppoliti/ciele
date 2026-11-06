//! `GET conversations`: the subject's history, or one transcript with
//! `?messages=<id>` (`apps/web/src/app/api/widget/[assistantId]/conversations/route.ts`).

use axum::extract::{Path, RawQuery, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::Response;
use serde_json::{Map, Value, json};

use super::WidgetState;
use super::publication::resolve;
use super::response;
use super::subject::{SubjectId, conversation_owner, widget_subject};
use crate::rows::POSTGREST_MAX_ROWS;

/// `URLSearchParams.get(name)`: the first value, `+` as a space, percent-decoded.
pub fn query_param(raw: Option<&str>, name: &str) -> Option<String> {
    url::form_urlencoded::parse(raw.unwrap_or("").as_bytes())
        .find(|(key, _)| key == name)
        .map(|(_, value)| value.into_owned())
}

pub async fn get(
    State(state): State<WidgetState>,
    Path(assistant_id): Path<String>,
    RawQuery(query): RawQuery,
    headers: HeaderMap,
) -> Response {
    let ctx = match resolve(&state.publications, &state.pool, assistant_id, &headers).await {
        Ok(ctx) => ctx,
        Err(response) => return *response,
    };
    let visitor_id = query_param(query.as_deref(), "visitorId").unwrap_or_default();
    let subject = widget_subject(
        &headers,
        &state.keys,
        ctx.publication.organization_id(),
        SubjectId::Text(visitor_id),
    );
    if subject.id.is_missing() {
        return response::text(StatusCode::BAD_REQUEST, &ctx.cors, "Bad request");
    }

    if let Some(conversation_id) =
        query_param(query.as_deref(), "messages").filter(|id| !id.is_empty())
    {
        match conversation_owner(&state.pool, &conversation_id).await {
            Ok(Some(owner)) if owner.is(&ctx.assistant_id, &subject) => {}
            Ok(_) => return response::not_found(&ctx.cors),
            Err(error) => return response::internal(&error),
        }
        let transcript = match messages(&state.pool, &conversation_id).await {
            Ok(messages) => messages,
            Err(error) => return response::internal(&error),
        };
        return match live(&state.pool, &conversation_id).await {
            Ok(live) => response::json(
                StatusCode::OK,
                &ctx.cors,
                &[],
                &json!({ "messages": transcript, "live": live }),
            ),
            Err(error) => response::internal(&error),
        };
    }

    // `listConversations` caps the history at 50.
    let listed: Result<Value, sqlx::Error> = sqlx::query_scalar(
        "select coalesce(jsonb_agg(jsonb_build_object('id', id, 'title', title, 'updatedAt', updated_at) \
                                   order by updated_at desc), '[]') \
         from (select id, title, updated_at from public.conversations \
               where assistant_id = $1 and subject_type = $2 and subject_id = $3 \
               order by updated_at desc limit 50) recent",
    )
    .bind(&ctx.assistant_id)
    .bind(subject.kind.as_str())
    .bind(subject.id.as_text())
    .fetch_one(&state.pool)
    .await;
    match listed {
        Ok(conversations) => response::json(
            StatusCode::OK,
            &ctx.cors,
            &[],
            &json!({ "conversations": conversations }),
        ),
        Err(error) => response::internal(&error),
    }
}

/// `listMessages`: oldest first, `seq` breaking a tie, at most PostgREST's
/// page, each row shaped by `toStoredMessage`.
async fn messages(pool: &sqlx::PgPool, conversation_id: &str) -> Result<Vec<Value>, sqlx::Error> {
    let rows: Value = sqlx::query_scalar(
        "select coalesce(jsonb_agg(to_jsonb(m) order by m.created_at, m.seq), '[]') \
         from (select * from public.messages where conversation_id = $1 \
               order by created_at, seq limit $2) m",
    )
    .bind(conversation_id)
    .bind(POSTGREST_MAX_ROWS)
    .fetch_one(pool)
    .await?;
    Ok(rows
        .as_array()
        .map(|rows| rows.iter().map(stored_message).collect())
        .unwrap_or_default())
}

/// `widgetLiveState` (`apps/web/src/lib/widget-live.ts`): who answers the
/// Conversation now. A wait whose timeout passed is the AI's again, as
/// `effectiveOperatorState` reads it, and counts as timed out.
async fn live(pool: &sqlx::PgPool, conversation_id: &str) -> Result<Value, sqlx::Error> {
    sqlx::query_scalar(
        "with c as ( \
           select coalesce(operator_state, 'ai') as stored, operator_name, waiting_help_desk_id, \
                  waiting_since + make_interval(mins => coalesce(wait_timeout_minutes, 5)) as expires \
           from public.conversations where id = $1 \
         ), e as ( \
           select *, case when stored = 'held' then 'held' \
                          when stored = 'waiting' and expires > now() then 'waiting' \
                          else 'ai' end as state \
           from c \
         ) \
         select jsonb_build_object( \
           'state', state, \
           'operatorName', case when state = 'held' then operator_name end, \
           'waitExpiresAt', case when state = 'waiting' \
             then to_char(expires at time zone 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"') end, \
           'waitTimedOut', stored = 'waiting' and state = 'ai', \
           'helpDeskId', waiting_help_desk_id) \
         from e",
    )
    .bind(conversation_id)
    .fetch_one(pool)
    .await
}

fn stored_message(row: &Value) -> Value {
    let field = |key: &str| row.get(key).cloned();
    let or = |key: &str, fallback: Value| match row.get(key) {
        None | Some(Value::Null) => fallback,
        Some(value) => value.clone(),
    };
    let mut out = Map::new();
    let mut put = |key: &str, value: Option<Value>| {
        if let Some(value) = value {
            out.insert(key.to_owned(), value);
        }
    };
    put("id", field("id"));
    put("requestId", Some(or("request_id", Value::Null)));
    put("conversationId", field("conversation_id"));
    put("role", field("role"));
    put("content", Some(or("content", json!([]))));
    // An operator's message carries the Member's name; `widgetMessage` keeps
    // the id, an internal identifier, from the Visitor.
    let truthy = |key: &str| matches!(row.get(key), Some(Value::String(text)) if !text.is_empty());
    if truthy("author_member_id") || truthy("author_name") {
        put("authorName", Some(or("author_name", Value::Null)));
    }
    put("flowId", field("flow_id"));
    put("flowName", field("flow_name"));
    put("feedback", field("feedback"));
    put(
        "feedbackReaction",
        Some(or("feedback_reaction", Value::Null)),
    );
    put("trace", Some(or("trace", Value::Null)));
    put("createdAt", field("created_at"));
    Value::Object(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_query_params_as_url_search_params_does() {
        assert_eq!(
            query_param(Some("visitorId=a+b%2Fc&visitorId=x"), "visitorId").as_deref(),
            Some("a b/c")
        );
        assert_eq!(
            query_param(Some("messages="), "messages").as_deref(),
            Some("")
        );
        assert_eq!(query_param(None, "visitorId"), None);
    }

    #[test]
    fn shapes_a_message_as_to_stored_message_does() {
        let row = json!({ "id": "m", "conversation_id": "c", "role": "assistant", "content": null,
                          "flow_id": null, "flow_name": null, "feedback": 0, "seq": 4,
                          "created_at": "2026-10-20T11:00:00+00:00" });
        assert_eq!(
            stored_message(&row),
            json!({ "id": "m", "requestId": null, "conversationId": "c", "role": "assistant",
                    "content": [], "flowId": null, "flowName": null, "feedback": 0,
                    "feedbackReaction": null, "trace": null, "createdAt": "2026-10-20T11:00:00+00:00" })
        );
    }
}
