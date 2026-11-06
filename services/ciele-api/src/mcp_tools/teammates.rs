//! `manage_teammates`: the port of its `buildTools` entry in `packages/mcp/src/tools.ts`.

use super::*;

/// `teammateRuntimeInput.parse(config)`, which throws a ZodError whose
/// message is its issues as pretty JSON.
pub(super) fn teammate_runtime(config: &Value) -> Result<Value, Fail> {
    let mut issues: Vec<Value> = Vec::new();
    let strict = |value: &Map<String, Value>,
                  allowed: &[&str],
                  path: Vec<Value>,
                  issues: &mut Vec<Value>| {
        let extra: Vec<&String> = value
            .keys()
            .filter(|key| !allowed.contains(&key.as_str()))
            .collect();
        if !extra.is_empty() {
            let quoted: Vec<String> = extra.iter().map(|key| format!("\"{key}\"")).collect();
            let plural = if extra.len() == 1 { "" } else { "s" };
            issues.push(json!({
                "code": "unrecognized_keys",
                "keys": extra,
                "path": path,
                "message": format!("Unrecognized key{plural}: {}", quoted.join(", ")),
            }));
        }
    };
    let received = |value: Option<&Value>| match value {
        None => "undefined",
        Some(Value::Null) => "null",
        Some(Value::Bool(_)) => "boolean",
        Some(Value::Number(_)) => "number",
        Some(Value::String(_)) => "string",
        Some(Value::Array(_)) => "array",
        Some(Value::Object(_)) => "object",
    };
    let invalid = |expected: &str, value: Option<&Value>, path: Vec<Value>| {
        json!({
            "expected": expected,
            "code": "invalid_type",
            "path": path,
            "message": format!("Invalid input: expected {expected}, received {}", received(value)),
        })
    };
    let Value::Object(fields) = config else {
        return Err(Fail::Other("unreachable: config is an object".into()));
    };
    match fields.get("harness") {
        Some(Value::Object(harness)) => match harness.get("kind").and_then(Value::as_str) {
            Some("ciele") => strict(harness, &["kind"], vec!["harness".into()], &mut issues),
            Some("ag_ui") => {
                if !matches!(harness.get("connectionId"), Some(Value::String(_))) {
                    issues.push(invalid(
                        "string",
                        harness.get("connectionId"),
                        vec!["harness".into(), "connectionId".into()],
                    ));
                }
                strict(
                    harness,
                    &["kind", "connectionId"],
                    vec!["harness".into()],
                    &mut issues,
                );
            }
            _ => issues.push(json!({
                "code": "invalid_union",
                "errors": [],
                "note": "No matching discriminator",
                "discriminator": "kind",
                "options": ["ciele", "ag_ui"],
                "path": ["harness", "kind"],
                "message": "Invalid discriminator value. Expected 'ciele' | 'ag_ui'",
            })),
        },
        other => issues.push(invalid("object", other, vec!["harness".into()])),
    }
    if !matches!(fields.get("internet"), Some(Value::Bool(_))) {
        issues.push(invalid(
            "boolean",
            fields.get("internet"),
            vec!["internet".into()],
        ));
    }
    match fields.get("computer") {
        Some(Value::Object(computer)) => {
            for key in ["browser", "files", "terminal"] {
                if !matches!(computer.get(key), Some(Value::Bool(_))) {
                    issues.push(invalid(
                        "boolean",
                        computer.get(key),
                        vec!["computer".into(), key.into()],
                    ));
                }
            }
            strict(
                computer,
                &["browser", "files", "terminal"],
                vec!["computer".into()],
                &mut issues,
            );
        }
        other => issues.push(invalid("object", other, vec!["computer".into()])),
    }
    strict(
        fields,
        &["harness", "internet", "computer"],
        vec![],
        &mut issues,
    );
    if issues.is_empty() {
        return Ok(config.clone());
    }
    Err(Fail::Other(
        serde_json::to_string_pretty(&issues).unwrap_or_default(),
    ))
}

