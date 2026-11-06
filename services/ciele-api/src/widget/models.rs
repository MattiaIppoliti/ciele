//! The widget's model picker rows: `chatModelOptions` from
//! `packages/agent/src/model-options.ts`, with the availability rules of
//! `packages/agent/src/models.ts` it depends on.
//!
//! The static half (catalogue, retired ids, Gateway names, display names, the
//! platform key variables) is `model_catalog.json`, which
//! `packages/agent/src/rust-model-catalog.test.ts` holds to the TypeScript
//! constants. The rules below are the TypeScript ones; the widget parity test
//! runs both over the same connections and environment.

use std::collections::HashSet;
use std::sync::LazyLock;

use serde::Deserialize;
use serde_json::{Map, Value, json};

use super::gate::SealKeys;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Catalog {
    catalog: Map<String, Value>,
    retired: Map<String, Value>,
    gateway: Map<String, Value>,
    sources: Vec<String>,
    source_names: Map<String, Value>,
    provider_names: Map<String, Value>,
    platform_env: Map<String, Value>,
    platform_gateway_env: String,
}

static CATALOG: LazyLock<Catalog> = LazyLock::new(|| {
    serde_json::from_str(include_str!("model_catalog.json")).expect("model_catalog.json parses")
});

const COMPATIBLE: &str = "openai_compatible";

/// Which platform-funded routes this deployment has, from its environment.
#[derive(Default)]
pub struct PlatformEnv {
    /// Catalogue providers whose platform key is set.
    keys: HashSet<String>,
    /// `AI_GATEWAY_API_KEY`.
    gateway: bool,
    /// `OPENAI_COMPATIBLE_BASE_URL` and `OPENAI_COMPATIBLE_CHAT_MODEL`.
    compatible: bool,
}

impl PlatformEnv {
    pub fn from_lookup(var: impl Fn(&str) -> Option<String>) -> Self {
        let set = |name: &str| var(name).is_some_and(|value| !value.is_empty());
        Self {
            keys: CATALOG
                .platform_env
                .iter()
                .filter(|(_, name)| name.as_str().is_some_and(set))
                .map(|(provider, _)| provider.clone())
                .collect(),
            gateway: set(&CATALOG.platform_gateway_env),
            compatible: set("OPENAI_COMPATIBLE_BASE_URL") && set("OPENAI_COMPATIBLE_CHAT_MODEL"),
        }
    }
}

/// One `provider_connections` row, the columns availability reads.
pub struct Connection {
    pub provider: String,
    pub kind: String,
    pub encrypted_key: Option<String>,
    pub config: Value,
}

impl Connection {
    fn has_key(&self) -> bool {
        self.encrypted_key
            .as_deref()
            .is_some_and(|key| !key.is_empty())
    }

    fn config_kind(&self) -> Option<&str> {
        self.config.get("kind").and_then(Value::as_str)
    }
}

/// A platform-owner catalogue addition: `(provider, modelId, label)`.
pub type PlatformModel = (String, String, String);

#[derive(Clone, PartialEq, Debug)]
pub struct ModelRef {
    pub provider: Option<String>,
    pub model_id: Option<String>,
    pub source: Option<String>,
}

fn string(value: Option<&Value>) -> Option<String> {
    value.and_then(Value::as_str).map(str::to_owned)
}

impl ModelRef {
    fn from_allowed(value: &Value) -> Self {
        Self {
            provider: string(value.get("provider")),
            model_id: string(value.get("modelId")),
            source: string(value.get("source")),
        }
    }

    /// The Assistant's configured model: `modelProvider`, `modelId`, `modelSource`.
    pub fn configured(assistant: &Value) -> Self {
        Self {
            provider: string(assistant.get("modelProvider")),
            model_id: string(assistant.get("modelId")),
            source: string(assistant.get("modelSource")),
        }
    }
}

/// `modelChoices`: the configured model first, then the allow-list without it
/// and without repeats. An empty allow-list is no choice.
pub fn choices(assistant: &Value) -> Vec<ModelRef> {
    let configured = ModelRef::configured(assistant);
    let allowed: Vec<ModelRef> = assistant
        .get("allowedModels")
        .and_then(Value::as_array)
        .map(|list| list.iter().map(ModelRef::from_allowed).collect())
        .unwrap_or_default();
    if allowed.is_empty() {
        return vec![configured];
    }
    let mut out = vec![configured.clone()];
    for candidate in allowed {
        if candidate != configured && !out[1..].contains(&candidate) {
            out.push(candidate);
        }
    }
    out
}

fn current_model_id<'a>(provider: &str, model_id: &'a str) -> &'a str {
    let catalog: &'static Catalog = &CATALOG;
    catalog
        .retired
        .get(provider)
        .and_then(|table| table.get(model_id))
        .and_then(Value::as_str)
        .unwrap_or(model_id)
}

