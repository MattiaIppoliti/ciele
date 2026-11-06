//! A tool's arguments, checked as the TypeScript SDK checks them (#1135).
//!
//! `McpServer` parses `arguments` with the tool's `z.object(schema)` before the
//! handler runs, and answers a refusal as a tool error whose text is
//! `Input validation error: Invalid arguments for tool <name>: ` followed by
//! every zod issue as `<dotted path>: <message>`, in the shape's order, joined
//! by ", ". The parse also drops keys the schema does not name, so the handler
//! never sees them.
//!
//! This reads the tool's JSON Schema, which is the same zod schema rendered
//! (`packages/mcp/golden`), and covers the shapes the 17 tools use: objects,
//! string enums, strings, numbers, booleans, arrays, records, nullable
//! strings and one union of numeric constants. A shape it does not know is a
//! test failure, not a silent pass (`every_golden_shape_is_one_it_reads`).

use serde_json::{Map, Value};

/// zod's name for a value it received.
fn received(value: Option<&Value>) -> &'static str {
    match value {
        None => "undefined",
        Some(Value::Null) => "null",
        Some(Value::Bool(_)) => "boolean",
        Some(Value::Number(_)) => "number",
        Some(Value::String(_)) => "string",
        Some(Value::Array(_)) => "array",
        Some(Value::Object(_)) => "object",
    }
}

fn expected(what: &str, value: Option<&Value>) -> String {
    format!(
        "Invalid input: expected {what}, received {}",
        received(value)
    )
}

struct Issues(Vec<String>);

impl Issues {
    fn push(&mut self, path: &[String], message: String) {
        self.0.push(format!("{}: {message}", path.join(".")));
    }
}

/// The parsed value, or `None` where an issue was recorded.
fn check(
    schema: &Value,
    value: Option<&Value>,
    path: &mut Vec<String>,
    issues: &mut Issues,
) -> Option<Value> {
    if let Some(any_of) = schema.get("anyOf").and_then(Value::as_array) {
        let nullable = any_of
            .iter()
            .position(|branch| branch.get("type") == Some(&Value::from("null")));
        if let Some(null_at) = nullable {
            if value == Some(&Value::Null) {
                return Some(Value::Null);
            }
            let other = any_of.iter().enumerate().find(|(at, _)| *at != null_at)?.1;
            return check(other, value, path, issues);
        }
        // A union of literals: zod reports the union, not each branch.
        let matched = any_of
            .iter()
            .any(|branch| match (branch.get("const"), value) {
                (Some(constant), Some(Value::Number(n))) => constant.as_f64() == n.as_f64(),
                (Some(constant), Some(value)) => constant == value,
                _ => false,
            });
        if matched {
            return value.cloned();
        }
        issues.push(path, "Invalid input".into());
        return None;
    }
    if let Some(options) = schema.get("enum").and_then(Value::as_array) {
        if let Some(value) = value
            && options.contains(value)
        {
            return Some(value.clone());
        }
        let listed: Vec<String> = options.iter().map(Value::to_string).collect();
        issues.push(
            path,
            format!("Invalid option: expected one of {}", listed.join("|")),
        );
        return None;
    }
    match schema.get("type").and_then(Value::as_str) {
        Some("string") => match value {
            Some(Value::String(_)) => value.cloned(),
            _ => {
                issues.push(path, expected("string", value));
                None
            }
        },
        Some("number") => match value {
            Some(Value::Number(_)) => value.cloned(),
            _ => {
                issues.push(path, expected("number", value));
                None
            }
        },
        Some("boolean") => match value {
            Some(Value::Bool(_)) => value.cloned(),
            _ => {
                issues.push(path, expected("boolean", value));
                None
            }
        },
        Some("array") => {
            let Some(Value::Array(items)) = value else {
                issues.push(path, expected("array", value));
                return None;
            };
            let item_schema = schema.get("items").unwrap_or(&Value::Null);
            let mut parsed = Vec::with_capacity(items.len());
            let before = issues.0.len();
            for (at, item) in items.iter().enumerate() {
                path.push(at.to_string());
                if let Some(item) = check(item_schema, Some(item), path, issues) {
                    parsed.push(item);
                }
                path.pop();
            }
            (issues.0.len() == before).then_some(Value::Array(parsed))
        }
        Some("object") if schema.get("propertyNames").is_some() => {
            // z.record(z.string(), inner): every key kept, every value checked.
            let Some(Value::Object(fields)) = value else {
                issues.push(path, expected("record", value));
                return None;
            };
            let inner = schema.get("additionalProperties").unwrap_or(&Value::Null);
            let mut parsed = Map::new();
            let before = issues.0.len();
            for (key, item) in fields {
                if inner.as_object().is_some_and(Map::is_empty) {
                    parsed.insert(key.clone(), item.clone());
                    continue;
                }
                path.push(key.clone());
                if let Some(item) = check(inner, Some(item), path, issues) {
                    parsed.insert(key.clone(), item);
                }
                path.pop();
            }
            (issues.0.len() == before).then_some(Value::Object(parsed))
        }
        Some("object") => {
            let Some(Value::Object(fields)) = value else {
                issues.push(path, expected("object", value));
                return None;
            };
            let required: Vec<&str> = schema
                .get("required")
                .and_then(Value::as_array)
                .map(|keys| keys.iter().filter_map(Value::as_str).collect())
                .unwrap_or_default();
            let mut parsed = Map::new();
            let before = issues.0.len();
            let properties = schema.get("properties").and_then(Value::as_object);
            for (key, property) in properties.into_iter().flatten() {
                let found = fields.get(key);
                if found.is_none() && !required.contains(&key.as_str()) {
                    continue;
                }
                path.push(key.clone());
                if let Some(item) = check(property, found, path, issues) {
                    parsed.insert(key.clone(), item);
                }
                path.pop();
            }
            (issues.0.len() == before).then_some(Value::Object(parsed))
        }
        // `{}`, z.unknown(): anything.
        None if schema.as_object().is_some_and(Map::is_empty) => value.cloned(),
        other => panic!("a tool schema shape this reader does not know: {other:?} in {schema}"),
    }
}

