//! An `/api/v1` request on behalf of an MCP caller (#1135): the twin of
//! `CieleClient.requestResponse` in `packages/client/src/index.ts`.
//!
//! An endpoint this service answers itself ([`crate::v1::ENDPOINTS`]) runs
//! in-process through the same handler its `/api/v1` route uses, so the call
//! makes no request at all, to Next.js or anywhere. Every other endpoint is an
//! HTTP request to `CIELE_MCP_API_ORIGIN` with the caller's own key, which is
//! what the TypeScript tools do for every call, so the key's Role stays the
//! boundary wherever the operation runs.

use axum::body::Bytes;
use axum::http::{HeaderMap, HeaderValue, Method, header};
use serde_json::{Map, Value};

use crate::AppState;
use crate::mcp::Caller;
use crate::v1;

/// What a tool call fails with, and how `callTool` words each kind.
#[derive(Debug)]
pub enum Fail {
    /// `ToolInputError`: the text as thrown.
    Input(String),
    /// `CieleApiError`: `<status> <code>: <message>`.
    Api {
        status: u16,
        code: String,
        message: String,
    },
    /// Anything else: its `message`.
    Other(String),
}

impl Fail {
    pub fn input(text: impl Into<String>) -> Self {
        Self::Input(text.into())
    }

    pub fn text(&self) -> String {
        match self {
            Self::Input(text) | Self::Other(text) => text.clone(),
            Self::Api {
                status,
                code,
                message,
            } => format!("{status} {code}: {message}"),
        }
    }
}

/// One multipart field, as `linkedForm` builds them.
pub enum Field {
    Text(&'static str, String),
    File {
        name: &'static str,
        filename: String,
        mime: &'static str,
        bytes: Vec<u8>,
    },
}

pub enum Body {
    None,
    Json(Value),
    Form(Vec<Field>),
}

pub struct ApiRequest {
    pub method: Method,
    /// Relative to `/api/v1`, interpolations already `encodeURIComponent`-ed.
    pub path: String,
    /// `url.searchParams.set` in this order; a `None` value is skipped.
    pub query: Vec<(&'static str, Option<String>)>,
    pub body: Body,
    pub accept: Option<&'static str>,
}

impl ApiRequest {
    pub fn new(method: Method, path: impl Into<String>) -> Self {
        Self {
            method,
            path: path.into(),
            query: Vec::new(),
            body: Body::None,
            accept: None,
        }
    }

    pub fn get(path: impl Into<String>) -> Self {
        Self::new(Method::GET, path)
    }

    pub fn post(path: impl Into<String>) -> Self {
        Self::new(Method::POST, path)
    }

    pub fn patch(path: impl Into<String>) -> Self {
        Self::new(Method::PATCH, path)
    }

    pub fn put(path: impl Into<String>) -> Self {
        Self::new(Method::PUT, path)
    }

    pub fn delete(path: impl Into<String>) -> Self {
        Self::new(Method::DELETE, path)
    }

    pub fn json(mut self, body: Value) -> Self {
        self.body = Body::Json(body);
        self
    }

    pub fn form(mut self, fields: Vec<Field>) -> Self {
        self.body = Body::Form(fields);
        self
    }

    pub fn query(mut self, key: &'static str, value: Option<String>) -> Self {
        self.query.push((key, value));
        self
    }

    pub fn accept(mut self, accept: &'static str) -> Self {
        self.accept = Some(accept);
        self
    }

    fn query_string(&self) -> Option<String> {
        let mut serializer = form_urlencoded::Serializer::new(String::new());
        let mut any = false;
        for (key, value) in &self.query {
            if let Some(value) = value {
                serializer.append_pair(key, value);
                any = true;
            }
        }
        any.then(|| serializer.finish())
    }
}

pub struct ApiResponse {
    pub status: u16,
    pub content_type: Option<String>,
    pub bytes: Bytes,
}

pub struct Api<'a> {
    pub state: &'a AppState,
    pub caller: &'a Caller,
}

impl Api<'_> {
    fn direct(
        &self,
        request: &ApiRequest,
    ) -> Option<(
        &'static v1::Endpoint,
        std::collections::HashMap<String, String>,
    )> {
        if request.path.contains('?') || matches!(request.body, Body::Form(_)) {
            return None;
        }
        let (endpoint, params) = v1::route(&request.method, &request.path)?;
        let enabled = match &self.state.mcp.operations {
            Some(listed) => listed.iter().any(|name| name == endpoint.operation),
            None => true,
        };
        enabled.then_some((endpoint, params))
    }

