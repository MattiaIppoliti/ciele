//! `improvements.list` and `improvements.listPage`, the ports of the board
//! reads in `packages/ops/src/improvements.ts` (#1122). `listPage` carries the
//! board's storage filters and per-stage counts
//! (docs/design/answer-improvement-workflow.md).
//!
//! The row is built field by field rather than through `to_jsonb`, because
//! `toImprovement` picks its fields too: a column added later must not start
//! leaking into the answer from one side only.
//!
//! Not here yet: `improvements.get`, whose associations carry whole
//! Conversations and transcripts and so move with the Inbox domain, and
//! `improvements.update`, which calls `ctx.ports.notifyImprovementUpdate`.

use serde::Deserialize;
use serde_json::{Value, json};
use sqlx::PgConnection;

use crate::assertion::{Claims, DbScope};
use crate::error::ApiError;
use crate::input::{parse, present};
use crate::js::{js_length, js_number_to_safe_integer, js_trim};
use crate::rows::{POSTGREST_MAX_ROWS, camelize, short_id};

const STATUSES: [&str; 5] = ["to_do", "in_progress", "in_review", "done", "archived"];

/// One `ImprovementListItem`: `toImprovement` plus the linked message count.
/// The count subquery runs under the caller's RLS, as PostgREST's embedded
/// `improvement_messages(id.count())` does.
pub(crate) const LIST_ITEM_JSON: &str = "jsonb_build_object( \
       'id', i.id, 'organizationId', i.organization_id, 'seq', i.seq, \
       'title', i.title, 'description', i.description, 'status', i.status, \
       'priority', i.priority, 'tags', coalesce(i.tags, '[]'::jsonb), \
       'assigneeId', i.assignee_id, 'dueDate', i.due_date, 'projectId', i.project_id, \
       'createdBy', i.created_by, 'createdAt', i.created_at, 'updatedAt', i.updated_at, \
       'messageCount', (select count(*) from public.improvement_messages m where m.improvement_id = i.id))";

