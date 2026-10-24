//! Shaping a row the way the TypeScript `Db` hands it back.

use serde_json::{Map, Value};

/// PostgREST's `max_rows` in `supabase/config.toml`. PostgREST truncates every
/// read without its own range to this many rows, so a TypeScript list operation
/// answers at most this many, and its port caps the same read at the same
/// number. A test below fails when the two drift apart.
pub const POSTGREST_MAX_ROWS: i64 = 1000;

/// `rowToDomain`: snake_case keys to camelCase, top level only.
pub fn camelize(row: Value) -> Value {
    let Value::Object(fields) = row else {
        return row;
    };
    let renamed: Map<String, Value> = fields
        .into_iter()
        .map(|(key, value)| {
            let mut out = String::with_capacity(key.len());
            let mut upper = false;
            for c in key.chars() {
                if c == '_' {
                    upper = true;
                } else if upper {
                    out.extend(c.to_uppercase());
                    upper = false;
                } else {
                    out.push(c);
                }
            }
            (out, value)
        })
        .collect();
    Value::Object(renamed)
}

/// [`camelize`] over each row of a `jsonb_agg`.
pub fn camelize_all(rows: Value) -> Value {
    match rows {
        Value::Array(items) => Value::Array(items.into_iter().map(camelize).collect()),
        other => other,
    }
}

const ALPHABET: &[u8; 62] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

/// `shortId()` from `@agent-hub/core`: 12 characters, a dash at index 8,
/// in the style of "hAOzUt5m-cHI".
pub fn short_id() -> String {
    let mut bytes = [0u8; 12];
    getrandom::fill(&mut bytes).expect("the OS random source is available");
    bytes
        .iter()
        .enumerate()
        .map(|(i, byte)| {
            if i == 8 {
                '-'
            } else {
                ALPHABET[usize::from(*byte) % ALPHABET.len()] as char
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn camelizes_top_level_keys_only() {
        let row =
            json!({ "organization_id": "o", "resolved_by": null, "nested": { "keep_me": 1 } });
        assert_eq!(
            camelize(row),
            json!({ "organizationId": "o", "resolvedBy": null, "nested": { "keep_me": 1 } })
        );
    }

    #[test]
    fn short_ids_match_the_core_constants() {
        let source = include_str!("../../../packages/core/src/id.ts");
        assert!(source.contains(std::str::from_utf8(ALPHABET).unwrap()));
        assert!(source.contains("shortId(length = 12)"));
        assert!(source.contains("i === 8"));
        let id = short_id();
        assert_eq!(id.len(), 12);
        assert_eq!(&id[8..9], "-");
    }

    #[test]
    fn caps_reads_where_postgrest_does() {
        let config = include_str!("../../../supabase/config.toml");
        let max_rows = config
            .lines()
            .find_map(|line| line.trim().strip_prefix("max_rows"))
            .and_then(|rest| rest.trim().strip_prefix('='))
            .map(|value| value.trim().parse::<i64>().unwrap());
        assert_eq!(max_rows, Some(POSTGREST_MAX_ROWS));
    }
}
