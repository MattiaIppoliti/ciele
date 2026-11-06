//! The public widget endpoints (#1136): `/api/widget/{assistantId}/…`, at the
//! paths the widget already calls, so `apps/web` (or a proxy in front of it)
//! can rewrite a request here without changing it.
//!
//! Unlike `/v1/ops` there is no assertion. These endpoints are public in the
//! web app too: who may read what is decided by the latest Publication, the
//! Visitor id the widget sends and the sealed SSO gate cookie, and this module
//! decides it the same way `apps/web/src/lib/widget-db.ts` does. The queries
//! run on their own pool as `service_role`, the role the web app's widget Db
//! uses, and filter on the Assistant and its Organization themselves.
//!
//! [`ROUTES`] is what this build answers. `RUST_WIDGET_ROUTES` in
//! `apps/web/src/lib/rust-routing.ts` must name the same list, which the
//! widget parity test checks through `GET /v1/widget`.

pub mod config;
pub mod conversations;
pub mod cors;
pub mod feedback;
pub mod gate;
pub mod help_desks;
pub mod memories;
pub mod models;
pub mod publication;
pub mod rate_limit;
pub mod response;
pub mod session;
pub mod sources;
pub mod subject;

use std::sync::Arc;

use axum::Json;
use axum::Router;
use axum::http::HeaderMap;
use axum::response::Response;
use axum::routing::{get, post};
use serde_json::{Value, json};
use sqlx::PgPool;
use sqlx::postgres::PgPoolOptions;

use gate::SealKeys;
use models::PlatformEnv;
use publication::PublicationCache;

/// The endpoints this build serves, by the name `CIELE_RUST_WIDGET_ROUTES` uses.
pub const ROUTES: &[&str] = &[
    "config",
    "session",
    "feedback",
    "conversation-feedback",
    "conversations",
    "help-desks",
    "memories",
    "sources",
];

#[derive(Clone)]
pub struct WidgetState {
    /// Connections that run as `service_role` (see [`pool`]).
    pub pool: PgPool,
    pub publications: Arc<PublicationCache>,
    pub keys: Arc<SealKeys>,
    pub platform: Arc<PlatformEnv>,
    /// Source downloads' per-address budget.
    pub downloads: Arc<rate_limit::RateLimiter>,
    /// Object storage, absent where the deployment has none.
    pub storage: Option<Arc<sources::Storage>>,
}

impl WidgetState {
    /// Reads `APP_ENCRYPTION_KEY`, `APP_ENCRYPTION_KEY_PREVIOUS` and the
    /// platform model keys, the same variables the web app reads.
    pub fn from_env(pool: PgPool) -> Self {
        let var = |name: &str| std::env::var(name).ok();
        Self {
            pool,
            publications: Arc::new(PublicationCache::default()),
            keys: Arc::new(SealKeys::new(
                var("APP_ENCRYPTION_KEY").as_deref(),
                var("APP_ENCRYPTION_KEY_PREVIOUS").as_deref(),
            )),
            platform: Arc::new(PlatformEnv::from_lookup(var)),
            downloads: sources::limiter(),
            storage: sources::Storage::from_lookup(var).map(Arc::new),
        }
    }
}

/// A lazy pool whose every connection runs as `service_role`, set once when
/// the connection opens, so a widget read costs one round trip and no
/// transaction. Lazy so a service that only runs operations never opens one.
pub fn pool(database_url: &str, max_connections: u32) -> Result<PgPool, sqlx::Error> {
    PgPoolOptions::new()
        .max_connections(max_connections)
        .after_connect(|conn, _meta| {
            Box::pin(async move {
                sqlx::query("set role service_role").execute(conn).await?;
                Ok(())
            })
        })
        .connect_lazy(database_url)
}

pub fn router(state: WidgetState) -> Router {
    Router::new()
        .route("/v1/widget", get(list_routes))
        .route(
            "/api/widget/{assistant_id}/config",
            get(config::get).options(options),
        )
        .route(
            "/api/widget/{assistant_id}/session",
            get(session::get).options(options),
        )
        .route(
            "/api/widget/{assistant_id}/feedback",
            post(feedback::rate_message).options(options),
        )
        .route(
            "/api/widget/{assistant_id}/conversation-feedback",
            post(feedback::rate_conversation).options(options),
        )
        .route(
            "/api/widget/{assistant_id}/conversations",
            get(conversations::get).options(options),
        )
        .route(
            "/api/widget/{assistant_id}/help-desks",
            get(help_desks::get).options(options),
        )
        .route(
            "/api/widget/{assistant_id}/memories",
            get(memories::list)
                .delete(memories::delete)
                .options(options),
        )
        .route(
            "/api/widget/{assistant_id}/sources/{source_id}/download",
            get(sources::download).options(options),
        )
        .with_state(state)
}

/// JavaScript truthiness for a snapshot value (`undefined` is `None`).
pub fn truthy(value: Option<&Value>) -> bool {
    match value {
        None | Some(Value::Null) => false,
        Some(Value::Bool(b)) => *b,
        Some(Value::Number(n)) => n.as_f64().is_some_and(|n| n != 0.0 && !n.is_nan()),
        Some(Value::String(s)) => !s.is_empty(),
        Some(_) => true,
    }
}

/// `Date.now()`.
pub fn now_ms() -> f64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0.0, |elapsed| elapsed.as_millis() as f64)
}

async fn list_routes() -> Json<Value> {
    Json(json!(ROUTES))
}

/// `widgetOptions`: the preflight answers every origin, before any lookup.
async fn options(headers: HeaderMap) -> Response {
    response::empty(
        axum::http::StatusCode::NO_CONTENT,
        &cors::widget_cors(cors::origin(&headers), &[]),
    )
}
