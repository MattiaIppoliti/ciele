//! `read_inbox`: the port of its `buildTools` entry in `packages/mcp/src/tools.ts`.

use super::*;

pub(super) async fn inbox(api: &Api<'_>, action: &str, args: &Args) -> Out {
    match action {
        "list" => {
            api.request(
                ApiRequest::get("/conversations")
                    .query("assistantId", q(opt(args, "assistantId")))
                    .query("limit", q(opt(args, "limit")))
                    .query("cursor", q(opt(args, "cursor"))),
            )
            .await
        }
        "get" => {
            let id = need(args, "conversationId")?;
            api.request(ApiRequest::get(format!("/conversations/{}", encode(&id))))
                .await
        }
        "export" => {
            let Some(ids @ Value::Array(_)) = opt(args, "conversationIds") else {
                return Err(Fail::input("\"conversationIds\" is required for export"));
            };
            api.request(
                ApiRequest::post("/conversations/export").json(json!({ "conversationIds": ids })),
            )
            .await
        }
        "pin" | "unpin" => {
            let id = need(args, "conversationId")?;
            api.request(
                ApiRequest::patch(format!("/conversations/{}", encode(&id)))
                    .json(json!({ "pinned": action == "pin" })),
            )
            .await
        }
        "feedback" => {
            let id = need(args, "conversationId")?;
            let text = need(args, "text")?;
            api.request(
                ApiRequest::post(format!("/conversations/{}/feedback", encode(&id)))
                    .json(json!({ "text": text })),
            )
            .await
        }
        "message_feedback" => {
            let feedback = opt(args, "feedback");
            let valid = feedback
                .as_ref()
                .and_then(Value::as_f64)
                .is_some_and(|n| n == 1.0 || n == 0.0 || n == -1.0);
            if !valid {
                return Err(Fail::input("\"feedback\" must be -1, 0, or 1"));
            }
            let id = need(args, "messageId")?;
            api.request(
                ApiRequest::patch(format!("/messages/{}/feedback", encode(&id)))
                    .json(json!({ "feedback": feedback })),
            )
            .await
        }
        "delete" => {
            let id = need(args, "conversationId")?;
            api.request(ApiRequest::delete(format!(
                "/conversations/{}",
                encode(&id)
            )))
            .await?;
            echo("deleted", opt(args, "conversationId"))
        }
        "review_list" => {
            api.request(
                ApiRequest::get("/reviews")
                    .query("status", q(opt(args, "status")))
                    .query("conversationId", q(opt(args, "conversationId")))
                    .query("assistantId", q(opt(args, "assistantId"))),
            )
            .await
        }
        "review_get" => {
            let id = need(args, "reviewId")?;
            api.request(ApiRequest::get(format!("/reviews/{}", encode(&id))))
                .await
        }
        "review_decide" => {
            let decision = opt(args, "decision");
            if !matches!(
                decision.as_ref().and_then(Value::as_str),
                Some("approved" | "rejected")
            ) {
                return Err(Fail::input("\"decision\" must be approved or rejected"));
            }
            let id = need(args, "reviewId")?;
            let inputs = opt(args, "inputs").unwrap_or_else(|| json!({}));
            api.request(
                ApiRequest::post(format!("/reviews/{}/decide", encode(&id)))
                    .json(json!({ "decision": decision, "inputs": inputs })),
            )
            .await
        }
        _ => Err(unknown_action(args)),
    }
}
