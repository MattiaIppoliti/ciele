//! Reading an operation's input the way its zod schema did.
//!
//! The web app parses before it forwards, so a well-behaved caller never
//! sends anything zod refused. The service checks again anyway, and the parity
//! test sends it malformed inputs to hold the two to the same answers.

use serde::{Deserialize, Deserializer};
use serde_json::{Map, Value};

use crate::error::ApiError;

pub fn parse<T: for<'de> Deserialize<'de>>(input: Value) -> Result<T, ApiError> {
    serde_json::from_value(input).map_err(|error| ApiError::invalid_input(error.to_string()))
}

/// A nested `z.object`, parsed as one. serde would also build a struct from a
/// JSON array, which zod refuses, so the object is required first.
pub fn parse_object<T: for<'de> Deserialize<'de>>(
    input: Map<String, Value>,
) -> Result<T, ApiError> {
    parse(Value::Object(input))
}

/// zod's `.optional()`: the key may be missing, but `null` is not a value.
/// Use with `#[serde(default, deserialize_with = "input::present")]`; serde's
/// own `Option` would read `null` as absent.
pub fn present<'de, D, T>(deserializer: D) -> Result<Option<T>, D::Error>
where
    D: Deserializer<'de>,
    T: Deserialize<'de>,
{
    T::deserialize(deserializer).map(Some)
}

pub fn require_id(id: &str) -> Result<(), ApiError> {
    if id.is_empty() {
        Err(ApiError::invalid_input("id is required"))
    } else {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[derive(Deserialize)]
    struct Patch {
        #[serde(default, deserialize_with = "present")]
        title: Option<String>,
    }

    #[test]
    fn refuses_null_where_zod_says_optional() {
        assert_eq!(parse::<Patch>(json!({})).unwrap().title, None);
        assert_eq!(
            parse::<Patch>(json!({ "title": "x" }))
                .unwrap()
                .title
                .as_deref(),
            Some("x")
        );
        assert!(parse::<Patch>(json!({ "title": null })).is_err());
    }
}