    /// `requestResponse`: the response when it is 2xx, else the envelope as a
    /// [`Fail::Api`].
    pub async fn send(&self, request: ApiRequest) -> Result<ApiResponse, Fail> {
        let response = match self.direct(&request) {
            Some((endpoint, params)) => self.in_process(endpoint, params, &request).await,
            None => self.over_http(&request).await?,
        };
        if !(200..300).contains(&response.status) {
            let envelope: Option<Value> = serde_json::from_slice(&response.bytes).ok();
            let error = envelope.as_ref().and_then(|body| body.get("error"));
            let field = |name: &str| {
                error
                    .and_then(|error| error.get(name))
                    .and_then(Value::as_str)
                    .map(str::to_owned)
            };
            return Err(Fail::Api {
                status: response.status,
                code: field("code").unwrap_or_else(|| "unknown".into()),
                message: field("message").unwrap_or_else(|| format!("HTTP {}", response.status)),
            });
        }
        Ok(response)
    }

    /// `request`: the JSON answer, `None` for a 204.
    pub async fn request(&self, request: ApiRequest) -> Result<Option<Value>, Fail> {
        let response = self.send(request).await?;
        if response.status == 204 {
            return Ok(None);
        }
        serde_json::from_slice(&response.bytes)
            .map(Some)
            .map_err(|error| Fail::Other(error.to_string()))
    }

    /// `request` with `parseText`.
    pub async fn text(&self, request: ApiRequest) -> Result<String, Fail> {
        let response = self.send(request).await?;
        Ok(String::from_utf8_lossy(&response.bytes).into_owned())
    }

