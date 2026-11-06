//! `GET sources/{sourceId}/download`: the original of a cited file Source,
//! for a Visitor, when the published Assistant's link to it has Direct access
//! on (`apps/web/src/app/api/widget/[assistantId]/sources/[sourceId]/download/route.ts`
//! and `apps/web/src/lib/storage/deliver-object.ts`).
//!
//! The same rules as the route: one uniform 404 for every refusal, a ledger
//! row for every refusal and every transfer (`object_access_events`), a
//! per-address budget past which nothing is recorded, and the bytes streamed
//! through this service from a signed URL it mints for itself for 60 seconds
//! and never hands to the caller.

use std::sync::Arc;

use axum::body::Body;
use axum::extract::{Path, RawQuery, State};
use axum::http::{HeaderMap, HeaderValue, StatusCode, header};
use axum::response::Response;
use serde_json::{Value, json};
use sqlx::{PgPool, Row};

use super::conversations::query_param;
use super::publication::resolve;
use super::subject::{SubjectId, widget_subject};
use super::{WidgetState, now_ms, rate_limit::client_address, response};
use crate::js::js_trim;

pub const KNOWLEDGE_ORIGINALS_BUCKET: &str = "knowledge-originals";
/// How long the service's own fetch of the object stays valid. Seconds.
const INTERNAL_URL_TTL: u32 = 60;

/// Object storage, when this deployment has it: the Supabase origin and the
/// service-role key the web app reads.
pub struct Storage {
    pub url: String,
    pub service_key: String,
    pub client: reqwest::Client,
}

impl Storage {
    pub fn from_lookup(var: impl Fn(&str) -> Option<String>) -> Option<Self> {
        let set = |name: &str| var(name).filter(|value| !value.is_empty());
        let url = set("SUPABASE_URL").or_else(|| set("NEXT_PUBLIC_SUPABASE_URL"))?;
        Some(Self {
            url: url.trim_end_matches('/').to_owned(),
            service_key: set("SUPABASE_SERVICE_ROLE_KEY")?,
            client: crate::http::CLIENT.clone(),
        })
    }

    /// `createSignedUrl(path, 60, { download: true })`, then the fetch of it.
    async fn fetch(&self, path: &str) -> Option<reqwest::Response> {
        let path = path.trim_start_matches('/');
        let signed: Value = self
            .client
            .post(format!(
                "{}/storage/v1/object/sign/{KNOWLEDGE_ORIGINALS_BUCKET}/{path}",
                self.url
            ))
            .bearer_auth(&self.service_key)
            .header("apikey", &self.service_key)
            .json(&json!({ "expiresIn": INTERNAL_URL_TTL }))
            .send()
            .await
            .ok()
            .filter(|response| response.status().is_success())?
            .json()
            .await
            .ok()?;
        let signed = signed.get("signedURL")?.as_str()?;
        let upstream = self
            .client
            .get(format!("{}/storage/v1{signed}&download=", self.url))
            .send()
            .await
            .ok()?;
        upstream.status().is_success().then_some(upstream)
    }
}

/// One `object_access_events` row, everything but the outcome.
#[derive(Clone)]
struct Ledger {
    pool: PgPool,
    organization_id: String,
    actor_id: String,
    object_path: String,
    source_id: String,
    ip: String,
    user_agent: Option<String>,
    request_id: Option<String>,
}

impl Ledger {
    /// `recordObjectAccess`: never fails the request.
    async fn record(&self, result: &str, bytes: Option<i64>) {
        let written = sqlx::query(
            "insert into public.object_access_events \
               (organization_id, actor_kind, actor_id, object_kind, object_path, source_id, \
                result, bytes, ip, user_agent, request_id) \
             values ($1::text::uuid, 'visitor', $2, 'knowledge_original', $3, $4, $5, $6, $7, $8, $9)",
        )
        .bind(&self.organization_id)
        .bind(&self.actor_id)
        .bind(&self.object_path)
        .bind(&self.source_id)
        .bind(result)
        .bind(bytes)
        .bind(&self.ip)
        .bind(&self.user_agent)
        .bind(&self.request_id)
        .execute(&self.pool)
        .await;
        if let Err(error) = written {
            tracing::error!(%error, "object access ledger write failed");
        }
    }
}

/// Records the transfer once, whichever way the stream ends; dropped before
/// the end (the Visitor went away) it records `aborted`.
struct Transfer {
    ledger: Option<Ledger>,
    bytes: i64,
    /// The length the response announces. Once that many bytes have gone,
    /// the server stops asking the body for more, so its end never comes.
    expected: Option<i64>,
}

