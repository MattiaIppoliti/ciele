//! The service as a Vercel Function (map #1111). `vercel.json` rewrites every
//! path here, and the router is the self-host binary's own.
//!
//! A Function rather than a container: Vercel's container runtime serves one
//! request per instance and, after any request that lasts more than a few
//! milliseconds, held the next one for about a second. The same 40 ms handler
//! answered back-to-back calls in 0.16 to 0.30 s as a Function and in about
//! 1 s as a container.

use ciele_api::{init_tracing, router, state_from_env};
use tower::ServiceBuilder;
use vercel_runtime::Error;
use vercel_runtime::axum::VercelLayer;

#[tokio::main]
async fn main() -> Result<(), Error> {
    init_tracing();
    let state = state_from_env().await?;
    let app = ServiceBuilder::new()
        .layer(VercelLayer::new())
        .service(router(state));
    vercel_runtime::run(app).await
}