    async fn in_process(
        &self,
        endpoint: &'static v1::Endpoint,
        params: std::collections::HashMap<String, String>,
        request: &ApiRequest,
    ) -> ApiResponse {
        let mut headers = HeaderMap::new();
        if let Ok(value) = HeaderValue::from_str(&format!("Bearer {}", self.caller.secret)) {
            headers.insert(header::AUTHORIZATION, value);
        }
        let body = match &request.body {
            Body::Json(value) => Bytes::from(value.to_string()),
            _ => Bytes::new(),
        };
        let response = v1::handle(
            endpoint,
            self.state.clone(),
            params,
            request.query_string(),
            headers,
            body,
        )
        .await;
        let status = response.status().as_u16();
        let content_type = response
            .headers()
            .get(header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .map(str::to_owned);
        let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap_or_default();
        ApiResponse {
            status,
            content_type,
            bytes,
        }
    }

    async fn over_http(&self, request: &ApiRequest) -> Result<ApiResponse, Fail> {
        let Some(origin) = self.state.mcp.api_origin.as_deref() else {
            return Err(Fail::Other(
                "CIELE_MCP_API_ORIGIN is not set, so this tool cannot reach /api/v1".into(),
            ));
        };
        let mut url = format!("{}/api/v1{}", origin.trim_end_matches('/'), request.path);
        if let Some(query) = request.query_string() {
            url.push('?');
            url.push_str(&query);
        }
        let mut builder = crate::http::CLIENT
            .request(request.method.clone(), &url)
            .timeout(self.state.mcp.api_timeout)
            .header(
                header::AUTHORIZATION,
                format!("Bearer {}", self.caller.secret),
            );
        if let Some(accept) = request.accept {
            builder = builder.header(header::ACCEPT, accept);
        }
        builder = match &request.body {
            Body::None => builder,
            Body::Json(value) => builder
                .header(header::CONTENT_TYPE, "application/json")
                .body(value.to_string()),
            Body::Form(fields) => {
                let mut form = reqwest::multipart::Form::new();
                for field in fields {
                    form = match field {
                        Field::Text(name, value) => form.text(*name, value.clone()),
                        Field::File {
                            name,
                            filename,
                            mime,
                            bytes,
                        } => {
                            let part = reqwest::multipart::Part::bytes(bytes.clone())
                                .file_name(filename.clone())
                                .mime_str(mime)
                                .map_err(|error| Fail::Other(error.to_string()))?;
                            form.part(*name, part)
                        }
                    };
                }
                builder.multipart(form)
            }
        };
        let response = builder
            .send()
            .await
            .map_err(|error| self.unanswered(&error))?;
        let status = response.status().as_u16();
        let content_type = response
            .headers()
            .get(header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .map(str::to_owned);
        let bytes = response
            .bytes()
            .await
            .map_err(|error| self.unanswered(&error))?;
        Ok(ApiResponse {
            status,
            content_type,
            bytes,
        })
    }
}

impl Api<'_> {
    /// A call to the web app that got no answer. Undici's own words when the
    /// connection failed, as the TypeScript tools report it; ours when the web
    /// app took the request and outlasted [`crate::mcp::McpSettings::api_timeout`],
    /// which has no TypeScript twin because there the platform ends the
    /// function instead.
    fn unanswered(&self, error: &reqwest::Error) -> Fail {
        if error.is_timeout() {
            Fail::Other(format!(
                "The web app did not answer within {} ms",
                self.state.mcp.api_timeout.as_millis()
            ))
        } else {
            Fail::Other("fetch failed".into())
        }
    }
}

/// `encodeURIComponent`.
pub fn encode(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for byte in value.as_bytes() {
        let c = *byte as char;
        if c.is_ascii_alphanumeric() || "-_.!~*'()".contains(c) {
            out.push(c);
        } else {
            out.push_str(&format!("%{byte:02X}"));
        }
    }
    out
}

/// `String(value)` for what a tool puts in a query string.
pub fn js_string(value: &Value) -> String {
    match value {
        Value::String(text) => text.clone(),
        Value::Number(number) => match number.as_f64() {
            Some(float) if float.fract() == 0.0 && float.abs() < 1e21 => {
                format!("{}", float as i64)
            }
            _ => number.to_string(),
        },
        Value::Null => "null".into(),
        Value::Bool(flag) => flag.to_string(),
        Value::Array(items) => items.iter().map(js_string).collect::<Vec<_>>().join(","),
        Value::Object(_) => "[object Object]".into(),
    }
}

/// A JSON value as `JSON.parse` then `JSON.stringify` would write it back: a
/// number with no fraction loses its `.0`, as JavaScript has no other kind.
pub fn js_normalize(value: Value) -> Value {
    match value {
        Value::Number(number) => match (number.as_i64(), number.as_u64(), number.as_f64()) {
            (None, None, Some(float))
                if float.fract() == 0.0 && float.abs() < 9.007_199_254_740_992e15 =>
            {
                Value::from(float as i64)
            }
            _ => Value::Number(number),
        },
        Value::Array(items) => Value::Array(items.into_iter().map(js_normalize).collect()),
        Value::Object(fields) => Value::Object(
            fields
                .into_iter()
                .map(|(key, value)| (key, js_normalize(value)))
                .collect::<Map<_, _>>(),
        ),
        other => other,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::sync::Arc;
    use std::time::{Duration, Instant};

    use crate::api_key::KeyContext;
    use crate::assertion::Role;
    use crate::mcp::McpSettings;

    fn state(origin: String, timeout: Duration) -> AppState {
        let pool = sqlx::postgres::PgPoolOptions::new()
            .connect_lazy("postgres://nobody@127.0.0.1:1/none")
            .unwrap();
        AppState {
            direct_pool: pool.clone(),
            pool,
            secret: Arc::from(&b"0123456789abcdef0123456789abcdef"[..]),
            mcp: McpSettings {
                api_origin: Some(origin),
                api_timeout: timeout,
                ..McpSettings::default()
            },
        }
    }

    fn caller() -> Caller {
        Caller {
            key: KeyContext {
                organization_id: "o".into(),
                role: Role::Owner,
                caps: None,
                key_id: "k".into(),
                actor_user_id: "u".into(),
            },
            secret: "ciele_sk_test".into(),
        }
    }

    /// An unported endpoint, so the call goes over HTTP.
    async fn unported(state: &AppState) -> Fail {
        let api = Api {
            state,
            caller: &caller(),
        };
        api.request(ApiRequest::get("/assistants"))
            .await
            .expect_err("no web app answers")
    }

    #[tokio::test]
    async fn gives_up_on_a_web_app_that_takes_the_request_and_never_answers() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let origin = format!("http://{}", listener.local_addr().unwrap());
        // Accepts, reads nothing back, holds the socket open.
        let held = tokio::spawn(async move {
            let (socket, _) = listener.accept().await.unwrap();
            tokio::time::sleep(Duration::from_secs(30)).await;
            drop(socket);
        });
        let started = Instant::now();
        let fail = unported(&state(origin, Duration::from_millis(200))).await;
        assert!(
            started.elapsed() < Duration::from_secs(5),
            "the timeout held"
        );
        assert_eq!(fail.text(), "The web app did not answer within 200 ms");
        held.abort();
    }

    #[tokio::test]
    async fn reports_an_unreachable_web_app_in_undicis_words() {
        // Bound, then dropped: nothing listens there now.
        let port = std::net::TcpListener::bind("127.0.0.1:0")
            .unwrap()
            .local_addr()
            .unwrap()
            .port();
        let fail = unported(&state(
            format!("http://127.0.0.1:{port}"),
            Duration::from_secs(5),
        ))
        .await;
        assert_eq!(fail.text(), "fetch failed");
    }

    #[test]
    fn encodes_as_encode_uri_component() {
        assert_eq!(encode("a b/c?d#é~*'()!"), "a%20b%2Fc%3Fd%23%C3%A9~*'()!");
    }

    #[test]
    fn writes_query_values_as_string_does() {
        assert_eq!(js_string(&json!(2)), "2");
        assert_eq!(js_string(&json!(2.0)), "2");
        assert_eq!(js_string(&json!(1.5)), "1.5");
        assert_eq!(
            js_normalize(json!({ "a": [2.0, 1.5] })).to_string(),
            r#"{"a":[2,1.5]}"#
        );
    }

    #[test]
    fn serialises_a_query_as_url_search_params_does() {
        let request = ApiRequest::get("/tasks")
            .query("q", Some("a b&c".into()))
            .query("skip", None)
            .query("cursor", Some("é".into()));
        assert_eq!(request.query_string().unwrap(), "q=a+b%26c&cursor=%C3%A9");
        assert!(
            ApiRequest::get("/x")
                .query("a", None)
                .query_string()
                .is_none()
        );
    }
}
