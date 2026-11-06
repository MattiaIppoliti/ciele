//! `manage_organization`: the port of its `buildTools` entry in `packages/mcp/src/tools.ts`.

use super::*;

pub(super) async fn organization(api: &Api<'_>, action: &str, args: &Args) -> Out {
    match action {
        "get" => api.request(ApiRequest::get("/organization")).await,
        "update" => {
            let patch = need_object(args, "patch")?;
            api.request(ApiRequest::patch("/organization").json(patch))
                .await
        }
        "member_list" => api.request(ApiRequest::get("/members")).await,
        "member_set_role" => {
            let id = need(args, "id")?;
            // A Role id (custom Roles included) wins over a built-in name.
            let body = match args.get("roleId") {
                Some(Value::String(role_id)) => json!({ "roleId": role_id }),
                _ => json!({ "role": need(args, "role")? }),
            };
            api.request(ApiRequest::patch(format!("/members/{}", encode(&id))).json(body))
                .await
        }
        "role_list" => api.request(ApiRequest::get("/roles")).await,
        "role_get" => {
            let id = need(args, "id")?;
            api.request(ApiRequest::get(format!("/roles/{}", encode(&id))))
                .await
        }
        "role_create" => {
            let input = need_object(args, "input")?;
            api.request(ApiRequest::post("/roles").json(input)).await
        }
        "role_update" => {
            let id = need(args, "id")?;
            let patch = need_object(args, "patch")?;
            api.request(ApiRequest::patch(format!("/roles/{}", encode(&id))).json(patch))
                .await
        }
        "role_reset" => {
            let id = need(args, "id")?;
            api.request(ApiRequest::post(format!("/roles/{}/reset", encode(&id))))
                .await
        }
        "role_delete" => {
            let id = need(args, "id")?;
            api.request(ApiRequest::delete(format!("/roles/{}", encode(&id))))
                .await?;
            echo("deleted", opt(args, "id"))
        }
        "role_defaults_set" => {
            let input = need_object(args, "input")?;
            api.request(ApiRequest::put("/roles/defaults").json(input))
                .await
        }
        "member_remove" => {
            let id = need(args, "id")?;
            api.request(ApiRequest::delete(format!("/members/{}", encode(&id))))
                .await?;
            echo("removed", opt(args, "id"))
        }
        "invite_list" => api.request(ApiRequest::get("/invites")).await,
        "invite_create" => {
            let input = need_object(args, "input")?;
            api.request(ApiRequest::post("/invites").json(input)).await
        }
        "invite_revoke" => {
            let id = need(args, "id")?;
            api.request(ApiRequest::delete(format!("/invites/{}", encode(&id))))
                .await?;
            echo("revoked", opt(args, "id"))
        }
        "api_key_list" => api.request(ApiRequest::get("/api-keys")).await,
        "api_key_create" => {
            let input = need_object(args, "input")?;
            api.request(ApiRequest::post("/api-keys").json(input)).await
        }
        "api_key_revoke" => {
            let id = need(args, "id")?;
            api.request(ApiRequest::delete(format!("/api-keys/{}", encode(&id))))
                .await?;
            echo("revoked", opt(args, "id"))
        }
        "usage_meters" => api.request(ApiRequest::get("/usage/meters")).await,
        "usage_spenders" => {
            let window = |key: &str| match args.get(key) {
                Some(Value::String(text)) if !text.is_empty() => Some(text.clone()),
                _ => None,
            };
            api.request(
                ApiRequest::get("/usage/spenders")
                    .query("from", window("from"))
                    .query("to", window("to")),
            )
            .await
        }
        "member_assistants_get" => {
            let id = need(args, "id")?;
            api.request(ApiRequest::get(format!(
                "/members/{}/assistants",
                encode(&id)
            )))
            .await
        }
        "member_assistants_set" => {
            let scope = match opt(args, "scope") {
                Some(Value::String(scope)) if scope == "all" || scope == "selected" => scope,
                _ => {
                    return Err(Fail::input(
                        "\"scope\" must be all or selected for member_assistants_set",
                    ));
                }
            };
            let Some(access @ Value::Array(_)) = opt(args, "access") else {
                return Err(Fail::input(
                    "\"access\" is required for member_assistants_set",
                ));
            };
            let id = need(args, "id")?;
            api.request(
                ApiRequest::put(format!("/members/{}/assistants", encode(&id)))
                    .json(json!({ "scope": scope, "access": access })),
            )
            .await
        }
        "audit_log_list" => {
            let text = |key: &str| match args.get(key) {
                Some(Value::String(text)) if !text.is_empty() => Some(text.clone()),
                _ => None,
            };
            // `actions` is a list on the tool and a comma-separated parameter
            // on the route, as the TypeScript client joins it.
            let actions = match args.get("actions") {
                Some(Value::Array(items)) => {
                    let names: Vec<&str> = items.iter().filter_map(Value::as_str).collect();
                    (!names.is_empty()).then(|| names.join(","))
                }
                _ => None,
            };
            let order = match args.get("order") {
                Some(Value::String(order)) if order == "newest" || order == "oldest" => {
                    Some(order.clone())
                }
                _ => None,
            };
            let limit = args
                .get("limit")
                .and_then(Value::as_i64)
                .map(|limit| limit.to_string());
            api.request(
                ApiRequest::get("/audit-log")
                    .query("action", actions)
                    .query("actor", text("actor"))
                    .query("from", text("from"))
                    .query("to", text("to"))
                    .query("order", order)
                    .query("before", text("before"))
                    .query("beforeId", text("beforeId"))
                    .query("limit", limit),
            )
            .await
        }
        _ => Err(unknown_action(args)),
    }
}
