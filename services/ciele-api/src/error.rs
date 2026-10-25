use axum::Json;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use serde_json::json;

/// One failure, in the operations layer's vocabulary.
///
/// `not_found`, `invalid_input` and `conflict` are an `OperationError` on the
/// TypeScript side and come back as one; every other code is a server fault
/// the caller cannot fix, and its message says nothing about the database.
#[derive(Debug)]
pub struct ApiError {
    pub status: StatusCode,
    pub code: &'static str,
    pub message: String,
}

impl ApiError {
    fn new(status: StatusCode, code: &'static str, message: impl Into<String>) -> Self {
        Self {
            status,
            code,
            message: message.into(),
        }
    }

    pub fn not_found(message: impl Into<String>) -> Self {
        Self::new(StatusCode::NOT_FOUND, "not_found", message)
    }

    pub fn invalid_input(message: impl Into<String>) -> Self {
        Self::new(StatusCode::UNPROCESSABLE_ENTITY, "invalid_input", message)
    }

    pub fn conflict(message: impl Into<String>) -> Self {
        Self::new(StatusCode::CONFLICT, "conflict", message)
    }

    pub fn unauthorized() -> Self {
        Self::new(
            StatusCode::UNAUTHORIZED,
            "unauthorized",
            "Invalid or missing assertion",
        )
    }

    pub fn cross_org() -> Self {
        Self::new(
            StatusCode::FORBIDDEN,
            "cross_org",
            "Db.getImprovementProposal: row does not belong to the pinned Organization",
        )
    }

    /// `/api/v1`'s own 401, word for word (`lib/api-v1/auth.ts`).
    pub fn unauthorized_key() -> Self {
        Self::new(
            StatusCode::UNAUTHORIZED,
            "unauthorized",
            "Provide a valid API key as a Bearer token",
        )
    }

    pub fn forbidden() -> Self {
        Self::new(
            StatusCode::FORBIDDEN,
            "forbidden",
            "Role does not allow this operation",
        )
    }

    pub fn unknown_operation(name: &str) -> Self {
        Self::new(
            StatusCode::NOT_FOUND,
            "unknown_operation",
            format!("No operation {name} here"),
        )
    }
}

impl From<sqlx::Error> for ApiError {
    fn from(error: sqlx::Error) -> Self {
        tracing::error!(%error, "database error");
        Self::new(
            StatusCode::INTERNAL_SERVER_ERROR,
            "internal",
            "Internal error",
        )
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let body = json!({ "error": { "code": self.code, "message": self.message } });
        (self.status, Json(body)).into_response()
    }
}
