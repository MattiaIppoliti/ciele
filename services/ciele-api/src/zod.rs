//! zod's first issue, word for word, for the inputs `/api/v1` can reach here.
//!
//! On the `/v1/ops` path the web app has already run zod, and a refusal from
//! this service only has to carry the right code. On `/api/v1` (#1134) the
//! caller reads the message: the TypeScript route answers
//! `422 {"error":{"code":"invalid_input","message": issues[0].message}}`, so
//! the same body here needs zod's own wording, issue order included.
//!
//! [`schema`] holds one schema per operation a [`crate::v1`] endpoint runs,
//! transcribed from its `input` in `packages/ops`. A test fails when an
//! endpoint names an operation without one, and the `/api/v1` parity test in
//! `apps/web` compares the messages with zod's own.

use serde_json::Value;

use crate::js::js_length;

/// The slice of zod those schemas use.
pub enum Schema {
    /// `z.object(shape)`: unknown keys are dropped, never refused.
    Object(&'static [(&'static str, Schema)]),
    /// `z.object(shape).partial()`: every key may be missing.
    Partial(&'static [(&'static str, Schema)]),
    /// `z.string()`, with `.trim()` (applied before the bounds), `.min()`, `.max()`.
    Str {
        trim: bool,
        min: Option<usize>,
        max: Option<usize>,
    },
    /// `z.number().int().min(min).max(max)`.
    Int { min: i64, max: i64 },
    /// `z.enum([...])`.
    Enum(&'static [&'static str]),
    /// `.optional()`, and `.default()`, which reads the same here: only a
    /// missing key is allowed through, `null` still reaches the inner schema.
    Optional(&'static Schema),
    /// `.nullable()`.
    Nullable(&'static Schema),
}

const WORK_ID: Schema = Schema::Str {
    trim: false,
    min: Some(1),
    max: Some(64),
};
const ID: Schema = Schema::Str {
    trim: false,
    min: Some(1),
    max: None,
};
const LABEL_NAME: Schema = Schema::Str {
    trim: true,
    min: Some(1),
    max: Some(60),
};
const WORK_COLORS: Schema = Schema::Enum(&["gray", "blue", "green", "amber", "red", "purple"]);
const IMPROVEMENT_STATUSES: Schema =
    Schema::Enum(&["to_do", "in_progress", "in_review", "done", "archived"]);
const IMPROVEMENT_PRIORITIES: Schema = Schema::Enum(&["high", "medium", "low", "none"]);

/// The input schema of `operation`, where an `/api/v1` endpoint here runs it.
pub fn schema(operation: &str) -> Option<&'static Schema> {
    static EMPTY: Schema = Schema::Object(&[]);
    static RESOLVE_ALERT: Schema = Schema::Object(&[("id", ID)]);
    static CREATE_LABEL: Schema = Schema::Object(&[
        ("name", LABEL_NAME),
        ("color", Schema::Optional(&WORK_COLORS)),
    ]);
    static UPDATE_LABEL: Schema = Schema::Object(&[
        ("id", WORK_ID),
        (
            "patch",
            Schema::Partial(&[("name", LABEL_NAME), ("color", WORK_COLORS)]),
        ),
    ]);
    static DELETE_LABEL: Schema = Schema::Object(&[("id", WORK_ID)]);
    static IMPROVEMENTS_PAGE: Schema = Schema::Object(&[
        ("limit", Schema::Int { min: 1, max: 100 }),
        (
            "cursor",
            Schema::Optional(&Schema::Nullable(&Schema::Str {
                trim: false,
                min: Some(1),
                max: None,
            })),
        ),
        ("status", Schema::Optional(&IMPROVEMENT_STATUSES)),
        // `improvementQuerySchema`, spread after the three above.
        (
            "search",
            Schema::Optional(&Schema::Str {
                trim: false,
                min: None,
                max: Some(300),
            }),
        ),
        ("priority", Schema::Optional(&IMPROVEMENT_PRIORITIES)),
        ("assigneeId", Schema::Optional(&Schema::Nullable(&ID))),
        ("projectId", Schema::Optional(&ID)),
        ("assistantId", Schema::Optional(&ID)),
    ]);
    match operation {
        "alerts.list" | "taskLabels.list" => Some(&EMPTY),
        "alerts.resolve" => Some(&RESOLVE_ALERT),
        "taskLabels.create" => Some(&CREATE_LABEL),
        "taskLabels.update" => Some(&UPDATE_LABEL),
        "taskLabels.delete" => Some(&DELETE_LABEL),
        "improvements.listPage" => Some(&IMPROVEMENTS_PAGE),
        _ => None,
    }
}

/// `schema.safeParse(value).error?.issues[0]?.message`.
pub fn first_issue(schema: &Schema, value: &Value) -> Option<String> {
    check(schema, Some(value))
}

/// zod's name for what it received.
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

fn expected(what: &str, value: Option<&Value>) -> Option<String> {
    Some(format!(
        "Invalid input: expected {what}, received {}",
        received(value)
    ))
}