/// `gatewayModelId` is non-null.
fn gateway_serves(provider: &str, model_id: &str) -> bool {
    if provider == COMPATIBLE {
        return false;
    }
    match CATALOG.gateway.get(provider).and_then(Value::as_object) {
        Some(table) => match table.get(model_id) {
            Some(name) => !name.is_null(),
            None => true,
        },
        // Not a provider the Gateway table names; TypeScript throws here.
        None => false,
    }
}

struct Availability<'a> {
    env: &'a PlatformEnv,
    connections: &'a [Connection],
    keys: &'a SealKeys,
}

impl Availability<'_> {
    fn first(&self, provider: &str, kind: &str) -> Option<&Connection> {
        self.connections
            .iter()
            .find(|c| c.provider == provider && c.kind == kind && c.has_key())
    }

    /// `openKey`: the key decrypts to something non-empty.
    fn opens(&self, connection: Option<&Connection>) -> bool {
        connection
            .and_then(|c| c.encrypted_key.as_deref())
            .and_then(|key| self.keys.open(key, None))
            .is_some_and(|key| !key.is_empty())
    }

    fn compatible_connection(&self) -> bool {
        self.connections.iter().any(|c| {
            c.provider == COMPATIBLE && c.kind == "api_key" && c.config_kind() == Some(COMPATIBLE)
        })
    }

    /// `providerAvailability(...)[provider]` folded into "can it answer".
    fn automatic(&self, provider: &str, model_id: &str) -> bool {
        if provider == COMPATIBLE {
            return self.env.compatible || self.compatible_connection();
        }
        if !CATALOG.platform_env.contains_key(provider) {
            return false;
        }
        let platform = self.env.keys.contains(provider);
        let byok = self.first(provider, "api_key").is_some();
        let federated = self
            .connections
            .iter()
            .any(|c| c.provider == provider && c.kind == "federated");
        let gateway = (self.env.gateway || self.first("ai_gateway", "api_key").is_some())
            && gateway_serves(provider, current_model_id(provider, model_id));
        platform || byok || federated || gateway
    }

    /// `availableModelSources(...).includes(source)`.
    fn pinned(&self, provider: &str, model_id: &str, source: &str) -> bool {
        if provider == COMPATIBLE {
            let resolved = if self.compatible_connection() {
                Some("api_key")
            } else if self.env.compatible {
                Some("platform")
            } else {
                None
            };
            return resolved == Some(source);
        }
        if !CATALOG.sources.iter().any(|known| known == source) {
            return false;
        }
        let current = current_model_id(provider, model_id);
        match source {
            "platform" => self.env.keys.contains(provider),
            "api_key" => self.opens(self.first(provider, "api_key")),
            "federated" => {
                provider == "google"
                    && self.connections.iter().any(|c| {
                        c.provider == "google"
                            && c.kind == "federated"
                            && c.config_kind() == Some("google_vertex")
                    })
            }
            "ai_gateway" => {
                self.opens(self.first("ai_gateway", "api_key")) && gateway_serves(provider, current)
            }
            "platform_gateway" => self.env.gateway && gateway_serves(provider, current),
            _ => false,
        }
    }
}

fn label(provider: &str, model_id: &str, platform_models: &[PlatformModel]) -> Option<String> {
    let catalogued = CATALOG
        .catalog
        .get(provider)
        .and_then(Value::as_array)
        .and_then(|models| models.iter().find(|m| m["id"].as_str() == Some(model_id)))
        .and_then(|m| m["label"].as_str())
        .map(str::to_owned);
    catalogued.or_else(|| {
        platform_models
            .iter()
            .find(|(p, id, _)| p == provider && id == model_id)
            .map(|(_, _, label)| label.clone())
    })
}

