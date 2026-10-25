//! `extractPage` from `packages/agent/src/local-crawl.ts`: the built-in
//! crawler's per-page extraction, cheerio (parse5) there, scraper
//! (html5ever) here.

use std::sync::LazyLock;

use ego_tree::NodeRef;
use scraper::{ElementRef, Html, Node, Selector};
use serde_json::{Value, json};
use url::Url;

static REMOVED: LazyLock<Selector> = LazyLock::new(|| {
    Selector::parse(
        "script, style, noscript, svg, iframe, nav, footer, header, form, aside, \
         [role=\"navigation\"], [role=\"banner\"], [role=\"contentinfo\"], \
         [role=\"search\"], [aria-hidden=\"true\"]",
    )
    .unwrap()
});
static TITLE: LazyLock<Selector> = LazyLock::new(|| Selector::parse("title").unwrap());
static H1: LazyLock<Selector> = LazyLock::new(|| Selector::parse("h1").unwrap());
static MAIN: LazyLock<Selector> = LazyLock::new(|| Selector::parse("main").unwrap());
static BODY: LazyLock<Selector> = LazyLock::new(|| Selector::parse("body").unwrap());
static LINK: LazyLock<Selector> = LazyLock::new(|| Selector::parse("a[href]").unwrap());

const SKIP_EXTENSIONS: [&str; 30] = [
    "pdf", "zip", "rar", "7z", "png", "jpg", "jpeg", "gif", "svg", "webp", "ico", "css", "js",
    "mjs", "json", "xml", "rss", "mp3", "mp4", "wav", "avi", "mov", "webm", "woff", "woff2", "ttf",
    "eot", "doc", "docx", "xls",
];
const SKIP_EXTENSIONS_MORE: [&str; 3] = ["xlsx", "ppt", "pptx"];

/// `SKIP_EXTENSIONS.test(pathname)`: the extension after the last dot, in
/// any case, is one of the listed ones.
fn skipped_extension(path: &str) -> bool {
    path.rsplit_once('.').is_some_and(|(_, extension)| {
        let extension = extension.to_ascii_lowercase();
        SKIP_EXTENSIONS
            .iter()
            .chain(SKIP_EXTENSIONS_MORE.iter())
            .any(|known| *known == extension)
    })
}

/// `.replace(/[ \t]+/g, " ")`.
fn collapse_runs(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut in_run = false;
    for c in text.chars() {
        if c == ' ' || c == '\t' {
            if !in_run {
                out.push(' ');
            }
            in_run = true;
        } else {
            out.push(c);
            in_run = false;
        }
    }
    out
}

/// `.replace(/\s*\n\s*/g, "\n")`: every maximal run of JavaScript
/// whitespace that holds at least one newline becomes one newline.
fn collapse_newlines(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut run = String::new();
    let flush = |run: &mut String, out: &mut String| {
        if run.contains('\n') {
            out.push('\n');
        } else {
            out.push_str(run);
        }
        run.clear();
    };
    for c in text.chars() {
        if is_js_space(c) {
            run.push(c);
        } else {
            flush(&mut run, &mut out);
            out.push(c);
        }
    }
    flush(&mut run, &mut out);
    out
}

/// `.replace(/\n{3,}/g, "\n\n")`.
fn cap_blank_lines(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut newlines = 0;
    for c in text.chars() {
        if c == '\n' {
            newlines += 1;
            if newlines <= 2 {
                out.push(c);
            }
        } else {
            newlines = 0;
            out.push(c);
        }
    }
    out
}

fn is_js_space(c: char) -> bool {
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

fn js_trim(value: &str) -> &str {
    value.trim_matches(is_js_space)
}

/// What cheerio's `.remove()` took out: the element or one of its ancestors
/// matches the chrome selector.
fn removed(element: ElementRef) -> bool {
    std::iter::once(element)
        .chain(element.ancestors().filter_map(ElementRef::wrap))
        .any(|e| REMOVED.matches(&e))
}

/// `.text()`: every text node below, in order, skipping removed subtrees.
fn text_into(node: NodeRef<'_, Node>, out: &mut String) {
    match node.value() {
        Node::Text(text) => out.push_str(text),
        Node::Element(_) if ElementRef::wrap(node).is_some_and(|e| REMOVED.matches(&e)) => {
            return;
        }
        _ => {}
    }
    for child in node.children() {
        text_into(child, out);
    }
}

/// `$(selector).text()` over every surviving match, concatenated.
fn selection_text(document: &Html, selector: &Selector) -> String {
    let mut out = String::new();
    for element in document.select(selector).filter(|e| !removed(*e)) {
        text_into(*element, &mut out);
    }
    out
}

/// `$(selector).first().text()`.
fn first_text(document: &Html, selector: &Selector) -> String {
    let mut out = String::new();
    if let Some(element) = document.select(selector).find(|e| !removed(*e)) {
        text_into(*element, &mut out);
    }
    out
}

pub fn extract_page(html: &str, url: &str) -> Value {
    let document = Html::parse_document(html);

    let title = [first_text(&document, &TITLE), first_text(&document, &H1)]
        .iter()
        .map(|t| js_trim(t).to_owned())
        .find(|t| !t.is_empty())
        .unwrap_or_else(|| url.to_owned());

    let main = selection_text(&document, &MAIN);
    let raw = if js_trim(&main).is_empty() {
        selection_text(&document, &BODY)
    } else {
        main
    };
    let text = cap_blank_lines(&collapse_newlines(&collapse_runs(&raw)));
    let text = js_trim(&text).to_owned();

    let base = Url::parse(url).ok();
    let mut links = Vec::new();
    for anchor in document.select(&LINK).filter(|e| !removed(*e)) {
        let Some(href) = anchor.value().attr("href").filter(|h| !h.is_empty()) else {
            continue;
        };
        let Some(absolute) = base
            .as_ref()
            .and_then(|base| base.join(href).ok())
            .or_else(|| Url::parse(href).ok())
        else {
            continue;
        };
        if absolute.scheme() != "http" && absolute.scheme() != "https" {
            continue;
        }
        if skipped_extension(absolute.path()) {
            continue;
        }
        links.push(absolute.to_string());
    }

    json!({
        "page": if text.is_empty() { Value::Null } else { json!({ "url": url, "title": title, "text": text }) },
        "links": links,
    })
}
