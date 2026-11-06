//! The hosted MCP endpoint, `/api/mcp`, served here (#1135).
//!
//! The twin of `apps/web/src/app/api/mcp/route.ts`, on rmcp's stateless
//! Streamable HTTP server, which answers both protocol eras from one handler:
//! the 2026-07-28 revision (no handshake, per-request `_meta`,
//! `server/discover`) and the 2025 era (`initialize`, then requests).
//!
//! What the caller sees is the TypeScript server's:
//!
//! - a POST without a valid Organization API key is refused at the door with
//!   the `/api/v1` 401, before any MCP parsing, as `resolveApiKeyContext`
//!   refuses it there;
//! - `tools/list` is the TypeScript server's own list, byte for byte: the
//!   files under `packages/mcp/golden` are recorded from it
//!   (`tools-list.golden.test.ts`) and embedded here, so the two cannot drift
//!   without a test failing on one side;
//! - the tool calls are [`crate::mcp_tools`].
//!
//! `CIELE_MCP_READ_ONLY=1` serves the read-only list, whose descriptions say
//! so, and refuses a mutating call before any request leaves, as the stdio
//! server and the TypeScript route do with the same variable.
//!
//! `CIELE_MCP_API_ORIGIN` is required: without it every unported tool would
//! fail, so a POST answers 503 and `main` logs an error at startup.

use std::borrow::Cow;
use std::sync::{Arc, LazyLock};
use std::time::Duration;

use axum::Router;
use axum::extract::{Request, State};
use axum::http::{Method, StatusCode, header};
use axum::middleware::{self, Next};
use axum::response::{IntoResponse, Response};
use rmcp::model::{
    CacheScope, CallToolRequestParams, CallToolResponse, DiscoverResult, Implementation,
    ListToolsResult, MetaObject, PaginatedRequestParams, ProtocolVersion, ServerCapabilities,
    ServerConfig, Tool,
};
use rmcp::service::RequestContext;
use rmcp::transport::streamable_http_server::session::local::LocalSessionManager;
use rmcp::transport::streamable_http_server::{StreamableHttpServerConfig, StreamableHttpService};
use rmcp::{ErrorData, RoleServer, ServerHandler};

use crate::api_key::{self, KeyContext};
use crate::{AppState, v1};

/// The recorded lists, from `packages/mcp/golden`.
pub const TOOLS_JSON: &str = include_str!("../../../packages/mcp/golden/tools-list.json");
pub const TOOLS_READ_ONLY_JSON: &str =
    include_str!("../../../packages/mcp/golden/tools-list.read-only.json");

static TOOLS: LazyLock<Vec<Tool>> =
    LazyLock::new(|| serde_json::from_str(TOOLS_JSON).expect("the golden tool list parses"));
static TOOLS_READ_ONLY: LazyLock<Vec<Tool>> = LazyLock::new(|| {
    serde_json::from_str(TOOLS_READ_ONLY_JSON).expect("the golden tool list parses")
});

/// `CACHE_HINT` in `packages/mcp/src/server.ts`: an hour, private.
const CACHE_TTL_MS: u64 = 60 * 60 * 1000;

/// How long an unported tool call may wait for the web app by default: under
/// the 300 seconds the TypeScript route allows an MCP request (`maxDuration`),
/// which `manage_assistants` `ask` needs for a whole Conversation Turn.
pub const DEFAULT_API_TIMEOUT: Duration = Duration::from_secs(290);

/// How the endpoint is set up, from the environment.
#[derive(Clone, Debug)]
pub struct McpSettings {
    /// `CIELE_MCP_READ_ONLY`.
    pub read_only: bool,
    /// `CIELE_MCP_API_ORIGIN`: the web app, where an unported tool call goes as
    /// an `/api/v1` request with the caller's key. Configuration, never the
    /// request's own `Host`, for the reason `internalApiOrigin` gives (#801).
    pub api_origin: Option<String>,
    /// `CIELE_RUST_OPERATIONS` as the web app reads it: which ported
    /// operations a tool call runs here directly. `None` (unset) is all of
    /// them; take a name off to send that endpoint to the web app instead.
    pub operations: Option<Vec<String>>,
    /// `CIELE_MCP_API_TIMEOUT_MS`: the most an `/api/v1` call to the web app
    /// may take, body included, before the tool fails.
    pub api_timeout: Duration,
}

impl Default for McpSettings {
    fn default() -> Self {
        Self {
            read_only: false,
            api_origin: None,
            operations: None,
            api_timeout: DEFAULT_API_TIMEOUT,
        }
    }
}

/// Who is calling, put in the request by [`require_key`] for the handler.
#[derive(Clone, Debug)]
pub struct Caller {
    pub key: KeyContext,
    /// The raw `ciele_sk_…`, forwarded on an `/api/v1` call.
    pub secret: String,
}

#[derive(Clone)]
pub struct CieleMcp {
    state: AppState,
}

