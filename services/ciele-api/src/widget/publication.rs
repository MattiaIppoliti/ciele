//! The latest Publication every widget endpoint starts from, cached.
//!
//! A Publication is immutable, and "which one is latest" changes only when a
//! new row is written. So the cache is keyed by the Publication's own id, and
//! every request still asks Postgres which id is latest, in a query that sends
//! the snapshot back only when it is not the one held here:
//!
//! ```sql
//! select id, version, case when id = $2 then null else config end as config …
//! ```
//!
//! That probe is what makes a stale Publication impossible rather than
//! unlikely: there is no TTL to wait out and no invalidation message to lose,
//! on one instance or ten. What the cache saves is the snapshot itself (the
//! whole Assistant config, every Flow, every Skill) crossing the wire and being
//! parsed on every widget request; the probe reads one row off the
//! `(assistant_id, version desc)` index.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use axum::http::{HeaderMap, StatusCode};
use axum::response::Response;
use serde_json::{Value, json};
use sqlx::{PgPool, Row};

use super::cors::{Cors, allowed_domains, origin, widget_cors};
use super::response;

/// Enough Assistants for any one deployment's widget traffic; past it the
/// cache starts over rather than growing without bound.
const MAX_ENTRIES: usize = 10_000;

pub struct Publication {
    pub id: String,
    pub version: i32,
    pub config: Value,
}

impl Publication {
    pub fn assistant(&self) -> &Value {
        &self.config["assistant"]
    }

    pub fn organization_id(&self) -> &str {
        self.assistant()["organizationId"].as_str().unwrap_or("")
    }
}

#[derive(Default)]
pub struct PublicationCache {
    entries: Mutex<HashMap<String, Arc<Publication>>>,
}

/// What the probe found for one Assistant.
pub struct Probe {
    pub id: String,
    pub version: i32,
    /// Absent when the latest id is the cached one.
    pub config: Option<Value>,
}

impl PublicationCache {
    fn cached_id(&self, assistant_id: &str) -> Option<String> {
        let entries = self.entries.lock().unwrap_or_else(|e| e.into_inner());
        entries.get(assistant_id).map(|entry| entry.id.clone())
    }

    /// Folds a probe into the cache and answers the latest Publication.
    ///
    /// The cached entry is reused only when the probe named its id and sent no
    /// snapshot. Any other answer replaces it, so a Publication written since
    /// the last request is the one served by this one.
    pub fn apply(&self, assistant_id: &str, probe: Option<Probe>) -> Option<Arc<Publication>> {
        let mut entries = self.entries.lock().unwrap_or_else(|e| e.into_inner());
        let Some(probe) = probe else {
            entries.remove(assistant_id);
            return None;
        };
        if probe.config.is_none() {
            if let Some(entry) = entries.get(assistant_id).filter(|e| e.id == probe.id) {
                return Some(entry.clone());
            }
            // The entry went between the probe and now; the caller probes again.
            return None;
        }
        let publication = Arc::new(Publication {
            id: probe.id,
            version: probe.version,
            config: probe.config.unwrap_or(Value::Null),
        });
        if entries.len() >= MAX_ENTRIES {
            entries.clear();
        }
        entries.insert(assistant_id.to_owned(), publication.clone());
        Some(publication)
    }

    pub async fn latest(
        &self,
        pool: &PgPool,
        assistant_id: &str,
    ) -> Result<Option<Arc<Publication>>, sqlx::Error> {
        let mut known = self.cached_id(assistant_id);
        for _ in 0..2 {
            let probe = probe(pool, assistant_id, known.as_deref()).await?;
            let found = probe.is_some();
            if let Some(publication) = self.apply(assistant_id, probe) {
                return Ok(Some(publication));
            }
            if !found {
                return Ok(None);
            }
            known = None;
        }
        Ok(None)
    }
}

async fn probe(
    pool: &PgPool,
    assistant_id: &str,
    known: Option<&str>,
) -> Result<Option<Probe>, sqlx::Error> {
    let row = sqlx::query(
        "select id, version, case when id = $2 then null else config end as config \
         from public.publications where assistant_id = $1 \
         order by version desc limit 1",
    )
    .bind(assistant_id)
    .bind(known.unwrap_or(""))
    .fetch_optional(pool)
    .await?;
    row.map(|row| {
        Ok(Probe {
            id: row.try_get("id")?,
            version: row.try_get("version")?,
            config: row.try_get("config")?,
        })
    })
    .transpose()
}

/// Everything a widget endpoint starts from once the Publication resolves.
pub struct WidgetContext {
    pub assistant_id: String,
    pub publication: Arc<Publication>,
    pub cors: Cors,
}

/// `resolveWidgetContext`: the uniform `not_published` 404 (open CORS), or the
/// Publication and the CORS headers its allowed domains give this Origin.
pub async fn resolve(
    cache: &PublicationCache,
    pool: &PgPool,
    assistant_id: String,
    headers: &HeaderMap,
) -> Result<WidgetContext, Box<Response>> {
    let origin = origin(headers);
    let publication = match cache.latest(pool, &assistant_id).await {
        Ok(Some(publication)) => publication,
        Ok(None) => {
            return Err(Box::new(response::json(
                StatusCode::NOT_FOUND,
                &widget_cors(origin, &[]),
                &[],
                &json!({ "error": "not_published" }),
            )));
        }
        Err(error) => return Err(Box::new(response::internal(&error))),
    };
    let cors = widget_cors(origin, allowed_domains(publication.assistant()));
    Ok(WidgetContext {
        assistant_id,
        publication,
        cors,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn probe(id: &str, version: i32, title: Option<&str>) -> Option<Probe> {
        Some(Probe {
            id: id.to_owned(),
            version,
            config: title.map(|title| json!({ "assistant": { "title": title } })),
        })
    }

    #[test]
    fn a_new_publication_replaces_the_cached_one_on_the_next_request() {
        let cache = PublicationCache::default();
        let first = cache.apply("as-1", probe("pub-1", 1, Some("v1"))).unwrap();
        assert_eq!(first.assistant()["title"], "v1");
        // Same id, no snapshot sent: the cached one.
        let again = cache.apply("as-1", probe("pub-1", 1, None)).unwrap();
        assert!(Arc::ptr_eq(&first, &again));
        assert_eq!(cache.cached_id("as-1").as_deref(), Some("pub-1"));
        // The probe names a newer id with its snapshot: that one, at once.
        let second = cache.apply("as-1", probe("pub-2", 2, Some("v2"))).unwrap();
        assert_eq!(second.version, 2);
        assert_eq!(second.assistant()["title"], "v2");
        assert_eq!(cache.cached_id("as-1").as_deref(), Some("pub-2"));
    }

    #[test]
    fn a_snapshotless_probe_for_another_id_is_never_answered_from_the_cache() {
        let cache = PublicationCache::default();
        cache.apply("as-1", probe("pub-1", 1, Some("v1")));
        assert!(cache.apply("as-1", probe("pub-2", 2, None)).is_none());
    }

    #[test]
    fn an_unpublished_assistant_leaves_the_cache() {
        let cache = PublicationCache::default();
        cache.apply("as-1", probe("pub-1", 1, Some("v1")));
        assert!(cache.apply("as-1", None).is_none());
        assert!(cache.cached_id("as-1").is_none());
    }
}
