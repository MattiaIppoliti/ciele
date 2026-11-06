//! The 17 tools' calls (#1135): the port of `buildTools` in
//! `packages/mcp/src/tools.ts`, the client methods it calls in
//! `packages/client/src/index.ts`, and `callTool` in `packages/mcp/src/server.ts`.
//!
//! Each action builds the `/api/v1` request its client method sends, in the
//! order the TypeScript evaluates its arguments, so the same missing field is
//! the one reported. [`crate::mcp_api`] decides whether the request runs here
//! or at the web app. The MCP parity test in `apps/web` drives every action
//! through both servers and compares the requests and the answers.

use rmcp::ErrorData;
use rmcp::model::{CallToolRequestParams, CallToolResult, ContentBlock as Content, Tool};
use serde_json::{Map, Value, json};

use crate::AppState;
use crate::mcp::Caller;
use crate::mcp_api::{Api, ApiRequest, Fail, Field, encode, js_normalize, js_string};
use crate::mcp_schema;

type Args = Map<String, Value>;
/// `None` is `undefined`: a 204, written as `null`.
type Out = Result<Option<Value>, Fail>;

mod assistants;
mod channels;
mod configuration;
mod flows;
mod help_desks;
mod identity;
mod improvements;
mod inbox;
mod integrations;
mod knowledge;
mod memories;
mod organization;
mod projects;
mod publish;
mod sso;
mod tasks;
mod teammates;

use assistants::assistants;
use channels::channels;
use configuration::configuration;
use flows::flows;
use help_desks::help_desks;
use identity::identity;
use improvements::improvements;
use inbox::inbox;
use integrations::integrations;
use knowledge::knowledge;
use memories::memories;
use organization::organization;
use projects::projects;
use publish::publish;
use sso::sso;
use tasks::tasks;
use teammates::teammates;

/// `READ_ACTIONS` in tools.ts: what `byAction` lets through in read-only mode.
const READ_ACTIONS: &[&str] = &[
    "search",
    "list",
    "get",
    "review_list",
    "review_get",
    "status",
    "list_collections",
    "list_sources",
    "list_org_sources",
    "get_access",
    "get_source",
    "list_documents",
    "get_faq",
    "faq_history",
    "check_faq_duplicates",
    "source_usage",
    "export",
    "export_faqs",
    "subjects",
    "settings",
    "conversations",
    "conversation",
    "grants",
    "runtime",
    "routines",
    "memory",
    "catalog",
    "draft",
    "validate",
    "runs",
    "agent_thread",
    "agent_conversation",
    "oversight",
    "oversight_read",
    "list_comments",
    "labels",
    "list_milestones",
];

/// Each tool's `mutates`.
fn mutates(tool: &str, action: &str) -> bool {
    let unless = |reads: &[&str]| !reads.contains(&action);
    match tool {
        "ciele_identity" => false,
        "manage_memories" => unless(&["settings", "subjects", "list"]),
        "manage_sso" => unless(&["status", "connection"]),
        "manage_configuration" => unless(&[
            "export_schedule_list",
            "skill_list",
            "assistant_skills_get",
            "goal_list",
            "alert_list",
            "quick_text_list",
            "business_hours_list",
            "webhook_list",
            "webhook_deliveries",
        ]),
        "manage_organization" => unless(&[
            "get",
            "member_list",
            "invite_list",
            "api_key_list",
            "usage_meters",
            "usage_spenders",
            "audit_log_list",
            "member_assistants_get",
            "role_list",
            "role_get",
        ]),
        "manage_integrations" => unless(&[
            "api_get",
            "provider_list",
            "application_list",
            "application_connectors",
            "application_reconsent",
        ]),
        _ => !READ_ACTIONS.contains(&action),
    }
}

// --- the argument readers of tools.ts ---------------------------------------

fn required(key: &str) -> Fail {
    Fail::input(format!("\"{key}\" is required for this action"))
}

/// `need`: a non-empty string.
fn need(args: &Args, key: &str) -> Result<String, Fail> {
    match args.get(key) {
        Some(Value::String(text)) if !text.is_empty() => Ok(text.clone()),
        _ => Err(required(key)),
    }
}

/// `needObject`: an object, not an array.
fn need_object(args: &Args, key: &str) -> Result<Value, Fail> {
    match args.get(key) {
        Some(value @ Value::Object(_)) => Ok(value.clone()),
        _ => Err(required(key)),
    }
}

/// `needList`: a non-empty array, each item through `String`.
fn need_list(args: &Args, key: &str) -> Result<Value, Fail> {
    match args.get(key) {
        Some(Value::Array(items)) if !items.is_empty() => Ok(Value::Array(
            items
                .iter()
                .map(|item| Value::String(js_string(item)))
                .collect(),
        )),
        _ => Err(Fail::input(format!(
            "\"{key}\" must be a non-empty array of ids"
        ))),
    }
}

