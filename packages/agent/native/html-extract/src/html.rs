//! `htmlToText` from `packages/agent/src/extract.ts`: cheerio (parse5) there,
//! scraper (html5ever) here, both spec HTML5 parsers.

use scraper::{ElementRef, Html, Node, Selector};

const DROPPED: [&str; 5] = ["script", "style", "noscript", "template", "iframe"];

fn js_whitespace(c: char) -> bool {
    matches!(
        c,
        '\t' | '\n' | '\u{b}' | '\u{c}' | '\r' | ' ' | '\u{a0}' | '\u{1680}' | '\u{2000}'
            ..='\u{200a}'
                | '\u{2028}'
                | '\u{2029}'
                | '\u{202f}'
                | '\u{205f}'
                | '\u{3000}'
                | '\u{feff}'
    )
}

/// `.replace(/\s+/g, " ").trim()`.
fn collapse(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut space = false;
    for c in text.chars() {
        if js_whitespace(c) {
            space = true;
        } else {
            if space && !out.is_empty() {
                out.push(' ');
            }
            space = false;
            out.push(c);
        }
    }
    out
}

fn collect(node: ego_tree::NodeRef<'_, Node>, parts: &mut Vec<String>) {
    match node.value() {
        Node::Text(text) => {
            if !text.is_empty() {
                parts.push(text.to_string());
            }
        }
        Node::Element(element) if DROPPED.contains(&element.name()) => return,
        _ => {}
    }
    for child in node.children() {
        collect(child, parts);
    }
}

pub fn html_to_text(html: &str) -> (String, String) {
    let document = Html::parse_document(html);
    let title_selector = Selector::parse("title").unwrap();
    let title = document
        .select(&title_selector)
        .next()
        .map(|t| collapse(&t.text().collect::<String>()))
        .unwrap_or_default();
    let body_selector = Selector::parse("body").unwrap();
    let mut parts = Vec::new();
    let bodies: Vec<ElementRef> = document.select(&body_selector).collect();
    if bodies.is_empty() {
        collect(document.tree.root(), &mut parts);
    } else {
        for body in bodies {
            collect(*body, &mut parts);
        }
    }
    (title, collapse(&parts.join(" ")))
}