fn check(schema: &Schema, value: Option<&Value>) -> Option<String> {
    match schema {
        Schema::Optional(inner) => value.and_then(|value| check(inner, Some(value))),
        Schema::Nullable(inner) => match value {
            Some(Value::Null) => None,
            _ => check(inner, value),
        },
        Schema::Object(shape) | Schema::Partial(shape) => {
            let Some(Value::Object(fields)) = value else {
                return expected("object", value);
            };
            let partial = matches!(schema, Schema::Partial(_));
            shape
                .iter()
                .find_map(|(key, field)| match fields.get(*key) {
                    None if partial => None,
                    found => check(field, found),
                })
        }
        Schema::Str { trim, min, max } => {
            let Some(Value::String(text)) = value else {
                return expected("string", value);
            };
            let text = if *trim {
                crate::js::js_trim(text)
            } else {
                text
            };
            let length = js_length(text);
            if let Some(min) = min
                && length < *min
            {
                return Some(format!(
                    "Too small: expected string to have >={min} characters"
                ));
            }
            if let Some(max) = max
                && length > *max
            {
                return Some(format!(
                    "Too big: expected string to have <={max} characters"
                ));
            }
            None
        }
        Schema::Int { min, max } => {
            let Some(Value::Number(number)) = value else {
                return expected("number", value);
            };
            let Some(number) = number.as_f64() else {
                return expected("number", value);
            };
            if number.fract() != 0.0 {
                return expected("int", value);
            }
            if number < *min as f64 {
                return Some(format!("Too small: expected number to be >={min}"));
            }
            if number > *max as f64 {
                return Some(format!("Too big: expected number to be <={max}"));
            }
            None
        }
        Schema::Enum(options) => match value {
            Some(Value::String(text)) if options.contains(&text.as_str()) => None,
            _ => Some(format!(
                "Invalid option: expected one of {}",
                options
                    .iter()
                    .map(|option| format!("\"{option}\""))
                    .collect::<Vec<_>>()
                    .join("|")
            )),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn issue(operation: &str, value: Value) -> Option<String> {
        first_issue(schema(operation).unwrap(), &value)
    }

    /// Each expectation is what zod 4 answered for the same input.
    #[test]
    fn words_its_first_issue_as_zod_does() {
        let create = |value| issue("taskLabels.create", value);
        assert_eq!(
            create(json!([])).as_deref(),
            Some("Invalid input: expected object, received array")
        );
        assert_eq!(
            create(json!({})).as_deref(),
            Some("Invalid input: expected string, received undefined")
        );
        assert_eq!(
            create(json!({ "name": "  " })).as_deref(),
            Some("Too small: expected string to have >=1 characters")
        );
        assert_eq!(
            create(json!({ "name": "x".repeat(61) })).as_deref(),
            Some("Too big: expected string to have <=60 characters")
        );
        assert_eq!(
            create(json!({ "name": "ok", "color": null })).as_deref(),
            Some(
                "Invalid option: expected one of \"gray\"|\"blue\"|\"green\"|\"amber\"|\"red\"|\"purple\""
            )
        );
        // The first key in the shape wins, not the first in the body.
        assert_eq!(
            create(json!({ "color": "teal", "name": 1 })).as_deref(),
            Some("Invalid input: expected string, received number")
        );
        assert_eq!(create(json!({ "name": " ok ", "extra": 1 })), None);

        let update = |patch| issue("taskLabels.update", json!({ "id": "a", "patch": patch }));
        assert_eq!(update(json!({})), None);
        assert_eq!(
            update(json!(5)).as_deref(),
            Some("Invalid input: expected object, received number")
        );
        assert_eq!(
            issue(
                "taskLabels.update",
                json!({ "id": "x".repeat(65), "patch": {} })
            )
            .as_deref(),
            Some("Too big: expected string to have <=64 characters")
        );

        let page = |value| issue("improvements.listPage", value);
        assert_eq!(page(json!({ "limit": 5, "cursor": null })), None);
        assert_eq!(
            page(json!({ "limit": 5, "cursor": "" })).as_deref(),
            Some("Too small: expected string to have >=1 characters")
        );
        assert_eq!(
            page(json!({ "limit": 1.5 })).as_deref(),
            Some("Invalid input: expected int, received number")
        );
        assert_eq!(
            page(json!({ "limit": 101 })).as_deref(),
            Some("Too big: expected number to be <=100")
        );
        assert_eq!(
            page(json!({ "limit": 5, "priority": "urgent" })).as_deref(),
            Some("Invalid option: expected one of \"high\"|\"medium\"|\"low\"|\"none\"")
        );
        assert_eq!(page(json!({ "limit": 5, "assigneeId": null })), None);
        assert_eq!(
            page(json!({ "limit": 5, "projectId": "" })).as_deref(),
            Some("Too small: expected string to have >=1 characters")
        );
        assert_eq!(
            page(json!({ "limit": 5, "search": "x".repeat(301) })).as_deref(),
            Some("Too big: expected string to have <=300 characters")
        );
        assert_eq!(
            page(json!({ "limit": 5, "status": null })).as_deref(),
            Some(
                "Invalid option: expected one of \"to_do\"|\"in_progress\"|\"in_review\"|\"done\"|\"archived\""
            )
        );
    }
}
