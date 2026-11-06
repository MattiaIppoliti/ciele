//! `/api/v1` answered here, with no Next.js function in the path (#1134).
//!
//! An endpoint is in [`ENDPOINTS`] when the operation its TypeScript route runs
//! is a row of [`crate::OPERATIONS`]. The caller sends its Organization API key
//! here exactly as it would to the web app ([`crate::api_key`] verifies it), and
//! the answer is the one the TypeScript route gives: the same status codes, the
//! same `{"error": {"code", "message"}}` bodies byte for byte, the same success
//! shapes. The steps run in the route's order:
//!
//! 1. the route's own reading of the request: a JSON body (`400`) or the list
//!    parameters, before anything else;
//! 2. the key (`401`);
//! 3. the key's Role against the operation's (`403`);
//! 4. zod's first issue (`422`), worded as zod words it ([`crate::zod`]);
//! 5. the operation, as `service_role` pinned to the key's Organization, the
//!    scope the forwarding seam's `pinned` assertion names.
//!
//! The web app decides what reaches here: `RUST_DIRECT_ENDPOINTS` in
//! `apps/web/src/lib/rust-routing.ts` holds the same list, and a test
//! there derives it again from the route files and holds both to it.
//!
//! What the TypeScript route does and this one does not: after a write it runs
//! `revalidateEntities`, which expires the console's in-memory Find caches (15
//! to 30 seconds) and calls `revalidatePath` for every page that renders what
//! changed: `/alerts` for a resolved Alert, `/projects`, `/my-tasks` and
//! `/tasks` for a Label. None of it runs here. An API caller sees no
//! difference; a Member with one of those pages open keeps the old rows in the
//! client router cache until a reload, and the Find palette may show a renamed
//! Label's old name for up to 30 seconds.

use std::collections::HashMap;

use axum::Json;
use axum::Router;
use axum::body::Bytes;
use axum::extract::{RawPathParams, RawQuery, State};
use axum::http::{HeaderMap, Method, StatusCode, header};
use axum::response::{IntoResponse, Response};
use axum::routing::{MethodFilter, on};
use serde_json::{Value, json};

use crate::assertion::{Claims, DbScope};
use crate::error::ApiError;
use crate::{AppState, OPERATIONS, Operation, api_key, js, scope, zod};

/// What a route reads from the request before it authenticates.
pub struct Request<'a> {
    params: &'a HashMap<String, String>,
    query: Option<&'a str>,
    body: &'a [u8],
}

