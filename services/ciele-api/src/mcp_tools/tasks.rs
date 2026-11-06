//! `manage_tasks`: the port of its `buildTools` entry in `packages/mcp/src/tools.ts`.

use super::*;

pub(super) async fn tasks(api: &Api<'_>, action: &str, args: &Args) -> Out {
    let id = || need(args, "id");
    let at = |id: &str, tail: &str| format!("/tasks/{}{tail}", encode(id));
    match action {
        "list" => {
            let mut request = ApiRequest::get("/tasks");
            for key in [
                "projectId",
                "assignee",
                "status",
                "label",
                "dueFrom",
                "dueTo",
                "q",
                "improvementId",
            ] {
                request = request.query(key, q(opt(args, key)));
            }
            api.request(request.query("cursor", q(opt(args, "cursor"))))
                .await
        }
        "get" => api.request(ApiRequest::get(at(&id()?, ""))).await,
        "create" => {
            let body = obj(vec![
                ("projectId", Some(need(args, "projectId")?.into())),
                ("title", Some(need(args, "title")?.into())),
                ("description", opt(args, "description")),
                ("priority", opt(args, "priority")),
                ("assigneeMemberId", opt(args, "assigneeMemberId")),
                ("dueDate", opt(args, "dueDate")),
                ("labelIds", opt(args, "labelIds")),
            ]);
            api.request(ApiRequest::post("/tasks").json(body)).await
        }
        "update" => {
            let any = ["patch", "labelIds", "blockedBy", "position", "projectId"]
                .iter()
                .any(|key| args.get(*key).is_some_and(is_truthy))
                || args.contains_key("archived");
            if !any {
                return Err(Fail::input(
                    "\"patch\", \"labelIds\", \"blockedBy\", \"position\", \"projectId\" or \"archived\" is required for update",
                ));
            }
            let id = id()?;
            let body = obj(vec![
                ("patch", opt(args, "patch")),
                ("labelIds", opt(args, "labelIds")),
                ("blockedBy", opt(args, "blockedBy")),
                ("position", opt(args, "position")),
                ("projectId", opt(args, "projectId")),
                ("archived", opt(args, "archived")),
            ]);
            api.request(ApiRequest::patch(at(&id, "")).json(body)).await
        }
        "delete" => api.request(ApiRequest::delete(at(&id()?, ""))).await,
        "list_comments" => api.request(ApiRequest::get(at(&id()?, "/comments"))).await,
        "comment" => {
            let id = id()?;
            let body = need(args, "body")?;
            api.request(ApiRequest::post(at(&id, "/comments")).json(json!({ "body": body })))
                .await
        }
        "labels" => api.request(ApiRequest::get("/task-labels")).await,
        "set_label" => {
            let label = opt_truthy(args, "id").map(|id| js_string(&id));
            let Some(label) = label else {
                let body = obj(vec![
                    ("name", Some(need(args, "name")?.into())),
                    ("color", opt(args, "color")),
                ]);
                return api
                    .request(ApiRequest::post("/task-labels").json(body))
                    .await;
            };
            let path = format!("/task-labels/{}", encode(&label));
            if args.get("delete") == Some(&Value::Bool(true)) {
                return api.request(ApiRequest::delete(path)).await;
            }
            let name = opt_truthy(args, "name");
            let color = opt_truthy(args, "color");
            if name.is_none() && color.is_none() {
                return Err(Fail::input(
                    "\"name\", \"color\" or \"delete\" is required to change a Label",
                ));
            }
            api.request(ApiRequest::patch(path).json(obj(vec![("name", name), ("color", color)])))
                .await
        }
        _ => Err(unknown_action(args)),
    }
}