impl CieleMcp {
    fn tools(&self) -> &'static [Tool] {
        if self.state.mcp.read_only {
            &TOOLS_READ_ONLY
        } else {
            &TOOLS
        }
    }
}

impl ServerHandler for CieleMcp {
    fn get_info(&self) -> ServerConfig {
        ServerConfig::new(
            ServerCapabilities::builder()
                .enable_tools()
                .enable_tool_list_changed()
                .build(),
        )
        .with_server_info(Implementation::new("ciele", "0.1.0"))
    }

    fn supported_protocol_versions(&self) -> Cow<'static, [ProtocolVersion]> {
        Cow::Borrowed(&[
            ProtocolVersion::V_2026_07_28,
            ProtocolVersion::V_2025_11_25,
            ProtocolVersion::V_2025_06_18,
            ProtocolVersion::V_2025_03_26,
        ])
    }

    /// The TypeScript server advertises only the modern revision here: a
    /// client that discovers is a modern one.
    async fn discover(
        &self,
        _context: RequestContext<RoleServer>,
    ) -> Result<DiscoverResult, ErrorData> {
        Ok(
            DiscoverResult::from_server_info(vec![ProtocolVersion::V_2026_07_28], self.get_info())
                .with_ttl_ms(CACHE_TTL_MS)
                .with_cache_scope(CacheScope::Private),
        )
    }

    async fn list_tools(
        &self,
        _request: Option<PaginatedRequestParams>,
        context: RequestContext<RoleServer>,
    ) -> Result<ListToolsResult, ErrorData> {
        let mut result = ListToolsResult::with_all_items(self.tools().to_vec());
        result.meta = server_info_meta(&context);
        // Cache hints are a 2026-07-28 field; a 2025-era list carries none.
        if result.meta.is_some() {
            result = result
                .with_ttl_ms(CACHE_TTL_MS)
                .with_cache_scope(CacheScope::Private);
        } else {
            result.ttl_ms = None;
            result.cache_scope = None;
        }
        Ok(result)
    }

    async fn call_tool(
        &self,
        request: CallToolRequestParams,
        context: RequestContext<RoleServer>,
    ) -> Result<CallToolResponse, ErrorData> {
        let caller = context
            .extensions
            .get::<axum::http::request::Parts>()
            .and_then(|parts| parts.extensions.get::<Caller>())
            .cloned()
            .ok_or_else(|| ErrorData::internal_error("no caller on the request", None))?;
        let meta = server_info_meta(&context);
        crate::mcp_tools::call(&self.state, &caller, self.tools(), request)
            .await
            .map(|mut result| {
                result.meta = meta;
                result.into()
            })
    }
}

/// The TypeScript SDK names itself on every 2026-07-28 result, in `_meta`,
/// where the 2025 era named it once, in `initialize`.
fn server_info_meta(context: &RequestContext<RoleServer>) -> Option<MetaObject> {
    let modern = context
        .protocol_version()
        .is_some_and(|version| !version.has_initialize());
    modern.then(|| {
        serde_json::from_value(serde_json::json!({
            "io.modelcontextprotocol/serverInfo": { "name": "ciele", "version": "0.1.0" }
        }))
        .expect("a meta object deserialises from a JSON object")
    })
}

/// What the TypeScript SDK answers a GET (the 2025-era SSE probe) or a DELETE
/// (ending a session): stateless serving has neither.
const METHOD_NOT_ALLOWED: &str =
    r#"{"jsonrpc":"2.0","error":{"code":-32000,"message":"Method not allowed."},"id":null}"#;

/// What a POST gets while `CIELE_MCP_API_ORIGIN` is unset: most tools would
/// fail on every call, so the endpoint refuses outright, and `main` says so
/// at startup.
const NOT_CONFIGURED: &str = r#"{"jsonrpc":"2.0","error":{"code":-32000,"message":"The MCP endpoint is not configured: CIELE_MCP_API_ORIGIN is not set."},"id":null}"#;

/// The door: a POST carries a valid key or is refused with the `/api/v1` 401.
/// Anything else is the SDK's 405, with no key needed, as on the TypeScript
/// route, whose GET and DELETE go straight to the handler.
async fn require_key(State(state): State<AppState>, mut request: Request, next: Next) -> Response {
    if request.method() != Method::POST {
        return (
            StatusCode::METHOD_NOT_ALLOWED,
            [(header::CONTENT_TYPE, "application/json")],
            METHOD_NOT_ALLOWED,
        )
            .into_response();
    }
    if state.mcp.api_origin.is_none() {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            [(header::CONTENT_TYPE, "application/json")],
            NOT_CONFIGURED,
        )
            .into_response();
    }
    let header = v1::authorization(request.headers());
    let Some(secret) = api_key::bearer_secret(header.as_deref()).map(str::to_owned) else {
        return v1::unauthorized();
    };
    match api_key::authenticate(&state.pool, &secret).await {
        Ok(Some(key)) => {
            request.extensions_mut().insert(Caller { key, secret });
            match read_body(request).await {
                Ok(Read::Pass(request)) => next.run(*request).await,
                Ok(Read::Refuse(response)) => response,
                Err(status) => status.into_response(),
            }
        }
        Ok(None) => v1::unauthorized(),
        Err(error) => error.into_response(),
    }
}

