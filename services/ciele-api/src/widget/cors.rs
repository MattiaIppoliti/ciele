//! `widgetCors` from `apps/web/src/lib/widget-db.ts`, header for header.

use axum::http::HeaderMap;
use serde_json::Value;

/// The three CORS headers every widget response carries.
pub type Cors = [(&'static str, String); 3];

pub fn origin(headers: &HeaderMap) -> Option<&str> {
    headers.get("origin").and_then(|value| value.to_str().ok())
}

/// An empty allow-list allows every origin and echoes it (`*` without one).
/// Otherwise the Origin's hostname must be a listed domain or a subdomain of
/// one; a refused origin gets the literal `null`.
pub fn widget_cors(origin: Option<&str>, allowed_domains: &[Value]) -> Cors {
    let allowed = allowed_domains.is_empty()
        || origin.is_some_and(|origin| {
            let Ok(url) = url::Url::parse(origin) else {
                return false;
            };
            let host = url.host_str().unwrap_or("");
            allowed_domains.iter().any(|domain| {
                domain
                    .as_str()
                    .is_some_and(|domain| host == domain || host.ends_with(&format!(".{domain}")))
            })
        });
    [
        (
            "access-control-allow-origin",
            if allowed {
                origin.unwrap_or("*").to_owned()
            } else {
                "null".to_owned()
            },
        ),
        (
            "access-control-allow-methods",
            "GET, POST, DELETE, OPTIONS".to_owned(),
        ),
        ("access-control-allow-headers", "Content-Type".to_owned()),
    ]
}

/// `publication.config.assistant.allowedDomains`, `[]` when absent.
pub fn allowed_domains(assistant: &Value) -> &[Value] {
    assistant
        .get("allowedDomains")
        .and_then(Value::as_array)
        .map_or(&[], Vec::as_slice)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn allow_origin(origin: Option<&str>, domains: Value) -> String {
        let domains = domains.as_array().unwrap().clone();
        widget_cors(origin, &domains)[0].1.clone()
    }

    #[test]
    fn an_empty_list_echoes_the_origin_or_answers_star() {
        assert_eq!(
            allow_origin(Some("https://a.test"), json!([])),
            "https://a.test"
        );
        assert_eq!(allow_origin(None, json!([])), "*");
    }

    #[test]
    fn a_listed_domain_and_its_subdomains_pass() {
        let list = json!(["school.edu"]);
        assert_eq!(
            allow_origin(Some("https://school.edu"), list.clone()),
            "https://school.edu"
        );
        assert_eq!(
            allow_origin(Some("https://www.school.edu:8443"), list.clone()),
            "https://www.school.edu:8443"
        );
        assert_eq!(
            allow_origin(Some("https://evilschool.edu"), list.clone()),
            "null"
        );
        assert_eq!(allow_origin(Some("null"), list.clone()), "null");
        assert_eq!(allow_origin(None, list), "null");
    }
}
