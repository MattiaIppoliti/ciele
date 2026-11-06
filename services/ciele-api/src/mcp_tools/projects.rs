//! `manage_projects`: the port of its `buildTools` entry in `packages/mcp/src/tools.ts`.

use super::*;

pub(super) async fn projects(api: &Api<'_>, action: &str, args: &Args) -> Out {
    let id = || need(args, "id");
    let at = |id: &str, tail: &str| format!("/projects/{}{tail}", encode(id));
    match action {
        "list" => api.request(ApiRequest::get("/projects")).await,
        "get" => api.request(ApiRequest::get(at(&id()?, ""))).await,
        "create" => {
            let body = obj(vec![
                ("name", Some(need(args, "name")?.into())),
                ("description", opt(args, "description")),
            ]);
            api.request(ApiRequest::post("/projects").json(body)).await
        }
        "update" => {
            let Some(patch) = opt(args, "patch") else {
                return Err(Fail::input("\"patch\" is required for update"));
            };
            api.request(ApiRequest::patch(at(&id()?, "")).json(patch))
                .await
        }
        "delete" => {
            api.request(ApiRequest::delete(at(&id()?, ""))).await?;
            echo("deleted", opt(args, "id"))
        }
        "set_document" => {
            let id = id()?;
            let body = obj(vec![
                ("body", Some(need(args, "body")?.into())),
                ("note", opt(args, "note")),
            ]);
            api.request(ApiRequest::put(at(&id, "/document")).json(body))
                .await
        }
        "list_milestones" => {
            api.request(ApiRequest::get(at(&id()?, "/milestones")))
                .await
        }
        "set_milestones" => {
            let Some(milestones) = opt(args, "milestones") else {
                return Err(Fail::input("\"milestones\" is required for set_milestones"));
            };
            api.request(
                ApiRequest::put(at(&id()?, "/milestones"))
                    .json(json!({ "milestones": milestones })),
            )
            .await
        }
        _ => Err(unknown_action(args)),
    }
}