/// `needLinkTargets`: the non-empty `assistantIds`.
fn need_link_targets(args: &Args) -> Result<Vec<String>, Fail> {
    let ids: Vec<String> = match args.get("assistantIds") {
        Some(Value::Array(items)) => items
            .iter()
            .map(js_string)
            .filter(|id| !id.is_empty())
            .collect(),
        _ => Vec::new(),
    };
    if ids.is_empty() {
        return Err(Fail::input(
            "\"assistantIds\" is required for this action: name at least one Assistant to link this knowledge to",
        ));
    }
    Ok(ids)
}

/// `optStr` / `optNum`: the value as given, absent when absent.
fn opt(args: &Args, key: &str) -> Option<Value> {
    args.get(key).cloned()
}

/// `optStr(args, key) || undefined`: a non-empty string.
fn opt_truthy(args: &Args, key: &str) -> Option<Value> {
    match args.get(key) {
        Some(Value::String(text)) if text.is_empty() => None,
        Some(value) if is_truthy(value) => Some(value.clone()),
        _ => None,
    }
}

fn is_truthy(value: &Value) -> bool {
    match value {
        Value::Null => false,
        Value::Bool(flag) => *flag,
        Value::Number(number) => number.as_f64().is_some_and(|n| n != 0.0),
        Value::String(text) => !text.is_empty(),
        _ => true,
    }
}

/// A query value: `String(value)` when present.
fn q(value: Option<Value>) -> Option<String> {
    value.as_ref().map(js_string)
}

/// An object literal: keys whose value is `undefined` are left out, as
/// `JSON.stringify` leaves them out.
fn obj(fields: Vec<(&str, Option<Value>)>) -> Value {
    Value::Object(
        fields
            .into_iter()
            .filter_map(|(key, value)| value.map(|value| (key.to_owned(), value)))
            .collect(),
    )
}

fn unknown_action(args: &Args) -> Fail {
    Fail::input(format!(
        "Unknown action \"{}\"",
        args.get("action").map(js_string).unwrap_or_default()
    ))
}

/// `Buffer.from(text, "base64")`: lenient, URL-safe letters too, stops at `=`.
fn base64_lenient(text: &str) -> Vec<u8> {
    let sextet = |c: u8| match c {
        b'A'..=b'Z' => Some(c - b'A'),
        b'a'..=b'z' => Some(c - b'a' + 26),
        b'0'..=b'9' => Some(c - b'0' + 52),
        b'+' | b'-' => Some(62),
        b'/' | b'_' => Some(63),
        _ => None,
    };
    let mut out = Vec::new();
    let (mut buffer, mut bits) = (0u32, 0);
    for byte in text.bytes() {
        if byte == b'=' {
            break;
        }
        let Some(value) = sextet(byte) else { continue };
        buffer = (buffer << 6) | u32::from(value);
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push((buffer >> bits) as u8);
            buffer &= (1 << bits) - 1;
        }
    }
    out
}

/// `linkedForm(file, assistantIds)`.
fn linked_form(
    filename: String,
    mime: &'static str,
    bytes: Vec<u8>,
    links: &[String],
) -> Vec<Field> {
    vec![
        Field::File {
            name: "file",
            filename,
            mime,
            bytes,
        },
        Field::Text("assistantIds", Value::from(links.to_vec()).to_string()),
    ]
}

/// `new File([bytes], name || "upload.bin")`: a File with no type goes out as
/// `application/octet-stream`.
fn upload(args: &Args) -> Result<(String, Vec<u8>), Fail> {
    let bytes = base64_lenient(&need(args, "fileBase64")?);
    let name = match args.get("name") {
        Some(value) if is_truthy(value) => js_string(value),
        _ => "upload.bin".into(),
    };
    Ok((name, bytes))
}

// --- the call -----------------------------------------------------------------

/// `callTool`: validate, the read-only gate, run, and the one-text-block result.
pub async fn call(
    state: &AppState,
    caller: &Caller,
    tools: &[Tool],
    request: CallToolRequestParams,
) -> Result<CallToolResult, ErrorData> {
    let Some(tool) = tools.iter().find(|tool| tool.name == request.name) else {
        return Err(ErrorData::invalid_params(
            format!("Tool {} not found", request.name),
            None,
        ));
    };
    let schema = Value::Object((*tool.input_schema).clone());
    let arguments = request.arguments.unwrap_or_default();
    let args = match mcp_schema::parse_arguments(&tool.name, &schema, &arguments) {
        Ok(parsed) => match js_normalize(Value::Object(parsed)) {
            Value::Object(parsed) => parsed,
            _ => Map::new(),
        },
        Err(text) => return Ok(failure(text)),
    };
    let action = args.get("action").map(js_string).unwrap_or_default();
    if state.mcp.read_only && mutates(&tool.name, &action) {
        return Ok(failure(format!(
            "Read-only mode: \"{}\" action \"{action}\" would write. Unset CIELE_MCP_READ_ONLY to allow mutations.",
            tool.name
        )));
    }
    let api = Api { state, caller };
    match run(&api, &tool.name, &args).await {
        Ok(value) => {
            let text = serde_json::to_string_pretty(&value.unwrap_or(Value::Null))
                .unwrap_or_else(|_| "null".into());
            let mut result = CallToolResult::success(vec![Content::text(text)]);
            // The TypeScript server sends no `isError` on success.
            result.is_error = None;
            Ok(result)
        }
        Err(fail) => Ok(failure(fail.text())),
    }
}

