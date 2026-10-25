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
pub mod direct;
pub mod error;
pub mod improvements;
pub mod input;
pub mod js;
pub mod rows;
pub mod scope;
pub mod task_labels;

use std::pin::Pin;
use std::sync::Arc;
use std::time::{Instant, SystemTime, UNIX_EPOCH};

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
    /// `service_role` for the whole session: the `/api/v1` routes this
    /// service answers itself (`direct.rs`) run one statement each on it.
    pub direct_pool: PgPool,
    pub secret: Arc<[u8]>,
}

/// The service's state from its environment, shared by the self-host binary
/// (`src/main.rs`) and the Vercel Function (`api/ops.rs`).
///
/// Prepared statements are cached per connection, which a transaction-mode
/// pooler breaks: point DATABASE_URL at Postgres directly or at a
/// session-mode pooler. See RUNBOOK.md.
pub async fn state_from_env() -> Result<AppState, Box<dyn std::error::Error + Send + Sync>> {
    let database_url = required_env("DATABASE_URL")?;
    let secret = required_env("CIELE_RUST_API_SECRET")?;
    if secret.len() < 32 {
        return Err("CIELE_RUST_API_SECRET must be at least 32 bytes".into());
    }
    let max_connections = std::env::var("DATABASE_MAX_CONNECTIONS")
        .ok()
        .and_then(|value| value.parse().ok())
        .unwrap_or(10);
    let pool = sqlx::postgres::PgPoolOptions::new()
        .max_connections(max_connections)
        .connect(&database_url)
        .await?;
    // The direct routes' session role, `service_role` unless
    // DATABASE_DIRECT_ROLE says otherwise. Empty means the operation pool's
    // own connections: the parity test's PGlite is one session shared with
    // the TypeScript side, where a second pool's statements would collide.
    let direct_role =
        std::env::var("DATABASE_DIRECT_ROLE").unwrap_or_else(|_| "service_role".into());
    if !direct_role
        .chars()
        .all(|c| c.is_ascii_lowercase() || c == '_')
    {
        return Err("DATABASE_DIRECT_ROLE must be a plain role name".into());
    }
    let direct_pool = if direct_role.is_empty() {
        pool.clone()
    } else {
        // No ping before each use: on the direct routes the statement is the
        // whole request, and a ping would add a round trip to every one.
        sqlx::postgres::PgPoolOptions::new()
            .max_connections(max_connections.min(2))
            .test_before_acquire(false)
            .idle_timeout(std::time::Duration::from_secs(60))
            .after_connect(move |conn, _| {
                let statement = format!("set role {direct_role}");
                Box::pin(async move {
                    sqlx::query(&statement).execute(conn).await?;
                    Ok(())
                })
            })
            .connect_lazy(&database_url)?
    };
    Ok(AppState {
        pool,
        direct_pool,
        secret: Arc::from(secret.into_bytes()),
    })
}

/// JSON logs, `RUST_LOG` or `info`.
pub fn init_tracing() {
    tracing_subscriber::fmt()
        .json()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .init();
}

fn required_env(name: &str) -> Result<String, String> {
    std::env::var(name)
        .ok()
        .filter(|value| !value.is_empty())
        .ok_or_else(|| format!("{name} is not set"))
}

pub fn router(state: AppState) -> Router {
    Router::<AppState>::new()
        .route("/healthz", get(|| async { "ok" }))
        .route("/api/v1/alerts", get(direct::alerts))
        .route("/api/v1/task-labels", get(direct::task_labels))
        .route("/api/v1/improvements", get(direct::improvements))
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

    // Where a call's time goes, one line per call: opening the transaction
    // as the caller (pool acquire included), the operation's own queries,
    // and the commit. The web app's `operation` event times the whole hop.
    let started = Instant::now();
    let (idle, size) = (state.pool.num_idle(), state.pool.size());
    let mut tx = scope::begin(&state.pool, &claims).await?;
    let begun = started.elapsed();
    let outcome = (op.run)(&mut tx, &claims, input).await;
    let ran = started.elapsed() - begun;
    match outcome {
        Ok(result) => {
            tx.commit().await?;
            let total = started.elapsed();
            tracing::info!(
                operation = op.name,
                begin_ms = millis(begun),
                run_ms = millis(ran),
                commit_ms = millis(total - begun - ran),
                total_ms = millis(total),
                pool_idle = idle,
                pool_size = size,
                "operation"
            );
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

fn millis(elapsed: std::time::Duration) -> f64 {
    (elapsed.as_secs_f64() * 10_000.0).round() / 10.0
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
            direct_pool: pool.clone(),
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
