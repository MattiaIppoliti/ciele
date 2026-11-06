//! The one outbound HTTP client: the MCP door's calls to the web app
//! ([`crate::mcp_api`]) and the widget's object storage
//! ([`crate::widget::sources`]).
//!
//! reqwest is built with `rustls-no-provider`, so the ring provider is
//! installed here, once, before the client exists. A second client built
//! anywhere else would have to repeat that, which is why there is one.

use std::sync::{LazyLock, Once};
use std::time::Duration;

/// A peer that does not take the connection is down; each caller sets its
/// own request timeout for one that takes it and never answers.
const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);

pub static CLIENT: LazyLock<reqwest::Client> = LazyLock::new(|| {
    static PROVIDER: Once = Once::new();
    PROVIDER.call_once(|| {
        let _ = rustls::crypto::ring::default_provider().install_default();
    });
    reqwest::Client::builder()
        .connect_timeout(CONNECT_TIMEOUT)
        .build()
        .expect("an HTTP client with the ring provider builds")
});