impl Transfer {
    fn finish(&mut self, result: &'static str) {
        if let Some(ledger) = self.ledger.take() {
            let bytes = self.bytes;
            tokio::spawn(async move { ledger.record(result, Some(bytes)).await });
        }
    }
}

impl Drop for Transfer {
    fn drop(&mut self) {
        self.finish("aborted");
    }
}

/// `attachmentDisposition`, sent as the Latin-1 bytes a Fetch `Headers` would
/// send; a name outside Latin-1 fails there, and so here.
fn disposition(filename: &str) -> Option<HeaderValue> {
    let clean: String = filename
        .chars()
        .filter(|c| !matches!(c, '"' | '\\' | '\r' | '\n'))
        .collect();
    let mut bytes = b"attachment; filename=\"".to_vec();
    for c in clean.chars() {
        bytes.push(u8::try_from(u32::from(c)).ok()?);
    }
    bytes.push(b'"');
    HeaderValue::from_bytes(&bytes).ok()
}

/// `canServeOriginal` in `apps/web/src/lib/direct-access.ts`. Its first leg,
/// a live Publication, is what `resolve` already answered; the other three
/// are here: linked to this Assistant with Direct access on, a file Source,
/// and a retained original.
fn can_serve_original(
    direct_access: Option<bool>,
    kind: Option<&str>,
    original: Option<&str>,
) -> bool {
    direct_access == Some(true)
        && kind == Some("file")
        && original.is_some_and(|path| !path.is_empty())
}

pub async fn download(
    State(state): State<WidgetState>,
    Path((assistant_id, source_id)): Path<(String, String)>,
    RawQuery(query): RawQuery,
    headers: HeaderMap,
) -> Response {
    let ctx = match resolve(&state.publications, &state.pool, assistant_id, &headers).await {
        Ok(ctx) => ctx,
        Err(response) => return *response,
    };
    let ip = client_address(&headers);
    if !state.downloads.allow(&ip, now_ms()) {
        return response::text(
            StatusCode::TOO_MANY_REQUESTS,
            &ctx.cors,
            "Too many requests",
        );
    }
    let organization_id = ctx.publication.organization_id().to_owned();

    let source = sqlx::query(
        "select s.kind, s.original_object_path, s.name, \
           (select a.direct_access from public.assistant_sources a \
             where a.source_id = s.id and a.assistant_id = $2 \
             order by a.created_at limit 1) as direct_access \
         from public.sources s where s.id = $1",
    )
    .bind(&source_id)
    .bind(&ctx.assistant_id)
    .fetch_optional(&state.pool)
    .await;
    let source = match source {
        Ok(source) => source,
        Err(error) => return response::internal(&error),
    };
    let column = |name: &str| -> Option<String> {
        source
            .as_ref()
            .and_then(|row| row.try_get::<Option<String>, _>(name).ok().flatten())
    };
    let original = column("original_object_path");
    let direct = source.as_ref().and_then(|row| {
        row.try_get::<Option<bool>, _>("direct_access")
            .ok()
            .flatten()
    });
    let allowed = can_serve_original(direct, column("kind").as_deref(), original.as_deref());

    // An SSO gate is a verified identity; otherwise the visitor id the widget
    // sends is a correlation hint, and "anonymous" when it sends none.
    let visitor = query_param(query.as_deref(), "visitorId")
        .map(|id| js_trim(&id).to_owned())
        .filter(|id| !id.is_empty())
        .unwrap_or_else(|| "anonymous".to_owned());
    let subject = widget_subject(
        &headers,
        &state.keys,
        &organization_id,
        SubjectId::Text(visitor),
    );
    let header = |name: &str| {
        headers
            .get(name)
            .and_then(|value| value.to_str().ok())
            .map(str::to_owned)
    };
    let ledger = Ledger {
        pool: state.pool.clone(),
        organization_id,
        // A gate's subject or the query's id: both are text, never unmatchable.
        actor_id: subject.id.as_text().unwrap_or_default().to_owned(),
        object_path: original
            .clone()
            .unwrap_or_else(|| format!("source:{source_id}")),
        source_id,
        ip,
        user_agent: header("user-agent"),
        request_id: header("x-request-id").or_else(|| header("x-vercel-id")),
    };

    if !allowed {
        ledger.record("refused", None).await;
        return response::not_found(&ctx.cors);
    }
    // No object storage: the original cannot be served, our side's failure,
    // recorded like any other.
    let Some(storage) = state.storage.as_deref() else {
        ledger.record("failed", None).await;
        return response::not_found(&ctx.cors);
    };
    let Some(upstream) = storage.fetch(original.as_deref().unwrap_or("")).await else {
        ledger.record("failed", None).await;
        return response::not_found(&ctx.cors);
    };
    let Some(disposition) = disposition(&column("name").unwrap_or_default()) else {
        return response::bare_500();
    };

    let content_type = upstream
        .headers()
        .get(header::CONTENT_TYPE)
        .cloned()
        .unwrap_or_else(|| HeaderValue::from_static("application/octet-stream"));
    // Only when the body passes through unchanged.
    let length = upstream
        .headers()
        .get(header::CONTENT_LENGTH)
        .filter(|_| !upstream.headers().contains_key(header::CONTENT_ENCODING))
        .cloned();

    let transfer = Transfer {
        ledger: Some(ledger),
        bytes: 0,
        expected: length
            .as_ref()
            .and_then(|value| value.to_str().ok())
            .and_then(|value| value.parse().ok()),
    };
    let body = futures_util::stream::unfold(Some((upstream, transfer)), |state| async move {
        let (mut upstream, mut transfer) = state?;
        match upstream.chunk().await {
            Ok(Some(chunk)) => {
                transfer.bytes += chunk.len() as i64;
                if transfer
                    .expected
                    .is_some_and(|expected| transfer.bytes >= expected)
                {
                    transfer.finish("served");
                }
                Some((Ok(chunk), Some((upstream, transfer))))
            }
            Ok(None) => {
                transfer.finish("served");
                None
            }
            Err(error) => {
                transfer.finish("failed");
                Some((Err(error), None))
            }
        }
    });

    let mut response = Response::new(Body::from_stream(body));
    let out = response.headers_mut();
    for (name, value) in ctx.cors.iter() {
        if let Ok(value) = HeaderValue::from_str(value) {
            out.insert(*name, value);
        }
    }
    out.insert(header::CONTENT_TYPE, content_type);
    if let Some(length) = length {
        out.insert(header::CONTENT_LENGTH, length);
    }
    out.insert(header::CONTENT_DISPOSITION, disposition);
    out.insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("private, no-store"),
    );
    response
}

