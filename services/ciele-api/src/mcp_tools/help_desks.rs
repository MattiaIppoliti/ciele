//! `manage_help_desks`: the port of its `buildTools` entry in `packages/mcp/src/tools.ts`.

use super::*;

pub(super) async fn help_desks(api: &Api<'_>, action: &str, args: &Args) -> Out {
    let id = || need(args, "id");
    let at = |id: &str, tail: &str| format!("/help-desks/{}{tail}", encode(id));
    match action {
        "list" => api.request(ApiRequest::get("/help-desks")).await,
        "get" => api.request(ApiRequest::get(at(&id()?, ""))).await,
        "create" => {
            let input = need_object(args, "input")?;
            api.request(ApiRequest::post("/help-desks").json(input))
                .await
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
        "add_channel" => {
            let id = id()?;
            let input = need_object(args, "input")?;
            api.request(ApiRequest::post(at(&id, "/channels")).json(input))
                .await
        }
        "update_channel" => {
            let id = id()?;
            let channel = need(args, "channelId")?;
            let patch = need_object(args, "patch")?;
            api.request(
                ApiRequest::patch(at(&id, &format!("/channels/{}", encode(&channel)))).json(patch),
            )
            .await
        }
        "delete_channel" => {
            let id = id()?;
            let channel = need(args, "channelId")?;
            api.request(ApiRequest::delete(at(
                &id,
                &format!("/channels/{}", encode(&channel)),
            )))
            .await?;
            echo("deleted", opt(args, "channelId"))
        }
        "reorder_channels" => {
            let Some(ordered @ Value::Array(_)) = opt(args, "orderedIds") else {
                return Err(Fail::input(
                    "\"orderedIds\" is required for reorder_channels",
                ));
            };
            api.request(
                ApiRequest::post(at(&id()?, "/channels/reorder"))
                    .json(json!({ "orderedIds": ordered })),
            )
            .await
        }
        "set_ticketing" => {
            let id = id()?;
            let input = need_object(args, "input")?;
            api.request(ApiRequest::put(at(&id, "/ticketing")).json(input))
                .await
        }
        "disconnect_ticketing" => {
            api.request(ApiRequest::delete(at(&id()?, "/ticketing")))
                .await
        }
        _ => Err(unknown_action(args)),
    }
}
