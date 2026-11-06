//! `manage_integrations`: the port of its `buildTools` entry in `packages/mcp/src/tools.ts`.

use super::*;

pub(super) async fn integrations(api: &Api<'_>, action: &str, args: &Args) -> Out {
    let provider = || match args.get("provider") {
        Some(Value::String(text)) if !text.is_empty() => Some(text.clone()),
        _ => None,
    };
    match action {
        "application_list" => {
            api.request(ApiRequest::get("/applications/connections").query("provider", provider()))
                .await
        }
        "application_connectors" => {
            api.request(ApiRequest::get("/applications/connectors").query("provider", provider()))
                .await
        }
        "application_reconsent" => {
            let id = need(args, "id")?;
            let input = opt(args, "input").unwrap_or_else(|| json!({}));
            api.request(
                ApiRequest::post(format!(
                    "/applications/connections/{}/reconsent",
                    encode(&id)
                ))
                .json(input),
            )
            .await
        }
        "api_get" => {
            let id = need(args, "id")?;
            api.request(ApiRequest::get(format!(
                "/assistants/{}/api-integration",
                encode(&id)
            )))
            .await
        }
        "api_set" => {
            let id = need(args, "id")?;
            let input = need_object(args, "input")?;
            api.request(
                ApiRequest::put(format!("/assistants/{}/api-integration", encode(&id))).json(input),
            )
            .await
        }
        "api_delete" => {
            let id = need(args, "id")?;
            api.request(ApiRequest::delete(format!(
                "/assistants/{}/api-integration",
                encode(&id)
            )))
            .await?;
            echo("deleted", opt(args, "id"))
        }
        "provider_list" => api.request(ApiRequest::get("/providers")).await,
        "provider_create_api_key" => {
            let input = need_object(args, "input")?;
            api.request(ApiRequest::post("/providers/api-key").json(input))
                .await
        }
        "provider_create_compatible" => {
            let input = need_object(args, "input")?;
            api.request(ApiRequest::post("/providers/openai-compatible").json(input))
                .await
        }
        "provider_create_federated" => {
            let input = need_object(args, "input")?;
            api.request(ApiRequest::post("/providers/federated").json(input))
                .await
        }
        "provider_delete" => {
            let id = need(args, "id")?;
            api.request(ApiRequest::delete(format!("/providers/{}", encode(&id))))
                .await?;
            echo("deleted", opt(args, "id"))
        }
        "provider_set_embedding" => {
            let Some(connection) = opt(args, "connectionId") else {
                return Err(Fail::input(
                    "\"connectionId\" is required for provider_set_embedding",
                ));
            };
            api.request(
                ApiRequest::patch("/providers/embedding")
                    .json(json!({ "connectionId": connection })),
            )
            .await
        }
        _ => Err(unknown_action(args)),
    }
}
