//! `manage_improvements`: the port of its `buildTools` entry in `packages/mcp/src/tools.ts`.

use super::*;

pub(super) async fn improvements(api: &Api<'_>, action: &str, args: &Args) -> Out {
    match action {
        "list" => {
            // `client.improvements.list` sends a `null` assignee as an empty
            // string, which the route reads back as unassigned work.
            let assignee = match opt(args, "assigneeId") {
                Some(Value::Null) => Some(String::new()),
                other => q(other),
            };
            api.request(
                ApiRequest::get("/improvements")
                    .query("limit", q(opt(args, "limit")))
                    .query("cursor", q(opt(args, "cursor")))
                    .query("search", q(opt(args, "search")))
                    .query("status", q(opt(args, "status")))
                    .query("priority", q(opt(args, "priority")))
                    .query("assigneeId", assignee)
                    .query("assistantId", q(opt(args, "assistantId")))
                    .query("projectId", q(opt(args, "projectId"))),
            )
            .await
        }
        "get" => {
            let id = need(args, "id")?;
            api.request(ApiRequest::get(format!("/improvements/{}", encode(&id))))
                .await
        }
        "update" => {
            let Some(patch) = opt(args, "patch") else {
                return Err(Fail::input("\"patch\" is required for update"));
            };
            let id = need(args, "id")?;
            api.request(ApiRequest::patch(format!("/improvements/{}", encode(&id))).json(patch))
                .await
        }
        _ => Err(unknown_action(args)),
    }
}
