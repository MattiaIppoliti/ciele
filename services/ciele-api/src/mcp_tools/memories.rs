//! `manage_memories`: the port of its `buildTools` entry in `packages/mcp/src/tools.ts`.

use super::*;

pub(super) async fn memories(api: &Api<'_>, action: &str, args: &Args) -> Out {
    match action {
        "settings" => api.request(ApiRequest::get("/memories/settings")).await,
        "enable" | "disable" => {
            api.request(
                ApiRequest::patch("/memories/settings")
                    .json(json!({ "enabled": action == "enable" })),
            )
            .await
        }
        "subjects" => {
            api.request(
                ApiRequest::get("/memories/subjects")
                    .query("limit", q(opt(args, "limit")))
                    .query("cursor", q(opt(args, "cursor"))),
            )
            .await
        }
        "list" => {
            let subject = need(args, "subjectId")?;
            api.request(ApiRequest::get(format!(
                "/memories/subjects/{}",
                encode(&subject)
            )))
            .await
        }
        "delete" => {
            let memory = need(args, "memoryId")?;
            api.request(ApiRequest::delete(format!("/memories/{}", encode(&memory))))
                .await?;
            echo("deleted", opt(args, "memoryId"))
        }
        "wipe" => {
            let subject = need(args, "subjectId")?;
            api.request(ApiRequest::delete(format!(
                "/memories/subjects/{}",
                encode(&subject)
            )))
            .await?;
            echo("wiped", opt(args, "subjectId"))
        }
        _ => Err(unknown_action(args)),
    }
}