/// `chatModelOptions`: the askable choices, or none when fewer than two are.
pub fn options(
    choices: &[ModelRef],
    connections: &[Connection],
    platform_models: &[PlatformModel],
    env: &PlatformEnv,
    keys: &SealKeys,
) -> Vec<Value> {
    let availability = Availability {
        env,
        connections,
        keys,
    };
    let mut out = Vec::new();
    for choice in choices {
        let (Some(provider), Some(model_id)) = (&choice.provider, &choice.model_id) else {
            continue;
        };
        let source = choice.source.as_deref().filter(|source| !source.is_empty());
        let available = match source {
            Some(source) => availability.pinned(provider, model_id, source),
            None => availability.automatic(provider, model_id),
        };
        if !available {
            continue;
        }
        let Some(label) = label(provider, model_id, platform_models) else {
            continue;
        };
        let selector = match source {
            Some(source) => format!("{provider}:{model_id}#{source}"),
            None => format!("{provider}:{model_id}"),
        };
        let mut row = Map::new();
        row.insert("selector".into(), json!(selector));
        row.insert("provider".into(), json!(provider));
        row.insert("modelId".into(), json!(model_id));
        row.insert("label".into(), json!(label));
        if let Some(name) = CATALOG.provider_names.get(provider.as_str()) {
            row.insert("providerName".into(), name.clone());
        }
        if let Some(source) = source {
            row.insert("source".into(), json!(source));
            if let Some(name) = CATALOG.source_names.get(source) {
                row.insert("sourceName".into(), name.clone());
            }
        }
        out.push(Value::Object(row));
    }
    if out.len() < 2 { Vec::new() } else { out }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::widget::gate::tests::seal;

    fn env(vars: &[&str]) -> PlatformEnv {
        PlatformEnv::from_lookup(|name| vars.contains(&name).then(|| "set".to_owned()))
    }

    fn assistant(allowed: Value) -> Value {
        json!({ "modelProvider": "google", "modelId": "gemini-3.5-flash", "allowedModels": allowed })
    }

    fn selectors(rows: &[Value]) -> Vec<&str> {
        rows.iter()
            .map(|row| row["selector"].as_str().unwrap())
            .collect()
    }

    #[test]
    fn no_allow_list_is_no_picker() {
        let keys = SealKeys::new(Some("k"), None);
        let choices = choices(&assistant(json!([])));
        assert_eq!(choices.len(), 1);
        let env = env(&["GOOGLE_GENERATIVE_AI_API_KEY"]);
        assert!(options(&choices, &[], &[], &env, &keys).is_empty());
    }

    #[test]
    fn offers_what_a_route_can_answer_configured_first() {
        let keys = SealKeys::new(Some("k"), None);
        let choices = choices(&assistant(json!([
            { "provider": "anthropic", "modelId": "claude-sonnet-5" },
            { "provider": "google", "modelId": "gemini-3.5-flash" },
            { "provider": "openai", "modelId": "gpt-5.1" },
            { "provider": "openai", "modelId": "gpt-5.1", "source": "api_key" },
        ])));
        assert_eq!(choices.len(), 4);
        let connections = [Connection {
            provider: "anthropic".into(),
            kind: "api_key".into(),
            encrypted_key: Some(seal("k", "sk", "")),
            config: json!({}),
        }];
        let env = env(&["GOOGLE_GENERATIVE_AI_API_KEY"]);
        let rows = options(&choices, &connections, &[], &env, &keys);
        assert_eq!(
            selectors(&rows),
            ["google:gemini-3.5-flash", "anthropic:claude-sonnet-5"]
        );
        assert_eq!(rows[1]["providerName"], "Anthropic");
        assert_eq!(rows[1]["label"], "Claude Sonnet 5");
    }

    #[test]
    fn the_gateway_serves_only_the_models_it_has() {
        let keys = SealKeys::new(Some("k"), None);
        let env = env(&["AI_GATEWAY_API_KEY"]);
        let choices = choices(&assistant(json!([
            { "provider": "openai", "modelId": "gpt-5.1" },
            { "provider": "openai", "modelId": "gpt-5.4-mini", "source": "platform_gateway" },
        ])));
        let rows = options(&choices, &[], &[], &env, &keys);
        assert_eq!(
            selectors(&rows),
            [
                "google:gemini-3.5-flash",
                "openai:gpt-5.4-mini#platform_gateway"
            ]
        );
        assert_eq!(rows[1]["sourceName"], "AI Gateway · platform");
    }

    #[test]
    fn a_pinned_key_must_open() {
        let keys = SealKeys::new(Some("k"), None);
        let env = env(&["GOOGLE_GENERATIVE_AI_API_KEY"]);
        let choices = choices(&assistant(json!([
            { "provider": "anthropic", "modelId": "claude-sonnet-5", "source": "api_key" },
        ])));
        let broken = [Connection {
            provider: "anthropic".into(),
            kind: "api_key".into(),
            encrypted_key: Some(seal("other", "sk", "")),
            config: json!({}),
        }];
        assert!(options(&choices, &broken, &[], &env, &keys).is_empty());
    }

    #[test]
    fn a_platform_model_supplies_its_own_label() {
        let keys = SealKeys::new(Some("k"), None);
        let env = env(&["GOOGLE_GENERATIVE_AI_API_KEY", "AI_GATEWAY_API_KEY"]);
        let choices = choices(&assistant(json!([
            { "provider": "google", "modelId": "gemini-9-pro" },
        ])));
        let models = [(
            "google".to_owned(),
            "gemini-9-pro".to_owned(),
            "Gemini 9 Pro".to_owned(),
        )];
        let rows = options(&choices, &[], &models, &env, &keys);
        assert_eq!(rows[1]["label"], "Gemini 9 Pro");
    }

    #[test]
    fn retired_ids_resolve_to_their_successor() {
        assert_eq!(
            current_model_id("anthropic", "claude-haiku-4-5"),
            "claude-sonnet-5"
        );
        assert_eq!(
            current_model_id("anthropic", "claude-sonnet-5"),
            "claude-sonnet-5"
        );
    }
}