/// The largest request body the door reads, as rmcp's own default cap.
const MAX_BODY_BYTES: usize = 4 * 1024 * 1024;

enum Read {
    Pass(Box<Request>),
    Refuse(Response),
}

/// The body, read once at the door for two things the TypeScript SDK does and
/// rmcp does not:
///
/// - rmcp refuses a 2026-07-28 request whose body names its revision in
///   `_meta` unless the `MCP-Protocol-Version` header says it too; the SDK
///   reads the body alone, so a missing header is filled from the body;
/// - rmcp reads `"arguments": null` on a `tools/call` as no arguments, where
///   the SDK refuses any non-object with a JSON-RPC `-32602` naming zod's issue.
async fn read_body(request: Request) -> Result<Read, StatusCode> {
    const HEADER: &str = "mcp-protocol-version";
    let (mut parts, body) = request.into_parts();
    let bytes = axum::body::to_bytes(body, MAX_BODY_BYTES)
        .await
        .map_err(|_| StatusCode::PAYLOAD_TOO_LARGE)?;
    let message = serde_json::from_slice::<serde_json::Value>(&bytes).ok();
    if let Some(message) = &message {
        if message.get("method").and_then(serde_json::Value::as_str) == Some("tools/call")
            && let Some(arguments) = message.pointer("/params/arguments")
            && !arguments.is_object()
        {
            return Ok(Read::Refuse(invalid_arguments(message, arguments)));
        }
        if !parts.headers.contains_key(HEADER)
            && let Some(version) = message
                .pointer("/params/_meta/io.modelcontextprotocol~1protocolVersion")
                .and_then(serde_json::Value::as_str)
            && let Ok(value) = header::HeaderValue::from_str(version)
        {
            parts.headers.insert(HEADER, value);
        }
    }
    Ok(Read::Pass(Box::new(Request::from_parts(
        parts,
        axum::body::Body::from(bytes),
    ))))
}

/// The SDK's answer to a `tools/call` whose `arguments` is not an object.
fn invalid_arguments(message: &serde_json::Value, arguments: &serde_json::Value) -> Response {
    let received = match arguments {
        serde_json::Value::Null => "null",
        serde_json::Value::Bool(_) => "boolean",
        serde_json::Value::Number(_) => "number",
        serde_json::Value::String(_) => "string",
        serde_json::Value::Array(_) => "array",
        serde_json::Value::Object(_) => "object",
    };
    let issues = serde_json::json!([{
        "expected": "record",
        "code": "invalid_type",
        "path": ["params", "arguments"],
        "message": format!("Invalid input: expected record, received {received}"),
    }]);
    let body = serde_json::json!({
        "jsonrpc": "2.0",
        "id": message.get("id").cloned().unwrap_or(serde_json::Value::Null),
        "error": {
            "code": -32602,
            "message": format!(
                "Invalid tools/call request: {}",
                serde_json::to_string_pretty(&issues).unwrap_or_default()
            ),
        },
    });
    (
        StatusCode::OK,
        [(header::CONTENT_TYPE, "application/json")],
        body.to_string(),
    )
        .into_response()
}

/// Mounts `/api/mcp`.
pub fn routes(router: Router<AppState>, state: &AppState) -> Router<AppState> {
    let handler = CieleMcp {
        state: state.clone(),
    };
    let config = StreamableHttpServerConfig::default()
        .with_legacy_session_mode(false)
        .with_json_response(true)
        .with_sse_keep_alive(None)
        // The web app's middleware or a proxy decides which hosts reach this;
        // the TypeScript endpoint does not check `Host` either.
        .disable_allowed_hosts();
    let service: StreamableHttpService<CieleMcp, LocalSessionManager> =
        StreamableHttpService::new(move || Ok(handler.clone()), Arc::default(), config);
    router.nest_service("/api/mcp", tower_layer(service, state.clone()))
}

fn tower_layer(
    service: StreamableHttpService<CieleMcp, LocalSessionManager>,
    state: AppState,
) -> Router {
    Router::new()
        .fallback_service(service)
        .layer(middleware::from_fn_with_state(state, require_key))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// rmcp's `Tool` must carry every field the TypeScript server sends, in
    /// its order, or `tools/list` would differ from the recording on the wire.
    #[test]
    fn its_tool_model_writes_back_the_recorded_bytes() {
        for (tools, recorded) in [
            (&*TOOLS, TOOLS_JSON),
            (&*TOOLS_READ_ONLY, TOOLS_READ_ONLY_JSON),
        ] {
            assert_eq!(tools.len(), 17);
            let written = format!("{}\n", serde_json::to_string_pretty(tools).unwrap());
            assert_eq!(written, recorded);
        }
    }
}