/// `None` is the route's `400 Body must be JSON`, its one refusal before auth.
type Input = fn(&Request<'_>) -> Option<Value>;
type Respond = fn(&Value, Value) -> (StatusCode, Value);

/// One `/api/v1` endpoint this service answers.
pub struct Endpoint {
    pub method: Method,
    /// Relative to `/api/v1`, written as the OpenAPI registry writes it.
    pub path: &'static str,
    /// A row of [`crate::OPERATIONS`].
    pub operation: &'static str,
    input: Input,
    respond: Respond,
}

/// Every `/api/v1` endpoint answered here. Each one is the twin of a route
/// file under `apps/web/src/app/api/v1`; `input` and `respond` are that
/// file's handler around its `runApiOperation` call.
pub static ENDPOINTS: &[Endpoint] = &[
    Endpoint {
        method: Method::GET,
        path: "/alerts",
        operation: "alerts.list",
        input: |_| Some(json!({})),
        respond: data,
    },
    Endpoint {
        method: Method::POST,
        path: "/alerts/{id}/resolve",
        operation: "alerts.resolve",
        input: id_only,
        respond: result,
    },
    Endpoint {
        method: Method::GET,
        path: "/improvements",
        operation: "improvements.listPage",
        input: improvement_params,
        respond: |_, page| {
            let (items, cursor, counts) = match page {
                Value::Object(mut page) => (
                    page.remove("items").unwrap_or(Value::Null),
                    page.remove("nextCursor").unwrap_or(Value::Null),
                    page.remove("counts").unwrap_or(Value::Null),
                ),
                _ => (Value::Null, Value::Null, Value::Null),
            };
            (
                StatusCode::OK,
                json!({ "data": items, "nextCursor": cursor, "counts": counts }),
            )
        },
    },
    Endpoint {
        method: Method::GET,
        path: "/task-labels",
        operation: "taskLabels.list",
        input: |_| Some(json!({})),
        respond: data,
    },
    Endpoint {
        method: Method::POST,
        path: "/task-labels",
        operation: "taskLabels.create",
        input: |request| json_body(request.body),
        respond: |_, label| (StatusCode::CREATED, label),
    },
    Endpoint {
        method: Method::PATCH,
        path: "/task-labels/{id}",
        operation: "taskLabels.update",
        input: |request| {
            // `body === null || typeof body !== "object"`: an array passes, and
            // zod refuses it as the patch.
            let patch =
                json_body(request.body).filter(|body| body.is_object() || body.is_array())?;
            Some(json!({ "id": param(request, "id"), "patch": patch }))
        },
        respond: result,
    },
    Endpoint {
        method: Method::DELETE,
        path: "/task-labels/{id}",
        operation: "taskLabels.delete",
        input: id_only,
        respond: |input, _| (StatusCode::OK, json!({ "deleted": input["id"] })),
    },
];

fn data(_: &Value, result: Value) -> (StatusCode, Value) {
    (StatusCode::OK, json!({ "data": result }))
}

fn result(_: &Value, result: Value) -> (StatusCode, Value) {
    (StatusCode::OK, result)
}

fn param(request: &Request<'_>, name: &str) -> String {
    request.params.get(name).cloned().unwrap_or_default()
}

fn id_only(request: &Request<'_>) -> Option<Value> {
    Some(json!({ "id": param(request, "id") }))
}

/// `await request.json().catch(() => null)`, where `None` is that `null`.
/// The body is decoded as UTF-8 with replacement and a leading BOM dropped,
/// as `Request.json()` decodes it, and a literal `null` reads the same as no
/// JSON at all.
fn json_body(body: &[u8]) -> Option<Value> {
    let text = String::from_utf8_lossy(body);
    let text = text.strip_prefix('\u{feff}').unwrap_or(&text);
    serde_json::from_str::<Value>(text)
        .ok()
        .filter(|value| !value.is_null())
}

fn body_must_be_json() -> Response {
    api_error(
        StatusCode::BAD_REQUEST,
        "invalid_input",
        "Body must be JSON",
    )
}

const DEFAULT_PAGE_LIMIT: f64 = 50.0;
const MAX_PAGE_LIMIT: f64 = 100.0;

/// `parseListParams`: `?limit=` through `Number`, truncated and clamped to
/// 1..=100, 50 when it is not finite; `?cursor=` as given, or `null`. The
/// first of a repeated parameter wins, as `URLSearchParams.get` has it.
fn list_params(request: &Request<'_>) -> Option<Value> {
    let first = |name: &str| {
        form_urlencoded::parse(request.query.unwrap_or("").as_bytes())
            .find(|(key, _)| key == name)
            .map(|(_, value)| value.into_owned())
    };
    let raw = first("limit").map_or(DEFAULT_PAGE_LIMIT, |limit| js::js_number(&limit));
    let limit = if raw.is_finite() {
        raw.trunc().clamp(1.0, MAX_PAGE_LIMIT)
    } else {
        DEFAULT_PAGE_LIMIT
    };
    Some(json!({ "limit": limit as i64, "cursor": first("cursor") }))
}

/// The Improvements route's reading: `parseListParams`, then each filter
/// parameter as given (the first of a repeated one), and an empty
/// `assigneeId` as `null`, which lists unassigned work.
fn improvement_params(request: &Request<'_>) -> Option<Value> {
    let mut input = list_params(request)?;
    let first = |name: &str| {
        form_urlencoded::parse(request.query.unwrap_or("").as_bytes())
            .find(|(key, _)| key == name)
            .map(|(_, value)| value.into_owned())
    };
    for key in ["search", "status", "priority", "projectId", "assistantId"] {
        if let Some(value) = first(key) {
            input[key] = json!(value);
        }
    }
    if let Some(assignee) = first("assigneeId") {
        input["assigneeId"] = if assignee.is_empty() {
            Value::Null
        } else {
            json!(assignee)
        };
    }
    Some(input)
}

/// `apiError`: the envelope every `/api/v1` refusal uses.
fn api_error(status: StatusCode, code: &str, message: &str) -> Response {
    (
        status,
        Json(json!({ "error": { "code": code, "message": message } })),
    )
        .into_response()
}

pub(crate) fn unauthorized() -> Response {
    api_error(
        StatusCode::UNAUTHORIZED,
        "unauthorized",
        "Provide a valid API key as a Bearer token",
    )
}

/// What `runApiOperation` makes of what the operation threw.
fn refusal(error: ApiError) -> Response {
    match error.code {
        "not_found" | "invalid_input" | "conflict" => {
            api_error(error.status, error.code, &error.message)
        }
        // The org-pinned Db refusing a row of another Organization: the route
        // discloses nothing.
        "cross_org" => api_error(StatusCode::NOT_FOUND, "not_found", "Not found"),
        // The TypeScript route throws, and Next answers a bare 500.
        _ => error.into_response(),
    }
}

fn operation(name: &str) -> &'static Operation {
    OPERATIONS
        .iter()
        .find(|op| op.name == name)
        .expect("every endpoint names a row of OPERATIONS; a test holds them together")
}

