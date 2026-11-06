//! `publish_assistant`: the port of its `buildTools` entry in `packages/mcp/src/tools.ts`.

use super::*;

pub(super) async fn publish(api: &Api<'_>, action: &str, args: &Args) -> Out {
    let assistant = need(args, "assistantId")?;
    let path = |tail: &str| format!("/assistants/{}/{tail}", encode(&assistant));
    match action {
        "status" => api.request(ApiRequest::get(path("publish"))).await,
        "publish" => api.request(ApiRequest::post(path("publish"))).await,
        "unpublish" => {
            api.request(ApiRequest::delete(path("publish"))).await?;
            Ok(Some(json!({ "unpublished": assistant })))
        }
        "republish" => {
            let publication = need(args, "publicationId")?;
            api.request(
                ApiRequest::post(path("republish")).json(json!({ "publicationId": publication })),
            )
            .await
        }
        _ => Err(unknown_action(args)),
    }
}
