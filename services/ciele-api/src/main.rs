use std::error::Error;
use std::net::SocketAddr;
use std::sync::Arc;

use ciele_api::{AppState, router};
use sqlx::postgres::PgPoolOptions;
use tracing_subscriber::EnvFilter;

#[tokio::main]
async fn main() -> Result<(), Box<dyn Error>> {
    tracing_subscriber::fmt()
        .json()
        .with_env_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")),
        )
        .init();

    let database_url = required("DATABASE_URL")?;
    let secret = required("CIELE_RUST_API_SECRET")?;
    if secret.len() < 32 {
        return Err("CIELE_RUST_API_SECRET must be at least 32 bytes".into());
    }
    let max_connections = std::env::var("DATABASE_MAX_CONNECTIONS")
        .ok()
        .and_then(|value| value.parse().ok())
        .unwrap_or(10);
    let port: u16 = std::env::var("PORT")
        .ok()
        .and_then(|value| value.parse().ok())
        .unwrap_or(8080);
    let host = std::env::var("HOST").unwrap_or_else(|_| "127.0.0.1".into());

    // Prepared statements are cached per connection, which a transaction-mode
    // pooler breaks: point DATABASE_URL at Postgres directly or at a
    // session-mode pooler. See RUNBOOK.md.
    let pool = PgPoolOptions::new()
        .max_connections(max_connections)
        .connect(&database_url)
        .await?;

    let state = AppState {
        pool,
        secret: Arc::from(secret.into_bytes()),
    };
    let addr: SocketAddr = format!("{host}:{port}").parse()?;
    let listener = tokio::net::TcpListener::bind(addr).await?;
    tracing::info!(%addr, "ciele-api listening");
    axum::serve(listener, router(state))
        .with_graceful_shutdown(shutdown())
        .await?;
    Ok(())
}

/// Ctrl-C locally, SIGTERM from a container runtime.
async fn shutdown() {
    let terminate = async {
        match tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()) {
            Ok(mut signal) => {
                signal.recv().await;
            }
            Err(_) => std::future::pending::<()>().await,
        }
    };
    tokio::select! {
        _ = tokio::signal::ctrl_c() => {}
        _ = terminate => {}
    }
}

fn required(name: &str) -> Result<String, Box<dyn Error>> {
    std::env::var(name)
        .ok()
        .filter(|value| !value.is_empty())
        .ok_or_else(|| format!("{name} is not set").into())
}