/// `request.headers.get("authorization")`: repeated headers read as one,
/// joined by ", ", which no well-formed bearer value survives.
pub(crate) fn authorization(headers: &HeaderMap) -> Option<String> {
    let values: Vec<&str> = headers
        .get_all(header::AUTHORIZATION)
        .iter()
        .map(|value| value.to_str().unwrap_or(""))
        .collect();
    (!values.is_empty()).then(|| values.join(", "))
}

pub(crate) async fn handle(
    endpoint: &'static Endpoint,
    state: AppState,
    params: HashMap<String, String>,
    query: Option<String>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    let request = Request {
        params: &params,
        query: query.as_deref(),
        body: &body,
    };
    let Some(input) = (endpoint.input)(&request) else {
        return body_must_be_json();
    };

    let header = authorization(&headers);
    let Some(secret) = api_key::bearer_secret(header.as_deref()) else {
        return unauthorized();
    };
    let key = match api_key::authenticate(&state.pool, secret).await {
        Ok(Some(key)) => key,
        Ok(None) => return unauthorized(),
        Err(error) => return error.into_response(),
    };

    let op = operation(endpoint.operation);
    let allowed = match &key.caps {
        Some(caps) => caps.iter().any(|cap| cap == op.capability),
        None => key.role >= op.role,
    };
    if !allowed {
        return api_error(
            StatusCode::FORBIDDEN,
            "forbidden",
            &format!(
                "This API key's role does not allow this operation: it needs {}",
                op.capability
            ),
        );
    }
    let schema = zod::schema(op.name)
        .expect("every endpoint's operation has a schema; a test holds them together");
    if let Some(message) = zod::first_issue(schema, &input) {
        return api_error(StatusCode::UNPROCESSABLE_ENTITY, "invalid_input", &message);
    }

    let claims = Claims {
        op: op.name.to_owned(),
        org: key.organization_id,
        sub: key.actor_user_id,
        email: None,
        role: key.role,
        caps: key.caps.clone(),
        scope: DbScope::Pinned,
        body: String::new(),
        exp: 0,
    };
    let mut tx = match scope::begin(&state.pool, &claims).await {
        Ok(tx) => tx,
        Err(error) => return error.into_response(),
    };
    match (op.run)(&mut tx, &claims, input.clone()).await {
        Ok(result) => {
            if let Err(error) = tx.commit().await {
                return ApiError::from(error).into_response();
            }
            let (status, body) = (endpoint.respond)(&input, result);
            (status, Json(body)).into_response()
        }
        Err(error) => {
            let _ = tx.rollback().await;
            refusal(error)
        }
    }
}

/// The endpoint that serves `method` on `path` (relative to `/api/v1`, its
/// parameters percent-encoded as `encodeURIComponent` writes them), and the
/// parameters decoded as Next.js decodes them. `None` for a path a URL parser
/// would rewrite: a `.` or `..` segment goes over HTTP, where the same
/// normalisation applies on both sides.
pub(crate) fn route(
    method: &Method,
    path: &str,
) -> Option<(&'static Endpoint, HashMap<String, String>)> {
    let segments: Vec<&str> = path.strip_prefix('/')?.split('/').collect();
    ENDPOINTS.iter().find_map(|endpoint| {
        if endpoint.method != *method {
            return None;
        }
        let template: Vec<&str> = endpoint.path.trim_start_matches('/').split('/').collect();
        if template.len() != segments.len() {
            return None;
        }
        let mut params = HashMap::new();
        for (expected, found) in template.iter().zip(&segments) {
            match expected
                .strip_prefix('{')
                .and_then(|name| name.strip_suffix('}'))
            {
                Some(name) => {
                    let value = percent_decode(found);
                    if value.is_empty() || value == "." || value == ".." {
                        return None;
                    }
                    params.insert(name.to_owned(), value);
                }
                None if expected == found => {}
                None => return None,
            }
        }
        Some((endpoint, params))
    })
}