/// Shared so every request counts against one budget per address.
pub fn limiter() -> Arc<super::rate_limit::RateLimiter> {
    // Thirty per ten minutes: far above a person clicking citations.
    Arc::new(super::rate_limit::RateLimiter::new(
        30,
        10.0 * 60.0 * 1000.0,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serves_an_original_only_when_all_three_legs_hold() {
        let path = Some("org/handbook.pdf");
        assert!(can_serve_original(Some(true), Some("file"), path));
        assert!(!can_serve_original(Some(false), Some("file"), path));
        assert!(!can_serve_original(None, Some("file"), path));
        assert!(!can_serve_original(Some(true), Some("url"), path));
        assert!(!can_serve_original(Some(true), Some("file"), Some("")));
        assert!(!can_serve_original(Some(true), Some("file"), None));
    }

    #[test]
    fn offers_an_attachment_and_strips_what_could_end_the_header() {
        assert_eq!(
            disposition("a\"b\\c\r\nd.pdf").unwrap(),
            "attachment; filename=\"abcd.pdf\""
        );
        assert_eq!(
            disposition("Café.pdf").unwrap().as_bytes(),
            b"attachment; filename=\"Caf\xe9.pdf\""
        );
        assert!(disposition("资料.pdf").is_none());
    }

    #[test]
    fn needs_both_the_origin_and_the_service_key() {
        let env = |vars: &'static [(&'static str, &'static str)]| {
            move |name: &str| {
                vars.iter()
                    .find(|(k, _)| *k == name)
                    .map(|(_, v)| (*v).to_owned())
            }
        };
        assert!(Storage::from_lookup(env(&[("NEXT_PUBLIC_SUPABASE_URL", "http://s")])).is_none());
        let storage = Storage::from_lookup(env(&[
            ("NEXT_PUBLIC_SUPABASE_URL", "http://s/"),
            ("SUPABASE_SERVICE_ROLE_KEY", "k"),
        ]))
        .unwrap();
        assert_eq!(storage.url, "http://s");
    }
}