fn failure(text: String) -> CallToolResult {
    CallToolResult::error(vec![Content::text(text)])
}

async fn run(api: &Api<'_>, tool: &str, args: &Args) -> Out {
    let action = args.get("action").and_then(Value::as_str).unwrap_or("");
    match tool {
        "ciele_identity" => identity(api).await,
        "manage_assistants" => assistants(api, action, args).await,
        "manage_flows" => flows(api, action, args).await,
        "manage_knowledge" => knowledge(api, action, args).await,
        "manage_memories" => memories(api, action, args).await,
        "manage_sso" => sso(api, action, args).await,
        "publish_assistant" => publish(api, action, args).await,
        "read_inbox" => inbox(api, action, args).await,
        "manage_improvements" => improvements(api, action, args).await,
        "manage_teammates" => teammates(api, action, args).await,
        "manage_projects" => projects(api, action, args).await,
        "manage_tasks" => tasks(api, action, args).await,
        "manage_channels" => channels(api, action, args).await,
        "manage_help_desks" => help_desks(api, action, args).await,
        "manage_configuration" => configuration(api, action, args).await,
        "manage_organization" => organization(api, action, args).await,
        "manage_integrations" => integrations(api, action, args).await,
        _ => Err(unknown_action(args)),
    }
}

fn echo(key: &str, value: Option<Value>) -> Out {
    Ok(Some(obj(vec![(key, value)])))
}

#[cfg(test)]
mod tests {
    use super::teammates::teammate_runtime;
    use super::*;

    #[test]
    fn reads_base64_as_node_buffer_does() {
        assert_eq!(base64_lenient("aGk="), b"hi");
        assert_eq!(base64_lenient("aGk"), b"hi");
        assert_eq!(base64_lenient("a G\nk"), b"hi");
        assert_eq!(base64_lenient("-_8"), vec![0xfb, 0xff]);
    }

    #[test]
    fn gates_writes_as_each_tool_declares() {
        assert!(!mutates("ciele_identity", "anything"));
        assert!(mutates("manage_assistants", "delete"));
        assert!(!mutates("manage_assistants", "list"));
        assert!(!mutates("manage_integrations", "application_reconsent"));
        assert!(mutates("manage_memories", "wipe"));
        assert!(!mutates("manage_flows", "draft"));
        assert!(mutates("read_inbox", "pin"));
    }

    /// `packages/mcp/golden/mutates.json`, written from every TypeScript
    /// tool's `mutates(args)`: the read-only boundary is the same pair by pair.
    #[test]
    fn refuses_in_read_only_mode_exactly_what_typescript_refuses() {
        let table: serde_json::Map<String, Value> =
            serde_json::from_str(include_str!("../../../../packages/mcp/golden/mutates.json"))
                .expect("mutates.json is a JSON object");
        let mut pairs = 0;
        for (tool, actions) in &table {
            for (action, expected) in actions.as_object().expect("one object per tool") {
                // With no action, Rust reads "" where TypeScript reads "undefined";
                // neither is in any read set.
                let action = if action == "(absent)" {
                    ""
                } else {
                    action.as_str()
                };
                assert_eq!(
                    mutates(tool, action),
                    expected.as_bool().expect("a boolean per action"),
                    "{tool} {action:?}"
                );
                pairs += 1;
            }
        }
        assert_eq!(table.len(), 17, "every tool is in the table");
        assert!(
            pairs > table.len(),
            "the table lists actions, not only tools"
        );
    }

    #[test]
    fn words_a_runtime_refusal_as_zod_does() {
        let refused = teammate_runtime(&json!({ "harness": { "kind": "x" } })).unwrap_err();
        assert_eq!(
            refused.text(),
            "[\n  {\n    \"code\": \"invalid_union\",\n    \"errors\": [],\n    \"note\": \"No matching discriminator\",\n    \"discriminator\": \"kind\",\n    \"options\": [\n      \"ciele\",\n      \"ag_ui\"\n    ],\n    \"path\": [\n      \"harness\",\n      \"kind\"\n    ],\n    \"message\": \"Invalid discriminator value. Expected 'ciele' | 'ag_ui'\"\n  },\n  {\n    \"expected\": \"boolean\",\n    \"code\": \"invalid_type\",\n    \"path\": [\n      \"internet\"\n    ],\n    \"message\": \"Invalid input: expected boolean, received undefined\"\n  },\n  {\n    \"expected\": \"object\",\n    \"code\": \"invalid_type\",\n    \"path\": [\n      \"computer\"\n    ],\n    \"message\": \"Invalid input: expected object, received undefined\"\n  }\n]"
        );
    }
}
