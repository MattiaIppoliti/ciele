//! `manage_flows`: the port of its `buildTools` entry in `packages/mcp/src/tools.ts`.

use super::*;

pub(super) async fn flows(api: &Api<'_>, action: &str, args: &Args) -> Out {
    let flow = || opt(args, "flow");
    match action {
        "catalog" => api.request(ApiRequest::get("/flows/catalog")).await,
        "draft" => {
            let Some(patch) = flow() else {
                return Err(Fail::input("\"flow\" carries the patch for draft"));
            };
            let body = obj(vec![
                ("summary", Some(need(args, "summary")?.into())),
                ("currentTrigger", opt(args, "currentTrigger")),
                ("patch", Some(patch)),
            ]);
            api.request(ApiRequest::post("/flows/draft").json(body))
                .await
        }
        "validate" => {
            let Some(flow) = flow() else {
                return Err(Fail::input("\"flow\" is required for validate"));
            };
            let assistant = need(args, "assistantId")?;
            let body = obj(vec![
                ("rationale", Some(need(args, "rationale")?.into())),
                ("flow", Some(flow)),
            ]);
            api.request(
                ApiRequest::post(format!("/assistants/{}/flows/validate", encode(&assistant)))
                    .json(body),
            )
            .await
        }
        "runs" => {
            let id = need(args, "id")?;
            api.request(
                ApiRequest::get(format!("/flows/{}/runs", encode(&id)))
                    .query("limit", q(opt(args, "limit"))),
            )
            .await
        }
        "agent_thread" => {
            let assistant = need(args, "assistantId")?;
            api.request(
                ApiRequest::get(format!(
                    "/assistants/{}/flows-agent/thread",
                    encode(&assistant)
                ))
                .query("flowId", q(opt(args, "id"))),
            )
            .await
        }
        "agent_conversation" => {
            let assistant = need(args, "assistantId")?;
            let conversation = need(args, "conversationId")?;
            api.request(ApiRequest::get(format!(
                "/assistants/{}/flows-agent/conversations/{}",
                encode(&assistant),
                encode(&conversation)
            )))
            .await
        }
        "list" => {
            let assistant = need(args, "assistantId")?;
            api.request(ApiRequest::get(format!(
                "/assistants/{}/flows",
                encode(&assistant)
            )))
            .await
        }
        "get" => {
            let id = need(args, "id")?;
            api.request(ApiRequest::get(format!("/flows/{}", encode(&id))))
                .await
        }
        "create" => {
            let Some(flow) = flow() else {
                return Err(Fail::input("\"flow\" is required for create"));
            };
            let assistant = need(args, "assistantId")?;
            api.request(
                ApiRequest::post(format!("/assistants/{}/flows", encode(&assistant))).json(flow),
            )
            .await
        }
        "update" => {
            let Some(flow) = flow() else {
                return Err(Fail::input("\"flow\" is required for update"));
            };
            let id = need(args, "id")?;
            api.request(ApiRequest::patch(format!("/flows/{}", encode(&id))).json(flow))
                .await
        }
        "delete" => {
            let id = need(args, "id")?;
            api.request(ApiRequest::delete(format!("/flows/{}", encode(&id))))
                .await?;
            echo("deleted", opt(args, "id"))
        }
        "reorder" => {
            let Some(ordered @ Value::Array(_)) = opt(args, "orderedIds") else {
                return Err(Fail::input("\"orderedIds\" is required for reorder"));
            };
            let assistant = need(args, "assistantId")?;
            api.request(
                ApiRequest::post(format!("/assistants/{}/flows/reorder", encode(&assistant)))
                    .json(json!({ "orderedIds": ordered })),
            )
            .await
        }
        _ => Err(unknown_action(args)),
    }
}
