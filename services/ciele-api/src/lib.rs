//! `ciele-api`: operations from `@ciele/ops`, ported one domain at a time
//! (map #1111, #1121).
//!
//! The web app stays the front door. It authenticates, checks capability and
//! validates input exactly as before, then, for an operation listed in
//! `CIELE_RUST_OPERATIONS`, posts the parsed input here with a signed
//! assertion of who is asking ([`assertion`]). This service opens a
//! transaction as that caller ([`scope`]) and runs the operation.
//!
//! `POST /v1/ops/{operation}` answers `{"result": …}` or
//! `{"error": {"code", "message"}}`. `GET /v1/ops` lists [`OPERATIONS`], which
//! the parity test holds to the TypeScript side.

pub mod alerts;
pub mod assertion;
pub mod error;
pub mod improvements;
pub mod input;
pub mod js;
pub mod rows;
pub mod scope;
pub mod task_labels;

use std::pin::Pin;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use axum::body::Bytes;
use axum::extract::{Path, State};
use axum::http::HeaderMap;
use axum::routing::{get, post};
use axum::{Json, Router};
use serde_json::{Value, json};
use sqlx::{PgConnection, PgPool};

use assertion::{Claims, Role};
use error::ApiError;

#[derive(Clone)]
pub struct AppState {
    pub pool: PgPool,
    pub secret: Arc<[u8]>,
}

pub fn router(state: AppState) -> Router {
    Router::<AppState>::new()
        .route("/healthz", get(|| async { "ok" }))
        .route("/v1/ops", get(list_operations))
        .route("/v1/ops/{operation}", post(run_operation))
        .with_state(state)
}

type Outcome<'a> = Pin<Box<dyn Future<Output = Result<Value, ApiError>> + Send + 'a>>;
type Handler = for<'a> fn(&'a mut PgConnection, &'a Claims, Value) -> Outcome<'a>;

/// One ported operation.
pub struct Operation {
    pub name: &'static str,
    /// The least Role it needs, the rung its TypeScript `capability` names.
    /// The web app checked it already; this is the second lock.
    pub role: Role,
    run: Handler,
}

/// Every operation this service runs. Porting one is a row here; the parity
/// test then asks for its cases and checks its role against the TypeScript
/// `capability`.
pub static OPERATIONS: &[Operation] = &[
    Operation {
        name: "alerts.list",
        role: Role::Viewer,
        run: |conn, claims, _| Box::pin(alerts::list(conn, claims)),
    },
    Operation {
        name: "alerts.resolve",
        role: Role::Editor,
        run: |conn, claims, input| Box::pin(alerts::resolve(conn, claims, input)),
    },
    Operation {
        name: "alerts.update",
        role: Role::Editor,
        run: |conn, claims, input| Box::pin(alerts::update(conn, claims, input)),
    },
    Operation {
        name: "taskLabels.list",
        role: Role::Viewer,
        run: |conn, claims, _| Box::pin(task_labels::list(conn, claims)),
    },
    Operation {
        name: "taskLabels.create",
        role: Role::Editor,
        run: |conn, claims, input| Box::pin(task_labels::create(conn, claims, input)),
    },
    Operation {
        name: "taskLabels.update",
        role: Role::Editor,
        run: |conn, claims, input| Box::pin(task_labels::update(conn, claims, input)),
    },
    Operation {
        name: "taskLabels.delete",
        role: Role::Editor,
        run: |conn, claims, input| Box::pin(task_labels::delete(conn, claims, input)),
    },
    Operation {
        name: "improvements.list",
        role: Role::Viewer,
        run: |conn, claims, _| Box::pin(improvements::list(conn, claims)),
    },
    Operation {
        name: "improvements.listPage",
        role: Role::Viewer,
        run: |conn, claims, input| Box::pin(improvements::list_page(conn, claims, input)),
    },
    Operation {
        name: "improvements.fix.propose",
        role: Role::Editor,
        run: |conn, claims, input| Box::pin(improvements::propose(conn, claims, input)),
    },
    Operation {
        name: "improvements.fix.dismiss",
        role: Role::Editor,
        run: |conn, claims, input| Box::pin(improvements::dismiss(conn, claims, input)),
    },
];

async fn list_operations() -> Json<Value> {
    Json(Value::Array(
        OPERATIONS
            .iter()
            .map(|op| json!({ "name": op.name, "role": op.role }))
            .collect(),
    ))
}

