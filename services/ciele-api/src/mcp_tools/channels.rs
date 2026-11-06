//! `manage_channels`: the port of its `buildTools` entry in `packages/mcp/src/tools.ts`.

use super::*;

pub(super) async fn channels(api: &Api<'_>, action: &str, args: &Args) -> Out {
    let id = || need(args, "id");
    let at = |id: &str, tail: &str| format!("/channels/{}{tail}", encode(id));
    match action {
        "oversight" => api.request(ApiRequest::get("/channels/oversight")).await,
        "oversight_read" => {
            let id = id()?;
            api.request(ApiRequest::get(format!(
                "/channels/oversight/{}",
                encode(&id)
            )))
            .await
        }
        "list" => api.request(ApiRequest::get("/channels")).await,
        "get" => api.request(ApiRequest::get(at(&id()?, ""))).await,
        "create" => {
            let input = need_object(args, "input")?;
            api.request(ApiRequest::post("/channels").json(input)).await
        }
        "update" => {
            let id = id()?;
            let patch = need_object(args, "patch")?;
            api.request(ApiRequest::patch(at(&id, "")).json(patch))
                .await
        }
        "delete" => {
            api.request(ApiRequest::delete(at(&id()?, ""))).await?;
            echo("deleted", opt(args, "id"))
        }
        "add_member" => {
            let id = id()?;
            let ids = need_list(args, "userIds")?;
            api.request(ApiRequest::post(at(&id, "/members")).json(json!({ "userIds": ids })))
                .await?;
            echo("added", opt(args, "userIds"))
        }
        "remove_member" => {
            let id = id()?;
            let user = need(args, "userId")?;
            api.request(ApiRequest::delete(at(
                &id,
                &format!("/members/{}", encode(&user)),
            )))
            .await?;
            echo("removed", opt(args, "userId"))
        }
        "add_teammate" => {
            let id = id()?;
            let ids = need_list(args, "teammateIds")?;
            api.request(
                ApiRequest::post(at(&id, "/teammates")).json(json!({ "teammateIds": ids })),
            )
            .await?;
            echo("added", opt(args, "teammateIds"))
        }
        "remove_teammate" => {
            let id = id()?;
            let teammate = need(args, "teammateId")?;
            api.request(ApiRequest::delete(at(
                &id,
                &format!("/teammates/{}", encode(&teammate)),
            )))
            .await?;
            echo("removed", opt(args, "teammateId"))
        }
        _ => Err(unknown_action(args)),
    }
}
