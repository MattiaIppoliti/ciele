//! `packages/core/src/text.ts`, ported for the benchmark.

use std::collections::HashSet;
use std::sync::LazyLock;

use regex::Regex;
use unicode_normalization::UnicodeNormalization;

pub static STOPWORDS: LazyLock<HashSet<&'static str>> = LazyLock::new(|| {
    [
        "a", "an", "the", "is", "are", "am", "was", "were", "be", "been", "do", "does", "did", "can",
        "could", "will", "would", "should", "may", "might", "i", "me", "my", "you", "your", "we",
        "our", "it", "its", "this", "that", "to", "of", "in", "on", "for", "with", "about", "and",
        "or", "not", "no", "how", "what", "when", "where", "who", "which", "why", "there", "please",
        "user", "users", "asking", "asks", "ask", "wants", "want", "explicitly", "otherwise", "them",
        "they", "their", "il", "lo", "la", "gli", "le", "un", "uno", "una", "di", "da", "che",
        "chi", "come", "cosa", "quando", "dove", "perche", "per", "con", "su", "sono", "sei", "ho",
        "hai", "ha", "posso", "puoi", "vorrei", "voglio", "mi", "ti", "si", "e", "o", "non", "del",
        "della", "dei", "delle", "al", "alla", "ai", "alle", "quale", "quali", "questo", "questa",
        "fare",
    ]
    .into_iter()
    .collect()
});

static NOT_WORD: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"[^\p{L}\p{N}\s]").unwrap());
static SPACES: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\s+").unwrap());

fn js_whitespace(c: char) -> bool {
    matches!(c, '\t' | '\n' | '\u{b}' | '\u{c}' | '\r' | ' ' | '\u{a0}' | '\u{1680}' | '\u{2000}'..='\u{200a}'
        | '\u{2028}' | '\u{2029}' | '\u{202f}' | '\u{205f}' | '\u{3000}' | '\u{feff}')
}

/// Lowercase, strip accents, strip punctuation, collapse whitespace.
pub fn normalize(text: &str) -> String {
    let stripped: String = text
        .to_lowercase()
        .nfd()
        .filter(|c| !('\u{300}'..='\u{36f}').contains(c))
        .collect();
    let spaced = NOT_WORD.replace_all(&stripped, " ");
    let collapsed = SPACES.replace_all(&spaced, " ");
    collapsed.trim_matches(js_whitespace).to_owned()
}

/// `token.slice(0, 6)`: six UTF-16 code units.
pub fn stem(token: &str) -> &str {
    let mut units = 0;
    for (index, c) in token.char_indices() {
        units += c.len_utf16();
        if units > 6 {
            return &token[..index];
        }
    }
    token
}

pub fn tokenize(text: &str) -> Vec<String> {
    let normalized = normalize(text);
    if normalized.is_empty() {
        return Vec::new();
    }
    normalized
        .split(' ')
        .filter(|t| t.encode_utf16().count() > 1 && !STOPWORDS.contains(t))
        .map(str::to_owned)
        .collect()
}