fn percent_decode(segment: &str) -> String {
    let bytes = segment.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut at = 0;
    while at < bytes.len() {
        let hex = |b: u8| (b as char).to_digit(16);
        if bytes[at] == b'%'
            && let (Some(Some(high)), Some(Some(low))) = (
                bytes.get(at + 1).map(|b| hex(*b)),
                bytes.get(at + 2).map(|b| hex(*b)),
            )
        {
            out.push((high * 16 + low) as u8);
            at += 3;
            continue;
        }
        out.push(bytes[at]);
        at += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// The reads `direct.rs` answers with one statement on the `service_role`
/// pool. `router` mounts those itself, so they are skipped here.
const DIRECT: &[&str] = &["/alerts", "/task-labels", "/improvements"];

/// Mounts every endpoint under `/api/v1`.
pub fn routes(mut router: Router<AppState>) -> Router<AppState> {
    for endpoint in ENDPOINTS {
        if endpoint.method == Method::GET && DIRECT.contains(&endpoint.path) {
            continue;
        }
        let filter = MethodFilter::try_from(endpoint.method.clone())
            .expect("an endpoint's method is one axum can route");
        router = router.route(
            &format!("/api/v1{}", endpoint.path),
            on(
                filter,
                move |State(state): State<AppState>,
                      params: RawPathParams,
                      RawQuery(query): RawQuery,
                      headers: HeaderMap,
                      body: Bytes| {
                    let params = params
                        .iter()
                        .map(|(key, value)| (key.to_owned(), value.to_owned()))
                        .collect();
                    handle(endpoint, state, params, query, headers, body)
                },
            ),
        );
    }
    router
}

/// `GET /v1/routes`: the endpoints above, which the web app's list must equal.
pub fn listing() -> Value {
    Value::Array(
        ENDPOINTS
            .iter()
            .map(|endpoint| {
                json!({
                    "method": endpoint.method.as_str(),
                    "path": endpoint.path,
                    "operation": endpoint.operation,
                })
            })
            .collect(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_endpoint_runs_a_ported_operation_with_a_schema() {
        let mut seen = Vec::new();
        for endpoint in ENDPOINTS {
            assert!(
                OPERATIONS.iter().any(|op| op.name == endpoint.operation),
                "{} {} names {}, which is not in OPERATIONS",
                endpoint.method,
                endpoint.path,
                endpoint.operation
            );
            assert!(
                zod::schema(endpoint.operation).is_some(),
                "{} has no zod schema",
                endpoint.operation
            );
            let key = (endpoint.method.clone(), endpoint.path);
            assert!(!seen.contains(&key), "{key:?} is listed twice");
            seen.push(key);
        }
    }

    #[test]
    fn matches_a_path_as_the_route_files_do() {
        let (endpoint, params) = route(&Method::POST, "/alerts/a%2Fb/resolve").unwrap();
        assert_eq!(endpoint.operation, "alerts.resolve");
        assert_eq!(params["id"], "a/b");
        assert_eq!(
            route(&Method::GET, "/task-labels").unwrap().0.operation,
            "taskLabels.list"
        );
        assert!(route(&Method::GET, "/task-labels/x").is_none());
        assert!(route(&Method::DELETE, "/task-labels/..").is_none());
        assert!(route(&Method::GET, "/improvements/imp-1").is_none());
    }

    fn list(query: &str) -> Value {
        let params = HashMap::new();
        list_params(&Request {
            params: &params,
            query: Some(query),
            body: b"",
        })
        .unwrap()
    }

    #[test]
    fn reads_list_parameters_as_parse_list_params_does() {
        assert_eq!(list(""), json!({ "limit": 50, "cursor": null }));
        assert_eq!(list("limit="), json!({ "limit": 1, "cursor": null }));
        assert_eq!(list("limit=abc"), json!({ "limit": 50, "cursor": null }));
        assert_eq!(list("limit=1e3"), json!({ "limit": 100, "cursor": null }));
        assert_eq!(list("limit=-0.5"), json!({ "limit": 1, "cursor": null }));
        assert_eq!(list("limit=7.9"), json!({ "limit": 7, "cursor": null }));
        assert_eq!(
            list("limit=Infinity"),
            json!({ "limit": 50, "cursor": null })
        );
        assert_eq!(
            list("cursor=&limit=2&limit=9"),
            json!({ "limit": 2, "cursor": "" })
        );
        assert_eq!(
            list("cursor=a+b%2F"),
            json!({ "limit": 50, "cursor": "a b/" })
        );
    }

    #[test]
    fn reads_a_body_as_request_json_does() {
        assert_eq!(json_body(b"\xef\xbb\xbf{\"a\":1}"), Some(json!({ "a": 1 })));
        assert_eq!(json_body(b" [1] "), Some(json!([1])));
        assert_eq!(json_body(b"null"), None);
        assert_eq!(json_body(b""), None);
        assert_eq!(json_body(b"{"), None);
    }
}
