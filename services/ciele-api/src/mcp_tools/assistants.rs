//! `manage_assistants`: the port of its `buildTools` entry in `packages/mcp/src/tools.ts`.

use super::*;

pub(super) async fn assistants(api: &Api<'_>, action: &str, args: &Args) -> Out {
    match action {
        "list" => {
            api.request(
                ApiRequest::get("/assistants")
                    .query("limit", q(opt(args, "limit")))
                    .query("cursor", q(opt(args, "cursor"))),
            )
            .await
        }
        "get" => {
            let id = need(args, "id")?;
            api.request(ApiRequest::get(format!("/assistants/{}", encode(&id))))
                .await
        }
        "create" => {
            let body = obj(vec![
                ("title", Some(need(args, "title")?.into())),
                ("nickname", opt(args, "nickname")),
                ("description", opt(args, "description")),
            ]);
            api.request(ApiRequest::post("/assistants").json(body))
                .await
        }
        "update" => {
            let Some(patch) = opt(args, "patch") else {
                return Err(Fail::input("\"patch\" is required for update"));
            };
            let id = need(args, "id")?;
            api.request(ApiRequest::patch(format!("/assistants/{}", encode(&id))).json(patch))
                .await
        }
        "delete" => {
            let id = need(args, "id")?;
            api.request(ApiRequest::delete(format!("/assistants/{}", encode(&id))))
                .await?;
            echo("deleted", opt(args, "id"))
        }
        "duplicate" => {
            let id = need(args, "id")?;
            api.request(ApiRequest::post(format!(
                "/assistants/{}/duplicate",
                encode(&id)
            )))
            .await
        }
        "ask" => {
            let id = need(args, "id")?;
            let body = obj(vec![
                ("question", Some(need(args, "question")?.into())),
                ("conversationId", opt_truthy(args, "conversationId")),
            ]);
            api.request(ApiRequest::post(format!("/assistants/{}/ask", encode(&id))).json(body))
                .await
        }
        "export" => {
            let id = need(args, "id")?;
            api.request(ApiRequest::get(format!(
                "/assistants/{}/export",
                encode(&id)
            )))
            .await
        }
        "import" => {
            let bundle = need_object(args, "bundle")?;
            api.request(ApiRequest::post("/assistants/import").json(json!({ "bundle": bundle })))
                .await
        }
        "get_access" => {
            let id = need(args, "id")?;
            api.request(ApiRequest::get(format!(
                "/assistants/{}/access",
                encode(&id)
            )))
            .await
        }
        "set_access" => {
            let role = match opt(args, "role") {
                Some(Value::String(role))
                    if matches!(role.as_str(), "denied" | "viewer" | "editor" | "admin") =>
                {
                    role
                }
                _ => return Err(Fail::input("An access role is required")),
            };
            let id = need(args, "id")?;
            let user = need(args, "userId")?;
            api.request(
                ApiRequest::put(format!(
                    "/assistants/{}/access/{}",
                    encode(&id),
                    encode(&user)
                ))
                .json(json!({ "role": role })),
            )
            .await?;
            Ok(Some(json!({ "updated": true })))
        }
        "clear_access" => {
            let id = need(args, "id")?;
            let user = need(args, "userId")?;
            api.request(ApiRequest::delete(format!(
                "/assistants/{}/access/{}",
                encode(&id),
                encode(&user)
            )))
            .await?;
            Ok(Some(json!({ "cleared": true })))
        }
        _ => Err(unknown_action(args)),
    }
}
