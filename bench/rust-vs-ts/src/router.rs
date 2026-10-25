//! `matchFlow` from `packages/core/src/engine.ts`, for message Flows with
//! `conversation_context` conditions and no routing context (so URL and
//! Schedule conditions, which would need one, never disqualify).

use std::collections::HashSet;

use serde::Deserialize;

use crate::text::{normalize, stem, tokenize};

#[derive(Deserialize)]
pub struct Example {
    pub message: String,
    #[serde(rename = "shouldTrigger")]
    pub should_trigger: bool,
}

#[derive(Deserialize)]
pub struct Condition {
    pub kind: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub examples: Vec<Example>,
}

#[derive(Deserialize)]
pub struct Flow {
    pub id: String,
    pub name: String,
    pub description: String,
    pub enabled: bool,
    #[serde(rename = "isDefault")]
    pub is_default: bool,
    pub trigger: Option<String>,
    pub position: i64,
    #[serde(rename = "conditionLogic")]
    pub condition_logic: Option<String>,
    #[serde(default)]
    pub conditions: Vec<Condition>,
}

const MATCH_THRESHOLD: i64 = 3;

fn stems(text: &str) -> HashSet<String> {
    tokenize(text).iter().map(|t| stem(t).to_owned()).collect()
}

fn built_in(name: &str) -> Option<(&'static [&'static str], &'static [&'static str])> {
    match name {
        "assistant information" => Some((
            &["who are you", "what can you do", "what do you do", "what are you", "your capabilities",
              "what services", "how do you work", "chi sei", "cosa puoi fare", "cosa sai fare",
              "come funzioni", "a cosa servi"],
            &["capabilities", "purpose", "yourself", "servi"],
        )),
        "human help needed" => Some((
            &["talk to a human", "speak to a human", "talk to someone", "speak with someone", "real person",
              "human help", "contact support", "customer support", "help desk", "parlare con un umano",
              "parlare con una persona", "un operatore", "assistenza umana", "contattare il supporto"],
            &["human", "operator", "person", "support", "umano", "operatore", "persona", "supporto"],
        )),
        _ => None,
    }
}

/// `None` is `Number.NEGATIVE_INFINITY`.
fn score_flow(message: &str, message_stems: &HashSet<String>, flow: &Flow) -> Option<i64> {
    let mut score = 0;
    for s in stems(&flow.name) {
        if message_stems.contains(&s) { score += 3; }
    }
    for s in stems(&flow.description) {
        if message_stems.contains(&s) { score += 1; }
    }
    let mut condition_scores: Vec<Option<i64>> = Vec::new();
    for condition in &flow.conditions {
        if condition.kind != "conversation_context" { continue; }
        let mut condition_score = Some(0);
        for s in stems(&condition.description) {
            if message_stems.contains(&s) { condition_score = condition_score.map(|v| v + 1); }
        }
        for example in &condition.examples {
            let phrase = normalize(&example.message);
            if phrase.is_empty() || !message.contains(&phrase) { continue; }
            if !example.should_trigger { condition_score = None; break; }
            condition_score = condition_score.map(|v| v + 6);
        }
        condition_scores.push(condition_score);
    }
    if !condition_scores.is_empty() {
        let matches = condition_scores.iter().map(|s| s.is_some_and(|v| v > 0));
        let pass = if flow.condition_logic.as_deref().unwrap_or("any") == "all" {
            matches.clone().all(|m| m)
        } else {
            matches.clone().any(|m| m)
        };
        if !pass { return None; }
        score += condition_scores.iter().flatten().sum::<i64>();
    }
    if let Some((phrases, tokens)) = built_in(&normalize(&flow.name)) {
        for phrase in phrases {
            if message.contains(phrase) { score += 6; }
        }
        let trigger_stems: HashSet<&str> = tokens.iter().map(|t| stem(t)).collect();
        for s in trigger_stems {
            if message_stems.contains(s) { score += 2; }
        }
    }
    Some(score)
}

pub fn match_flow<'a>(message: &str, flows: &'a [Flow]) -> Option<&'a Flow> {
    let normalized = normalize(message);
    let message_stems = stems(message);
    let mut candidates: Vec<&Flow> = flows
        .iter()
        .filter(|f| f.enabled && !f.is_default && f.trigger.as_deref().unwrap_or("message") == "message")
        .collect();
    candidates.sort_by_key(|f| f.position);
    for flow in candidates {
        if score_flow(&normalized, &message_stems, flow).is_some_and(|s| s >= MATCH_THRESHOLD) {
            return Some(flow);
        }
    }
    flows.iter().find(|f| f.is_default && f.enabled)
}
