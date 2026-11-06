//! `manage_configuration`: the port of its `buildTools` entry in `packages/mcp/src/tools.ts`.

use super::*;

pub(super) async fn configuration(api: &Api<'_>, action: &str, args: &Args) -> Out {
    let goals =
        |assistant: &str, tail: &str| format!("/assistants/{}/goals{tail}", encode(assistant));
    match action {
        "skill_list" => api.request(ApiRequest::get("/skills")).await,
        "skill_create" => {
            let input = need_object(args, "input")?;
            api.request(ApiRequest::post("/skills").json(input)).await
        }
        "skill_update" => {
            let id = need(args, "id")?;
            let patch = need_object(args, "patch")?;
            api.request(ApiRequest::patch(format!("/skills/{}", encode(&id))).json(patch))
                .await
        }
        "skill_delete" => {
            let id = need(args, "id")?;
            api.request(ApiRequest::delete(format!("/skills/{}", encode(&id))))
                .await?;
            echo("deleted", opt(args, "id"))
        }
        "assistant_skills_get" => {
            let assistant = need(args, "assistantId")?;
            api.request(ApiRequest::get(format!(
                "/assistants/{}/skills",
                encode(&assistant)
            )))
            .await
        }
        "assistant_skills_set" => {
            let Some(ids @ Value::Array(_)) = opt(args, "skillIds") else {
                return Err(Fail::input(
                    "\"skillIds\" is required for assistant_skills_set",
                ));
            };
            let assistant = need(args, "assistantId")?;
            api.request(
                ApiRequest::patch(format!("/assistants/{}/skills", encode(&assistant)))
                    .json(json!({ "skillIds": ids })),
            )
            .await
        }
        "goal_list" => {
            let assistant = need(args, "assistantId")?;
            api.request(ApiRequest::get(goals(&assistant, ""))).await
        }
        "goal_create" => {
            let assistant = need(args, "assistantId")?;
            let input = need_object(args, "input")?;
            api.request(ApiRequest::post(goals(&assistant, "")).json(input))
                .await
        }
        "goal_update" => {
            let assistant = need(args, "assistantId")?;
            let goal = need(args, "goalId")?;
            let patch = need_object(args, "patch")?;
            api.request(
                ApiRequest::patch(goals(&assistant, &format!("/{}", encode(&goal)))).json(patch),
            )
            .await
        }
        "goal_delete" => {
            let assistant = need(args, "assistantId")?;
            let goal = need(args, "goalId")?;
            api.request(ApiRequest::delete(goals(
                &assistant,
                &format!("/{}", encode(&goal)),
            )))
            .await?;
            echo("deleted", opt(args, "goalId"))
        }
        "alert_list" => api.request(ApiRequest::get("/alerts")).await,
        "alert_resolve" => {
            let id = need(args, "id")?;
            api.request(ApiRequest::post(format!("/alerts/{}/resolve", encode(&id))))
                .await
        }
        "export_schedule_list" => api.request(ApiRequest::get("/exports/schedules")).await,
        "export_schedule_create" => {
            let input = need_object(args, "input")?;
            api.request(ApiRequest::post("/exports/schedules").json(input))
                .await
        }
        "export_schedule_update" => {
            let id = need(args, "id")?;
            let patch = need_object(args, "patch")?;
            api.request(
                ApiRequest::patch(format!("/exports/schedules/{}", encode(&id))).json(patch),
            )
            .await
        }
        "export_schedule_delete" => {
            let id = need(args, "id")?;
            api.request(ApiRequest::delete(format!(
                "/exports/schedules/{}",
                encode(&id)
            )))
            .await?;
            echo("deleted", opt(args, "id"))
        }
        "quick_text_list" => api.request(ApiRequest::get("/quick-texts")).await,
        "quick_text_create" => {
            let input = need_object(args, "input")?;
            api.request(ApiRequest::post("/quick-texts").json(input))
                .await
        }
        "quick_text_update" => {
            let id = need(args, "id")?;
            let patch = need_object(args, "patch")?;
            api.request(ApiRequest::patch(format!("/quick-texts/{}", encode(&id))).json(patch))
                .await
        }
        "quick_text_delete" => {
            let id = need(args, "id")?;
            api.request(ApiRequest::delete(format!("/quick-texts/{}", encode(&id))))
                .await?;
            echo("deleted", opt(args, "id"))
        }
        "business_hours_list" => api.request(ApiRequest::get("/business-hours")).await,
        "business_hours_create" => {
            let input = need_object(args, "input")?;
            api.request(ApiRequest::post("/business-hours").json(input))
                .await
        }
        "business_hours_update" => {
            let id = need(args, "id")?;
            let patch = need_object(args, "patch")?;
            api.request(ApiRequest::patch(format!("/business-hours/{}", encode(&id))).json(patch))
                .await
        }
        "business_hours_delete" => {
            let id = need(args, "id")?;
            api.request(ApiRequest::delete(format!(
                "/business-hours/{}",
                encode(&id)
            )))
            .await?;
            echo("deleted", opt(args, "id"))
        }
        "business_hours_timezone" => {
            let input = need_object(args, "input")?;
            let timezone = match input.get("timezone") {
                Some(Value::String(text)) if !text.is_empty() => text.clone(),
                _ => return Err(required("timezone")),
            };
            api.request(
                ApiRequest::patch("/business-hours/timezone").json(json!({ "timezone": timezone })),
            )
            .await
        }
        "webhook_list" => api.request(ApiRequest::get("/webhooks")).await,
        "webhook_create" => {
            let input = need_object(args, "input")?;
            api.request(ApiRequest::post("/webhooks").json(input)).await
        }
        "webhook_update" => {
            let id = need(args, "id")?;
            let patch = need_object(args, "patch")?;
            api.request(ApiRequest::patch(format!("/webhooks/{}", encode(&id))).json(patch))
                .await
        }
        "webhook_delete" => {
            let id = need(args, "id")?;
            api.request(ApiRequest::delete(format!("/webhooks/{}", encode(&id))))
                .await?;
            echo("deleted", opt(args, "id"))
        }
        "webhook_pause" | "webhook_resume" => {
            let id = need(args, "id")?;
            let paused = action == "webhook_pause";
            api.request(
                ApiRequest::patch(format!("/webhooks/{}", encode(&id)))
                    .json(json!({ "paused": paused })),
            )
            .await
        }
        "webhook_deliveries" => {
            let id = need(args, "id")?;
            api.request(ApiRequest::get(format!(
                "/webhooks/{}/deliveries",
                encode(&id)
            )))
            .await
        }
        "webhook_test" => {
            let id = need(args, "id")?;
            api.request(ApiRequest::post(format!("/webhooks/{}/test", encode(&id))))
                .await
        }
        _ => Err(unknown_action(args)),
    }
}