async fn run_operation(
    State(state): State<AppState>,
    Path(operation): Path<String>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<Json<Value>, ApiError> {
    let op = OPERATIONS
        .iter()
        .find(|op| op.name == operation)
        .ok_or_else(|| ApiError::unknown_operation(&operation))?;
    let token = headers
        .get(assertion::HEADER)
        .and_then(|value| value.to_str().ok())
        .ok_or_else(ApiError::unauthorized)?;
    let claims = assertion::verify(&state.secret, token, op.name, &body, unix_now())?;
    if claims.role < op.role {
        return Err(ApiError::forbidden());
    }
    let input: Value = if body.is_empty() {
        json!({})
    } else {
        serde_json::from_slice(&body).map_err(|_| ApiError::invalid_input("Body is not JSON"))?
    };
    // Every operation's input is a `z.object`.
    if !input.is_object() {
        return Err(ApiError::invalid_input("Input must be an object"));
    }

    let mut tx = scope::begin(&state.pool, &claims).await?;
    let outcome = (op.run)(&mut tx, &claims, input).await;
    match outcome {
        Ok(result) => {
            tx.commit().await?;
            Ok(Json(json!({ "result": result })))
        }
        Err(error) => {
            // Dropping a transaction only queues its ROLLBACK for the
            // connection's next use, so the role and claims would sit on an
            // idle pooled connection until then. End it now.
            let _ = tx.rollback().await;
            Err(error)
        }
    }
}

fn unix_now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |elapsed| elapsed.as_secs() as i64)
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::Body;
    use axum::http::{Request, StatusCode};
    use http_body_util::BodyExt;
    use sqlx::postgres::PgPoolOptions;
    use tower::ServiceExt;

    const SECRET: &[u8] = b"0123456789abcdef0123456789abcdef";

    /// A pool that never connects: every case here is refused before a query.
    fn app() -> Router {
        let pool = PgPoolOptions::new()
            .connect_lazy("postgres://nobody@127.0.0.1:1/none")
            .unwrap();
        router(AppState {
            pool,
            secret: Arc::from(SECRET),
        })
    }

    async fn call(operation: &str, assertion: Option<String>) -> (StatusCode, Value) {
        call_with(operation, assertion, "{}").await
    }

    async fn call_with(
        operation: &str,
        assertion: Option<String>,
        body: &'static str,
    ) -> (StatusCode, Value) {
        let mut request = Request::post(format!("/v1/ops/{operation}"));
        if let Some(token) = assertion {
            request = request.header(assertion::HEADER, token);
        }
        let response = app()
            .oneshot(request.body(Body::from(body)).unwrap())
            .await
            .unwrap();
        let status = response.status();
        let bytes = response.into_body().collect().await.unwrap().to_bytes();
        (status, serde_json::from_slice(&bytes).unwrap())
    }

    fn token(operation: &str, role: &str) -> String {
        token_for(operation, role, b"{}")
    }

    fn token_for(operation: &str, role: &str, body: &[u8]) -> String {
        assertion::sign(
            SECRET,
            &json!({ "op": operation, "org": "o", "sub": "u", "role": role, "scope": "session",
                     "body": assertion::body_digest(body), "exp": unix_now() + 30 }),
        )
    }

    #[tokio::test]
    async fn refuses_before_touching_the_database() {
        let (status, body) = call(
            "assistants.delete",
            Some(token("assistants.delete", "owner")),
        )
        .await;
        assert_eq!(status, StatusCode::NOT_FOUND);
        assert_eq!(body["error"]["code"], "unknown_operation");

        let (status, _) = call("alerts.list", None).await;
        assert_eq!(status, StatusCode::UNAUTHORIZED);

        let (status, body) = call("alerts.update", Some(token("alerts.update", "viewer"))).await;
        assert_eq!(status, StatusCode::FORBIDDEN);
        assert_eq!(body["error"]["code"], "forbidden");

        // Signed for one Alert, sent for another.
        let resolve_one = token_for("alerts.resolve", "owner", br#"{"id":"al-1"}"#);
        let (status, _) = call_with("alerts.resolve", Some(resolve_one), r#"{"id":"al-2"}"#).await;
        assert_eq!(status, StatusCode::UNAUTHORIZED);

        let (status, body) = call_with(
            "alerts.list",
            Some(token_for("alerts.list", "owner", b"[]")),
            "[]",
        )
        .await;
        assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
        assert_eq!(body["error"]["code"], "invalid_input");
    }

    #[tokio::test]
    async fn lists_its_operations_once_each() {
        let response = app()
            .oneshot(Request::get("/v1/ops").body(Body::empty()).unwrap())
            .await
            .unwrap();
        let bytes = response.into_body().collect().await.unwrap().to_bytes();
        let listed: Vec<Value> = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(listed.len(), OPERATIONS.len());
        assert_eq!(
            listed[0],
            json!({ "name": "alerts.list", "role": "viewer" })
        );
        let mut names: Vec<_> = OPERATIONS.iter().map(|op| op.name).collect();
        names.sort_unstable();
        names.dedup();
        assert_eq!(names.len(), OPERATIONS.len());
    }
}