pub(super) async fn teammates(api: &Api<'_>, action: &str, args: &Args) -> Out {
    let id = || need(args, "id");
    let at = |id: &str, tail: &str| format!("/teammates/{}{tail}", encode(id));
    match action {
        "list" => api.request(ApiRequest::get("/teammates")).await,
        "get" => api.request(ApiRequest::get(at(&id()?, ""))).await,
        "create" => {
            let input = need_object(args, "input")?;
            api.request(ApiRequest::post("/teammates").json(input))
                .await
        }
        "provision" => {
            let routine = match args.get("instruction") {
                Some(Value::String(instruction)) => Some(json!([obj(vec![
                    ("instruction", Some(instruction.clone().into())),
                    (
                        "cadence",
                        Some(match args.get("cadence") {
                            Some(Value::Null) | None => "daily".into(),
                            Some(cadence) => cadence.clone(),
                        })
                    ),
                    ("hour", opt(args, "hour")),
                ])])),
                _ => None,
            };
            let Value::Object(mut body) = obj(vec![
                ("grants", opt(args, "domains")),
                ("ceiling", opt(args, "ceiling")),
                ("approvalBypass", opt(args, "approvalBypass")),
                ("routines", routine),
            ]) else {
                unreachable!("obj builds an object")
            };
            if let Value::Object(input) = need_object(args, "input")? {
                for (key, value) in input {
                    body.insert(key, value);
                }
            }
            api.request(ApiRequest::post("/teammates/provision").json(Value::Object(body)))
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
        "conversations" => {
            api.request(ApiRequest::get(at(&id()?, "/conversations")))
                .await
        }
        "conversation" => {
            let id = id()?;
            let conversation = need(args, "conversationId")?;
            api.request(ApiRequest::get(at(
                &id,
                &format!("/conversations/{}", encode(&conversation)),
            )))
            .await
        }
        "grants" => api.request(ApiRequest::get(at(&id()?, "/grants"))).await,
        "runtime" => api.request(ApiRequest::get(at(&id()?, "/runtime"))).await,
        "set_runtime" => {
            let id = id()?;
            let config = teammate_runtime(&need_object(args, "config")?)?;
            api.request(ApiRequest::put(at(&id, "/runtime")).json(config))
                .await
        }
        "ag_ui" => {
            let id = id()?;
            let input = need_object(args, "input")?;
            let response = api
                .send(
                    ApiRequest::post(at(&id, "/ag-ui"))
                        .json(input)
                        .accept("text/event-stream"),
                )
                .await?;
            Ok(Some(json!({
                "contentType": response.content_type,
                "events": String::from_utf8_lossy(&response.bytes),
            })))
        }
        "set_grants" => {
            let Some(Value::Array(domains)) = args.get("domains") else {
                return Err(Fail::input(
                    "\"domains\" is required for set_grants: send the whole set, an empty array revokes everything",
                ));
            };
            let id = id()?;
            let domains: Vec<String> = domains.iter().map(js_string).collect();
            let body = obj(vec![
                ("domains", Some(domains.into())),
                ("ceiling", opt(args, "ceiling")),
                ("approvalBypass", opt(args, "approvalBypass")),
            ]);
            api.request(ApiRequest::put(at(&id, "/grants")).json(body))
                .await
        }
        "routines" => api.request(ApiRequest::get(at(&id()?, "/routines"))).await,
        "add_routine" => {
            let id = id()?;
            let body = obj(vec![
                ("instruction", Some(need(args, "instruction")?.into())),
                ("cadence", Some(need(args, "cadence")?.into())),
                ("hour", opt(args, "hour")),
            ]);
            api.request(ApiRequest::post(at(&id, "/routines")).json(body))
                .await
        }
        "update_routine" => {
            let Some(patch) = opt(args, "patch") else {
                return Err(Fail::input("\"patch\" is required for update_routine"));
            };
            let routine = need(args, "routineId")?;
            api.request(ApiRequest::patch(format!("/routines/{}", encode(&routine))).json(patch))
                .await
        }
        "delete_routine" => {
            let routine = need(args, "routineId")?;
            api.request(ApiRequest::delete(format!(
                "/routines/{}",
                encode(&routine)
            )))
            .await?;
            echo("deleted", opt(args, "routineId"))
        }
        "memory" => api.request(ApiRequest::get(at(&id()?, "/memory"))).await,
        "set_memory" => {
            let id = id()?;
            let body = obj(vec![
                ("body", Some(need(args, "body")?.into())),
                ("note", opt(args, "note")),
            ]);
            api.request(ApiRequest::put(at(&id, "/memory")).json(body))
                .await
        }
        _ => Err(unknown_action(args)),
    }
}
