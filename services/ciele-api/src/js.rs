//! JavaScript's string semantics, where zod's answer depends on them.

/// zod's `.max()` counts UTF-16 code units, not characters.
pub fn js_length(value: &str) -> usize {
    value.encode_utf16().count()
}

/// `String.prototype.trim`. JavaScript's whitespace is Unicode `Zs` plus the
/// line terminators, tabs and the BOM; Rust's `is_whitespace` also takes NEL
/// (U+0085), which JavaScript keeps.
pub fn js_trim(value: &str) -> &str {
    value.trim_matches(is_js_whitespace)
}

fn is_js_whitespace(c: char) -> bool {
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

/// `Number(raw)`: `NaN` where JavaScript answers `NaN`. Covers what `Number`
/// accepts that a float parser does not (`0x`/`0o`/`0b`, surrounding
/// whitespace, a blank string meaning 0) and refuses what a float parser
/// accepts that `Number` does not (`inf`, `nan`).
pub fn js_number(raw: &str) -> f64 {
    let text = js_trim(raw);
    if text.is_empty() {
        return 0.0;
    }
    let radix = |prefix: &str, radix: u32| {
        text.strip_prefix(prefix)
            .or_else(|| text.strip_prefix(&prefix.to_uppercase()))
            .map(|digits| u64::from_str_radix(digits, radix).map_or(f64::NAN, |n| n as f64))
    };
    if let Some(parsed) = radix("0x", 16)
        .or_else(|| radix("0o", 8))
        .or_else(|| radix("0b", 2))
    {
        return parsed;
    }
    let bare = text.trim_start_matches(['+', '-']);
    let numeric = bare.starts_with(|c: char| c.is_ascii_digit() || c == '.');
    if !numeric && bare != "Infinity" {
        return f64::NAN;
    }
    text.parse::<f64>().unwrap_or(f64::NAN)
}

/// `Number(raw)` kept only when it is a safe integer, what a numeric cursor
/// goes through on the TypeScript side.
pub fn js_number_to_safe_integer(raw: &str) -> Option<i64> {
    const MAX_SAFE: f64 = 9_007_199_254_740_991.0;
    let value = js_number(raw);
    (value.is_finite() && value.fract() == 0.0 && value.abs() <= MAX_SAFE).then_some(value as i64)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn trims_what_javascript_trims_and_keeps_nel() {
        assert_eq!(js_trim("\u{feff}\u{3000} a \u{2028}\t"), "a");
        assert_eq!(js_trim("\u{85}a\u{85}"), "\u{85}a\u{85}");
    }

    #[test]
    fn counts_utf16_code_units() {
        assert_eq!(js_length("😀"), 2);
        assert_eq!(js_length("é"), 1);
    }

    #[test]
    fn reads_numbers_the_way_number_does() {
        assert_eq!(js_number(" 2.7 "), 2.7);
        assert_eq!(js_number(""), 0.0);
        assert_eq!(js_number("0x10"), 16.0);
        assert!(js_number("abc").is_nan());
        assert!(js_number("inf").is_nan());
        assert!(js_number("-0x10").is_nan());
        assert_eq!(js_number("-Infinity"), f64::NEG_INFINITY);
    }
}