/// zod's parse of a tool's arguments: the parsed (stripped) object, or the
/// SDK's error text.
pub fn parse_arguments(
    tool: &str,
    schema: &Value,
    arguments: &Map<String, Value>,
) -> Result<Map<String, Value>, String> {
    let mut issues = Issues(Vec::new());
    let value = Value::Object(arguments.clone());
    match check(schema, Some(&value), &mut Vec::new(), &mut issues) {
        Some(Value::Object(parsed)) if issues.0.is_empty() => Ok(parsed),
        _ => Err(format!(
            "Input validation error: Invalid arguments for tool {tool}: {}",
            issues.0.join(", ")
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn tool(name: &str) -> Value {
        let tools: Vec<Value> = serde_json::from_str(crate::mcp::TOOLS_JSON).unwrap();
        tools.into_iter().find(|tool| tool["name"] == name).unwrap()["inputSchema"].clone()
    }

    fn parse(name: &str, args: Value) -> Result<Value, String> {
        parse_arguments(name, &tool(name), args.as_object().unwrap()).map(Value::Object)
    }

    /// Each expectation is the TypeScript server's text for the same call.
    #[test]
    fn words_its_refusal_as_the_sdk_does() {
        let refused = |name, args| parse(name, args).unwrap_err();
        assert_eq!(
            refused(
                "manage_assistants",
                json!({ "action": 5, "limit": "x", "id": 3 })
            ),
            "Input validation error: Invalid arguments for tool manage_assistants: action: Invalid option: expected one of \"export\"|\"import\"|\"get_access\"|\"set_access\"|\"clear_access\"|\"ask\"|\"list\"|\"get\"|\"create\"|\"update\"|\"delete\"|\"duplicate\", id: Invalid input: expected string, received number, limit: Invalid input: expected number, received string"
        );
        assert_eq!(
            refused(
                "manage_projects",
                json!({ "action": "set_milestones", "id": "p", "milestones": [{ "name": 1 }, "x"] })
            ),
            "Input validation error: Invalid arguments for tool manage_projects: milestones.0.name: Invalid input: expected string, received number, milestones.0.date: Invalid input: expected string, received undefined, milestones.1: Invalid input: expected object, received string"
        );
        assert_eq!(
            refused(
                "manage_tasks",
                json!({ "action": "update", "id": "t", "position": { "afterId": 3 } })
            ),
            "Input validation error: Invalid arguments for tool manage_tasks: position.afterId: Invalid input: expected string, received number"
        );
        assert_eq!(
            refused(
                "read_inbox",
                json!({ "action": "list", "inputs": { "a": 1 } })
            ),
            "Input validation error: Invalid arguments for tool read_inbox: inputs.a: Invalid input: expected string, received number"
        );
        assert_eq!(
            refused(
                "read_inbox",
                json!({ "action": "message_feedback", "feedback": 2 })
            ),
            "Input validation error: Invalid arguments for tool read_inbox: feedback: Invalid input"
        );
        assert_eq!(
            refused(
                "manage_sso",
                json!({ "action": "set_identity", "identityClaim": 4 })
            ),
            "Input validation error: Invalid arguments for tool manage_sso: identityClaim: Invalid input: expected string, received number"
        );
        assert_eq!(
            refused(
                "manage_assistants",
                json!({ "action": "update", "id": "a", "patch": [] })
            ),
            "Input validation error: Invalid arguments for tool manage_assistants: patch: Invalid input: expected record, received array"
        );
        assert_eq!(
            refused("publish_assistant", json!({ "action": "status" })),
            "Input validation error: Invalid arguments for tool publish_assistant: assistantId: Invalid input: expected string, received undefined"
        );
    }

    #[test]
    fn drops_the_keys_the_schema_does_not_name() {
        assert_eq!(
            parse(
                "manage_assistants",
                json!({ "action": "list", "extra": 1, "limit": 2 })
            )
            .unwrap(),
            json!({ "action": "list", "limit": 2 })
        );
        assert_eq!(
            parse("manage_projects", json!({ "action": "set_milestones", "milestones": [{ "name": "n", "date": "d", "x": 1 }] })).unwrap(),
            json!({ "action": "set_milestones", "milestones": [{ "name": "n", "date": "d" }] })
        );
        // A record keeps every key.
        assert_eq!(
            parse(
                "manage_assistants",
                json!({ "action": "update", "patch": { "a": { "b": 1 } } })
            )
            .unwrap()["patch"],
            json!({ "a": { "b": 1 } })
        );
        assert_eq!(
            parse(
                "manage_sso",
                json!({ "action": "set_identity", "identityClaim": null })
            )
            .unwrap(),
            json!({ "action": "set_identity", "identityClaim": null })
        );
    }

    /// Every schema in both recordings parses some input without reaching the
    /// panic above, so a new shape fails here rather than in production.
    #[test]
    fn every_golden_shape_is_one_it_reads() {
        for recorded in [crate::mcp::TOOLS_JSON, crate::mcp::TOOLS_READ_ONLY_JSON] {
            let tools: Vec<Value> = serde_json::from_str(recorded).unwrap();
            for tool in tools {
                let name = tool["name"].as_str().unwrap();
                let schema = &tool["inputSchema"];
                // Each property once with a wrong type and once absent walks every branch.
                let mut wrong = Map::new();
                for key in schema["properties"].as_object().unwrap().keys() {
                    wrong.insert(key.clone(), json!({ "x": [1, "y", null] }));
                }
                let _ = parse_arguments(name, schema, &wrong);
                let _ = parse_arguments(name, schema, &Map::new());
            }
        }
    }
}
