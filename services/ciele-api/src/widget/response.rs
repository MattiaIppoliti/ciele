//! The response shapes the Next.js widget routes answer with: `Response.json`
//! and `new Response("…")`, plus the CORS headers of the request.

use axum::body::Body;
use axum::http::{HeaderValue, StatusCode, header};
use axum::response::Response;
use serde_json::Value;

use super::cors::Cors;

fn build(status: StatusCode, cors: &Cors, extra: &[(&str, &str)], body: Body) -> Response {
    let mut response = Response::new(body);
    *response.status_mut() = status;
    let headers = response.headers_mut();
    for (name, value) in cors.iter() {
        if let Ok(value) = HeaderValue::from_str(value) {
            headers.insert(*name, value);
        }
    }
    for (name, value) in extra {
        if let (Ok(name), Ok(value)) = (
            header::HeaderName::from_bytes(name.as_bytes()),
            HeaderValue::from_str(value),
        ) {
            headers.insert(name, value);
        }
    }
    response
}

/// `Response.json(body, { status, headers })`.
pub fn json(status: StatusCode, cors: &Cors, extra: &[(&str, &str)], body: &Value) -> Response {
    let mut response = build(status, cors, extra, Body::from(body.to_string()));
    response.headers_mut().insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("application/json"),
    );
    response
}

/// `new Response("Bad request", { status, headers })`.
pub fn text(status: StatusCode, cors: &Cors, body: &'static str) -> Response {
    let mut response = build(status, cors, &[], Body::from(body));
    response.headers_mut().insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("text/plain;charset=UTF-8"),
    );
    response
}

/// `new Response("Not found", { status: 404, headers })`, the widget routes'
/// one answer for a row that is missing or not this subject's to see.
pub fn not_found(cors: &Cors) -> Response {
    text(StatusCode::NOT_FOUND, cors, "Not found")
}

/// `new Response(null, { status, headers })`.
pub fn empty(status: StatusCode, cors: &Cors) -> Response {
    build(status, cors, &[], Body::empty())
}

/// What Next.js answers when a route handler throws: a bare 500, no CORS.
pub fn bare_500() -> Response {
    let mut response = Response::new(Body::from("Internal Server Error"));
    *response.status_mut() = StatusCode::INTERNAL_SERVER_ERROR;
    response
}

/// [`bare_500`] for a failed query, which is logged here and described nowhere else.
pub fn internal(error: &sqlx::Error) -> Response {
    tracing::error!(%error, "widget database error");
    bare_500()
}
