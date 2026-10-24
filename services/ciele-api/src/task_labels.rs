//! `taskLabels.list|create|update|delete`, the ports of
//! `packages/ops/src/task-labels.ts` (#1122).
//!
//! A Label belongs to the Organization, so one "Bug" filters every Project.
//! Two Labels may not share a name ignoring case: the TypeScript operation
//! checks that before writing and answers `conflict`, and so does this one.
//! The unique index on `lower(name)` is the backstop for a race between two
//! creates, which surfaces as a server fault on both sides.

use serde::Deserialize;
use serde_json::{Map, Value};
use sqlx::PgConnection;

use crate::assertion::Claims;
use crate::error::ApiError;
use crate::input::{parse, parse_object, present};
use crate::js::{js_length, js_trim};
use crate::rows::{camelize, camelize_all, short_id};

const COLORS: [&str; 6] = ["gray", "blue", "green", "amber", "red", "purple"];

pub async fn list(conn: &mut PgConnection, claims: &Claims) -> Result<Value, ApiError> {
    // `id` breaks ties the way the paging accessor's second `order` does.
    let rows: Value = sqlx::query_scalar(
        "select coalesce(jsonb_agg(to_jsonb(l) order by l.name, l.id), '[]'::jsonb) \
         from public.task_labels l where l.organization_id = $1::uuid",
    )
    .bind(&claims.org)
    .fetch_one(&mut *conn)
    .await?;
    Ok(camelize_all(rows))
}

#[derive(Deserialize)]
struct CreateInput {
    name: String,
    #[serde(default, deserialize_with = "present")]
    color: Option<String>,
}

pub async fn create(
    conn: &mut PgConnection,
    claims: &Claims,
    input: Value,
) -> Result<Value, ApiError> {
    let CreateInput { name, color } = parse(input)?;
    let name = valid_name(&name)?;
    let color = valid_color(color)?.unwrap_or_else(|| "gray".into());
    assert_name_free(conn, claims, &name, None).await?;
    let row: Value = sqlx::query_scalar(
        "insert into public.task_labels as l (id, organization_id, name, color) \
         values ($1, $2::uuid, $3, $4) returning to_jsonb(l)",
    )
    .bind(short_id())
    .bind(&claims.org)
    .bind(name)
    .bind(color)
    .fetch_one(&mut *conn)
    .await?;
    Ok(camelize(row))
}

#[derive(Deserialize)]
struct UpdateInput {
    id: String,
    patch: Map<String, Value>,
}

#[derive(Deserialize)]
struct Patch {
    #[serde(default, deserialize_with = "present")]
    name: Option<String>,
    #[serde(default, deserialize_with = "present")]
    color: Option<String>,
}

pub async fn update(
    conn: &mut PgConnection,
    claims: &Claims,
    input: Value,
) -> Result<Value, ApiError> {
    let UpdateInput { id, patch } = parse(input)?;
    valid_id(&id)?;
    let patch: Patch = parse_object(patch)?;
    let name = patch.name.as_deref().map(valid_name).transpose()?;
    let color = valid_color(patch.color)?;
    require_label(conn, claims, &id).await?;
    if let Some(name) = &name {
        assert_name_free(conn, claims, name, Some(&id)).await?;
    }
    let row: Value = sqlx::query_scalar(
        "update public.task_labels l \
         set name = coalesce($3, l.name), color = coalesce($4, l.color), updated_at = now() \
         where l.id = $1 and l.organization_id = $2::uuid \
         returning to_jsonb(l)",
    )
    .bind(&id)
    .bind(&claims.org)
    .bind(name)
    .bind(color)
    .fetch_one(&mut *conn)
    .await?;
    Ok(camelize(row))
}

#[derive(Deserialize)]
struct DeleteInput {
    id: String,
}

/// Every Task loses the Label (the links cascade); the Tasks themselves stay.
pub async fn delete(
    conn: &mut PgConnection,
    claims: &Claims,
    input: Value,
) -> Result<Value, ApiError> {
    let DeleteInput { id } = parse(input)?;
    valid_id(&id)?;
    require_label(conn, claims, &id).await?;
    sqlx::query("delete from public.task_labels where id = $1 and organization_id = $2::uuid")
        .bind(&id)
        .bind(&claims.org)
        .execute(&mut *conn)
        .await?;
    Ok(Value::Null)
}

async fn require_label(conn: &mut PgConnection, claims: &Claims, id: &str) -> Result<(), ApiError> {
    let found: bool = sqlx::query_scalar(
        "select exists (select 1 from public.task_labels where id = $1 and organization_id = $2::uuid)",
    )
    .bind(id)
    .bind(&claims.org)
    .fetch_one(&mut *conn)
    .await?;
    if found {
        Ok(())
    } else {
        Err(ApiError::not_found("Label not found"))
    }
}

/// Compared in Rust rather than with SQL `lower()`, because the TypeScript
/// check is `toLowerCase`, and the two disagree outside ASCII.
async fn assert_name_free(
    conn: &mut PgConnection,
    claims: &Claims,
    name: &str,
    except_id: Option<&str>,
) -> Result<(), ApiError> {
    let taken: Vec<(String, String)> =
        sqlx::query_as("select id, name from public.task_labels where organization_id = $1::uuid")
            .bind(&claims.org)
            .fetch_all(&mut *conn)
            .await?;
    let wanted = name.to_lowercase();
    if taken
        .iter()
        .any(|(id, taken)| Some(id.as_str()) != except_id && taken.to_lowercase() == wanted)
    {
        return Err(ApiError::conflict(format!(
            "A label called {name} already exists."
        )));
    }
    Ok(())
}

/// `workId`: 1 to 64.
fn valid_id(id: &str) -> Result<(), ApiError> {
    match js_length(id) {
        1..=64 => Ok(()),
        _ => Err(ApiError::invalid_input("id must be 1 to 64 characters")),
    }
}

/// `z.string().trim().min(1).max(60)`.
fn valid_name(name: &str) -> Result<String, ApiError> {
    let name = js_trim(name);
    match js_length(name) {
        1..=60 => Ok(name.to_owned()),
        _ => Err(ApiError::invalid_input("Name must be 1 to 60 characters")),
    }
}

fn valid_color(color: Option<String>) -> Result<Option<String>, ApiError> {
    match color {
        Some(color) if !COLORS.contains(&color.as_str()) => {
            Err(ApiError::invalid_input("Invalid label color"))
        }
        color => Ok(color),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_like_the_zod_schema() {
        assert_eq!(valid_name("  Bug \u{feff}").unwrap(), "Bug");
        assert!(valid_name("   ").is_err());
        assert!(valid_name(&"x".repeat(61)).is_err());
        assert!(valid_name(&"x".repeat(60)).is_ok());
        assert!(valid_color(Some("teal".into())).is_err());
        assert_eq!(valid_color(None).unwrap(), None);
        assert!(valid_id("").is_err());
        assert!(valid_id(&"a".repeat(65)).is_err());
    }
}
