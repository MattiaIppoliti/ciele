//! `rust-vs-ts <component> <corpus.json> <outputs.json> [iterations]`: runs
//! the component over the corpus, writes every output for the parity check,
//! then times `iterations` full passes and prints the result as JSON.

mod html;
mod router;
mod text;

use std::time::Instant;

use serde::Deserialize;
use serde_json::{Value, json};

#[derive(Deserialize)]
struct Corpus {
    #[serde(default)]
    flows: Vec<router::Flow>,
    messages: Vec<String>,
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let component = args[1].as_str();
    let corpus: Corpus = serde_json::from_str(&std::fs::read_to_string(&args[2]).unwrap()).unwrap();
    let iterations: usize = args.get(4).and_then(|v| v.parse().ok()).unwrap_or(20);
    let run = |messages: &[String]| -> Vec<Value> {
        match component {
            "tokenize" => messages.iter().map(|m| json!(text::tokenize(m))).collect(),
            "router" => messages
                .iter()
                .map(|m| json!(router::match_flow(m, &corpus.flows).map(|f| f.id.as_str())))
                .collect(),
            "html" => messages
                .iter()
                .map(|m| {
                    let (title, text) = html::html_to_text(m);
                    json!({ "title": title, "text": text })
                })
                .collect(),
            other => panic!("unknown component {other}"),
        }
    };
    std::fs::write(&args[3], serde_json::to_string(&run(&corpus.messages)).unwrap()).unwrap();
    let mut samples = Vec::with_capacity(iterations);
    for _ in 0..iterations {
        let started = Instant::now();
        std::hint::black_box(run(&corpus.messages));
        samples.push(started.elapsed().as_secs_f64() * 1000.0);
    }
    samples.sort_by(f64::total_cmp);
    let per_item_us = samples[samples.len() / 2] * 1000.0 / corpus.messages.len() as f64;
    println!(
        "{}",
        json!({ "side": "rust", "component": component, "items": corpus.messages.len(),
                "passMedianMs": samples[samples.len() / 2], "perItemUs": per_item_us })
    );
}