pub async fn list(conn: &mut PgConnection, claims: &Claims) -> Result<Value, ApiError> {
    let sql = format!(
        "select coalesce(jsonb_agg({LIST_ITEM_JSON} order by i.seq desc), '[]'::jsonb) \
         from (select * from public.improvements where organization_id = $1::uuid order by seq desc limit $2) i"
    );
    let rows: Value = sqlx::query_scalar(&sql)
        .bind(&claims.org)
        .bind(POSTGREST_MAX_ROWS)
        .fetch_one(&mut *conn)
        .await?;
    Ok(rows)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PageInput {
    limit: i64,
    cursor: Option<String>,
    #[serde(default, deserialize_with = "present")]
    status: Option<String>,
    #[serde(default, deserialize_with = "present")]
    search: Option<String>,
    #[serde(default, deserialize_with = "present")]
    priority: Option<String>,
    /// `Some(None)` is an explicit `null`: unassigned work.
    #[serde(default, deserialize_with = "present")]
    assignee_id: Option<Option<String>>,
    #[serde(default, deserialize_with = "present")]
    project_id: Option<String>,
    #[serde(default, deserialize_with = "present")]
    assistant_id: Option<String>,
}

const PRIORITIES: [&str; 4] = ["high", "medium", "low", "none"];

/// `improvementFilters` in `packages/db/src/improvement-pagination.ts`: the
/// keys that narrow the read, absent and blank ones dropped, or `None` when
/// nothing does. The keys are the ones `public.matching_improvements` reads.
fn filters(input: &PageInput) -> Option<Value> {
    let mut filters = serde_json::Map::new();
    if let Some(search) = input.search.as_deref().map(js_trim)
        && !search.is_empty()
    {
        filters.insert("search".into(), json!(search));
    }
    if let Some(priority) = &input.priority {
        filters.insert("priority".into(), json!(priority));
    }
    if let Some(assignee) = &input.assignee_id {
        filters.insert("assigneeId".into(), json!(assignee));
    }
    if let Some(project) = &input.project_id {
        filters.insert("projectId".into(), json!(project));
    }
    if let Some(assistant) = &input.assistant_id {
        filters.insert("assistantId".into(), json!(assistant));
    }
    (!filters.is_empty()).then_some(Value::Object(filters))
}

/// zod's refusals for the filter keys of `listImprovementsPageOp`.
fn check_filters(input: &PageInput) -> Result<(), ApiError> {
    if let Some(search) = &input.search {
        bounded(search, 0, 300)?;
    }
    if let Some(priority) = &input.priority
        && !PRIORITIES.contains(&priority.as_str())
    {
        return Err(ApiError::invalid_input("Invalid improvement priority"));
    }
    for id in [
        input.assignee_id.as_ref().and_then(Option::as_ref),
        input.project_id.as_ref(),
        input.assistant_id.as_ref(),
    ]
    .into_iter()
    .flatten()
    {
        bounded(id, 1, usize::MAX)?;
    }
    Ok(())
}

/// One board lane, or every lane, `limit` at a time, newest key first, and
/// every lane's size under the same filters. The cursor is the last item's
/// `seq` as a string. A filtered read goes through `public.matching_improvements`,
/// the predicate both TypeScript adapters use; an unfiltered one keeps the
/// plain table read.
pub async fn list_page(
    conn: &mut PgConnection,
    claims: &Claims,
    input: Value,
) -> Result<Value, ApiError> {
    let input: PageInput = parse(input)?;
    if let Some(status) = &input.status
        && !STATUSES.contains(&status.as_str())
    {
        return Err(ApiError::invalid_input("Invalid improvement status"));
    }
    // zod: `limit` an integer from 1 to 100, `cursor` non-empty when present.
    if !(1..=100).contains(&input.limit) {
        return Err(ApiError::invalid_input("limit must be 1 to 100"));
    }
    if input.cursor.as_deref() == Some("") {
        return Err(ApiError::invalid_input("cursor must not be empty"));
    }
    check_filters(&input)?;
    let before_seq = input.cursor.as_deref().and_then(js_number_to_safe_integer);
    let filters = filters(&input);
    let source = if filters.is_some() {
        "public.matching_improvements($1::uuid, $5::jsonb)"
    } else {
        "(select * from public.improvements where organization_id = $1::uuid)"
    };
    let sql = format!(
        "select jsonb_build_object( \
           'items', (select coalesce(jsonb_agg(item order by seq desc), '[]'::jsonb) from ( \
              select {LIST_ITEM_JSON} as item, i.seq from {source} i \
              where ($2::bigint is null or i.seq < $2) \
                and ($3::text is null or i.status = $3) \
              order by i.seq desc limit $4) page), \
           'counts', (select {COUNTS_JSON} from {source} i))"
    );
    let answer: Value = sqlx::query_scalar(&sql)
        .bind(&claims.org)
        .bind(before_seq)
        .bind(&input.status)
        .bind(input.limit + 1)
        .bind(filters)
        .fetch_one(&mut *conn)
        .await?;
    let mut page = finalize_page(answer["items"].clone(), input.limit as usize);
    page["counts"] = answer["counts"].clone();
    Ok(page)
}

/// `countImprovementsByStatus`: every status present, zero included.
pub(crate) const COUNTS_JSON: &str = "jsonb_build_object( \
       'to_do', count(*) filter (where i.status = 'to_do'), \
       'in_progress', count(*) filter (where i.status = 'in_progress'), \
       'in_review', count(*) filter (where i.status = 'in_review'), \
       'done', count(*) filter (where i.status = 'done'), \
       'archived', count(*) filter (where i.status = 'archived'))";

/// `finalizeImprovementPage`: rows were fetched with `limit + 1`, so a cursor
/// exists only when the extra row came back.
pub(crate) fn finalize_page(rows: Value, limit: usize) -> Value {
    let mut items = match rows {
        Value::Array(items) => items,
        _ => Vec::new(),
    };
    let more = items.len() > limit;
    items.truncate(limit);
    let next_cursor = if more {
        items
            .last()
            .and_then(|item| item["seq"].as_i64())
            .map(|seq| seq.to_string())
    } else {
        None
    };
    json!({ "items": items, "nextCursor": next_cursor })
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProposeInput {
    improvement_id: String,
    question: String,
    answer: String,
    #[serde(default)]
    rationale: String,
}

pub async fn propose(
    conn: &mut PgConnection,
    claims: &Claims,
    input: Value,
) -> Result<Value, ApiError> {
    let input: ProposeInput = parse(input)?;
    bounded(&input.improvement_id, 1, usize::MAX)?;
    bounded(&input.question, 1, 500)?;
    bounded(&input.answer, 1, 4000)?;
    bounded(&input.rationale, 0, 600)?;
    require_improvement(conn, claims, &input.improvement_id).await?;
    if let Some(existing) = proposal(conn, claims, &input.improvement_id).await?
        && existing["status"] == "draft"
    {
        return Err(ApiError::conflict(
            "This improvement already has a Suggested Fix awaiting review",
        ));
    }
    // PostgREST first caps the ordered associations, then TypeScript finds
    // the first one whose conversation names an Assistant.
    let target: Option<(String, Option<String>)> = sqlx::query_as(
        "select c.assistant_id, c.collection_id from (select message_id, created_at from public.improvement_messages \
         where improvement_id = $1 order by created_at limit $2) links \
         join public.messages m on m.id = links.message_id \
         join public.conversations c on c.id = m.conversation_id \
         where c.assistant_id is not null order by links.created_at limit 1"
    ).bind(&input.improvement_id).bind(POSTGREST_MAX_ROWS).fetch_optional(&mut *conn).await?;
    let Some((assistant, collection)) = target else {
        return Err(ApiError::invalid_input(
            "This improvement has no flagged assistant answer, so there is no knowledge to fix",
        ));
    };
    let payload = json!({"draftQuestion": input.question, "draftAnswer": input.answer,
        "rationale": input.rationale, "sources": [], "model": "member",
        "targetAssistantId": assistant, "targetCollectionId": collection});
    sqlx::query("delete from public.improvement_proposals where improvement_id = $1 and organization_id = $2::uuid")
        .bind(&input.improvement_id).bind(&claims.org).execute(&mut *conn).await?;
    let row: Value = sqlx::query_scalar("insert into public.improvement_proposals as p \
        (id, organization_id, improvement_id, status, payload) values ($1, $2::uuid, $3, 'draft', $4) returning to_jsonb(p)")
        .bind(short_id()).bind(&claims.org).bind(&input.improvement_id).bind(payload).fetch_one(&mut *conn).await?;
    Ok(camelize(row))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DismissInput {
    improvement_id: String,
    #[serde(default)]
    reason: String,
}

pub async fn dismiss(
    conn: &mut PgConnection,
    claims: &Claims,
    input: Value,
) -> Result<Value, ApiError> {
    let input: DismissInput = parse(input)?;
    bounded(&input.improvement_id, 1, usize::MAX)?;
    bounded(&input.reason, 0, 1000)?;
    if claims.scope == DbScope::Pinned {
        match require_improvement(conn, claims, &input.improvement_id).await {
            Err(error) if error.code == "not_found" => return Err(ApiError::cross_org()),
            Err(error) => return Err(error),
            Ok(()) => {}
        }
    }
    let existing = proposal(conn, claims, &input.improvement_id)
        .await?
        .ok_or_else(|| ApiError::not_found("No Suggested Fix on this improvement"))?;
    if existing["status"] == "dismissed" {
        return Ok(existing);
    }
    if existing["status"] != "draft" {
        return Err(ApiError::conflict(format!(
            "This Suggested Fix was already {}",
            existing["status"].as_str().unwrap_or("")
        )));
    }
    let row: Value = sqlx::query_scalar("update public.improvement_proposals p set status = 'dismissed', \
        dismiss_reason = $3, updated_at = now() where improvement_id = $1 and organization_id = $2::uuid returning to_jsonb(p)")
        .bind(&input.improvement_id).bind(&claims.org).bind(js_trim(&input.reason)).fetch_one(&mut *conn).await?;
    Ok(camelize(row))
}

fn bounded(value: &str, min: usize, max: usize) -> Result<(), ApiError> {
    if (min..=max).contains(&js_length(value)) {
        Ok(())
    } else {
        Err(ApiError::invalid_input("Invalid string length"))
    }
}

async fn require_improvement(
    conn: &mut PgConnection,
    claims: &Claims,
    id: &str,
) -> Result<(), ApiError> {
    let visible: bool = sqlx::query_scalar("select exists(select 1 from public.improvements where id = $1 and organization_id = $2::uuid)")
        .bind(id).bind(&claims.org).fetch_one(&mut *conn).await?;
    if visible {
        Ok(())
    } else {
        Err(ApiError::not_found("Improvement not found"))
    }
}

async fn proposal(
    conn: &mut PgConnection,
    claims: &Claims,
    id: &str,
) -> Result<Option<Value>, ApiError> {
    let row: Option<Value> = sqlx::query_scalar("select to_jsonb(p) from public.improvement_proposals p where improvement_id = $1 and organization_id = $2::uuid")
        .bind(id).bind(&claims.org).fetch_optional(&mut *conn).await?;
    Ok(row.map(camelize))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_a_next_cursor_only_when_the_extra_row_came_back() {
        let rows = json!([{ "seq": 5 }, { "seq": 4 }, { "seq": 3 }]);
        assert_eq!(
            finalize_page(rows.clone(), 2),
            json!({ "items": [{ "seq": 5 }, { "seq": 4 }], "nextCursor": "4" })
        );
        assert_eq!(finalize_page(rows, 3)["nextCursor"], Value::Null);
    }
}
