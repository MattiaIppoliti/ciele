//! `createRateLimiter` and `clientAddress` from `apps/web/src/lib/rate-limit.ts`:
//! fixed windows per key, in this process, failing closed when full. Each
//! instance counts its own window, as each warm Next.js instance does.

use std::collections::HashMap;
use std::sync::{LazyLock, Mutex};

use axum::http::HeaderMap;

const MAX_TRACKED_KEYS: usize = 10_000;

pub struct RateLimiter {
    limit: u32,
    window_ms: f64,
    windows: Mutex<HashMap<String, (u32, f64)>>,
}

impl RateLimiter {
    pub fn new(limit: u32, window_ms: f64) -> Self {
        Self {
            limit,
            window_ms,
            windows: Mutex::new(HashMap::new()),
        }
    }

    /// Whether this request fits the key's window, counting it if so.
    pub fn allow(&self, key: &str, now_ms: f64) -> bool {
        let mut windows = self.windows.lock().unwrap_or_else(|e| e.into_inner());
        match windows.get_mut(key) {
            Some((count, expires)) if *expires > now_ms => {
                if *count >= self.limit {
                    return false;
                }
                *count += 1;
                true
            }
            _ => {
                if windows.len() >= MAX_TRACKED_KEYS {
                    windows.retain(|_, (_, expires)| *expires > now_ms);
                }
                if windows.len() >= MAX_TRACKED_KEYS {
                    return false;
                }
                windows.insert(key.to_owned(), (1, now_ms + self.window_ms));
                true
            }
        }
    }
}

/// `CIELE_TRUSTED_PROXY_HOPS`, read once, as `trustedProxyHops` in
/// `apps/web/src/lib/rate-limit.ts` reads it.
static TRUSTED_PROXY_HOPS: LazyLock<usize> =
    LazyLock::new(|| trusted_proxy_hops(std::env::var("CIELE_TRUSTED_PROXY_HOPS").ok().as_deref()));

/// A whole number of proxies; anything else, and unset, is 0.
fn trusted_proxy_hops(value: Option<&str>) -> usize {
    let trimmed = value.unwrap_or("").trim();
    if trimmed.is_empty() || !trimmed.bytes().all(|byte| byte.is_ascii_digit()) {
        return 0;
    }
    trimmed.parse().unwrap_or(0)
}

/// `clientAddress`, behind the configured number of trusted proxies.
pub fn client_address(headers: &HeaderMap) -> String {
    client_address_behind(headers, *TRUSTED_PROXY_HOPS)
}

/// With no trusted proxies the left-most `x-forwarded-for` hop; behind N that
/// append, the Nth from the right, the one the outermost added. Then
/// `x-real-ip`, then one shared bucket.
fn client_address_behind(headers: &HeaderMap, hops: usize) -> String {
    let header = |name: &str| headers.get(name).and_then(|value| value.to_str().ok());
    header("x-forwarded-for")
        .and_then(|forwarded| {
            let entries: Vec<&str> = forwarded.split(',').collect();
            let at = if hops > 0 {
                entries.len().saturating_sub(hops)
            } else {
                0
            };
            entries.get(at).copied()
        })
        .map(str::trim)
        .filter(|hop| !hop.is_empty())
        .or_else(|| {
            header("x-real-ip")
                .map(str::trim)
                .filter(|ip| !ip.is_empty())
        })
        .unwrap_or("unknown")
        .to_owned()
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::HeaderValue;

    #[test]
    fn admits_the_limit_per_window_then_refuses_until_it_expires() {
        let limiter = RateLimiter::new(2, 1000.0);
        assert!(limiter.allow("a", 0.0));
        assert!(limiter.allow("a", 1.0));
        assert!(!limiter.allow("a", 2.0));
        assert!(limiter.allow("b", 2.0));
        assert!(limiter.allow("a", 1000.0));
    }

    #[test]
    fn reads_the_address_as_the_web_app_does() {
        let mut headers = HeaderMap::new();
        assert_eq!(client_address(&headers), "unknown");
        headers.insert("x-real-ip", HeaderValue::from_static(" 10.0.0.2 "));
        assert_eq!(client_address(&headers), "10.0.0.2");
        headers.insert(
            "x-forwarded-for",
            HeaderValue::from_static("203.0.113.9, 10.0.0.1"),
        );
        assert_eq!(client_address(&headers), "203.0.113.9");
    }

    /// The same cases as `clientAddress` in `apps/web/src/lib/rate-limit.test.ts`.
    #[test]
    fn behind_trusted_proxies_takes_the_hop_the_outermost_one_added() {
        let mut spoofed = HeaderMap::new();
        spoofed.insert(
            "x-forwarded-for",
            HeaderValue::from_static("6.6.6.6, 203.0.113.7, 10.0.0.1"),
        );
        assert_eq!(client_address_behind(&spoofed, 0), "6.6.6.6");
        assert_eq!(client_address_behind(&spoofed, 1), "10.0.0.1");
        assert_eq!(client_address_behind(&spoofed, 2), "203.0.113.7");
        assert_eq!(client_address_behind(&spoofed, 9), "6.6.6.6");
        let mut trailing = HeaderMap::new();
        trailing.insert("x-forwarded-for", HeaderValue::from_static("203.0.113.7, "));
        trailing.insert("x-real-ip", HeaderValue::from_static("10.0.0.9"));
        assert_eq!(client_address_behind(&trailing, 1), "10.0.0.9");
    }

    #[test]
    fn reads_the_hop_count_as_the_web_app_does() {
        assert_eq!(trusted_proxy_hops(None), 0);
        assert_eq!(trusted_proxy_hops(Some("")), 0);
        assert_eq!(trusted_proxy_hops(Some(" 2 ")), 2);
        for refused in ["1x", "-1", "1.5"] {
            assert_eq!(trusted_proxy_hops(Some(refused)), 0, "{refused}");
        }
    }
}
