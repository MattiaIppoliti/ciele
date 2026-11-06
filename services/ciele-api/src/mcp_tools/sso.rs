//! `manage_sso`: the port of its `buildTools` entry in `packages/mcp/src/tools.ts`.

use super::*;

pub(super) async fn sso(api: &Api<'_>, action: &str, args: &Args) -> Out {
    match action {
        "status" => api.request(ApiRequest::get("/sso/identity")).await,
        "set_identity" => {
            let Some(claim) = opt(args, "identityClaim") else {
                return Err(Fail::input(
                    "\"identityClaim\" is required for set_identity",
                ));
            };
            api.request(ApiRequest::patch("/sso/identity").json(json!({ "identityClaim": claim })))
                .await
        }
        "validate" => {
            api.request(ApiRequest::post("/sso/identity/validate"))
                .await
        }
        "connection" => api.request(ApiRequest::get("/sso/connection")).await,
        "connect" => {
            let input = need_object(args, "input")?;
            api.request(ApiRequest::put("/sso/connection").json(input))
                .await
        }
        "disconnect" => {
            api.request(ApiRequest::delete("/sso/connection")).await?;
            Ok(Some(json!({ "disconnected": true })))
        }
        _ => Err(unknown_action(args)),
    }
}
