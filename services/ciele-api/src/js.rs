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

/// `Number(raw)` for a string. Covers what `Number` accepts that a float
/// parser does not (`0x`/`0o`/`0b`, surrounding whitespace, a blank string
/// meaning 0) and refuses what a float parser accepts that `Number` does not
/// (`inf`, `nan`, a sign before a radix prefix). NaN where `Number` says NaN.
pub fn js_number(raw: &str) -> f64 {
    let text = js_trim(raw);
    if text.is_empty() {
        return 0.0;
    }
    for (prefix, radix) in [("0x", 16), ("0o", 8), ("0b", 2)] {
        if text
            .get(..2)
            .is_some_and(|head| head.eq_ignore_ascii_case(prefix))
        {
            let digits = &text[2..];
            if digits.is_empty() {
                return f64::NAN;
            }
            // Accumulated as a float, as JavaScript does past 2^53.
            return digits
                .chars()
                .try_fold(0.0, |value, c| {
                    c.to_digit(radix)
                        .map(|digit| value * f64::from(radix) + f64::from(digit))
                })
                .unwrap_or(f64::NAN);
        }
    }
    let unsigned = text.strip_prefix(['+', '-']).unwrap_or(text);
    let decimal = unsigned.starts_with(|c: char| c.is_ascii_digit() || c == '.')
        && unsigned
            .chars()
            .all(|c| c.is_ascii_digit() || matches!(c, '.' | 'e' | 'E' | '+' | '-'));
    if !decimal && unsigned != "Infinity" {
        return f64::NAN;
    }
    text.parse::<f64>().unwrap_or(f64::NAN)
}

/// [`js_number`] kept only when it is a safe integer, what a numeric cursor
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

    /// Each expectation is what `Number(raw)` answers in Node.
    #[test]
    fn reads_a_number_as_javascript_number_does() {
        for (raw, expected) in [
            ("", 0.0),
            ("  7 ", 7.0),
            ("1e2", 100.0),
            (".5", 0.5),
            ("5.", 5.0),
            ("+3", 3.0),
            ("-0x10", f64::NAN),
            ("0x10", 16.0),
            ("0B11", 3.0),
            ("0o", f64::NAN),
            ("0x+1", f64::NAN),
            ("1_000", f64::NAN),
            ("Infinity", f64::INFINITY),
            ("-Infinity", f64::NEG_INFINITY),
            ("infinity", f64::NAN),
            ("inf", f64::NAN),
            ("nan", f64::NAN),
            ("abc", f64::NAN),
            ("1e400", f64::INFINITY),
            ("0xffffffffffffffffff", 4.722366482869645e21),
        ] {
            let got = js_number(raw);
            assert!(
                got == expected || (got.is_nan() && expected.is_nan()),
                "Number({raw:?}) is {expected}, got {got}"
            );
        }
        assert_eq!(js_number_to_safe_integer(""), Some(0));
        assert_eq!(js_number_to_safe_integer("1.5"), None);
        assert_eq!(js_number_to_safe_integer("Infinity"), None);
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
