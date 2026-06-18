pub(super) fn redact(value: &str, keys: &[String]) -> String {
    let mut out = value.to_string();
    for key in keys {
        let key = key.trim();
        if key.is_empty() {
            continue;
        }
        out = redact_key_values(&out, key);
    }
    out
}

fn redact_key_values(value: &str, key: &str) -> String {
    let lower = value.to_ascii_lowercase();
    let key_lower = key.to_ascii_lowercase();
    let bytes = value.as_bytes();
    let mut out = String::new();
    let mut index = 0;

    while let Some(relative) = lower[index..].find(&key_lower) {
        let start = index + relative;
        let key_end = start + key.len();
        if !has_key_boundaries(bytes, start, key_end) {
            out.push_str(&value[index..key_end]);
            index = key_end;
            continue;
        }

        let Some((value_start, value_end)) = redaction_value_span(value, key_end) else {
            out.push_str(&value[index..key_end]);
            index = key_end;
            continue;
        };
        out.push_str(&value[index..value_start]);
        out.push_str("***");
        index = value_end;
    }

    out.push_str(&value[index..]);
    out
}

fn has_key_boundaries(bytes: &[u8], start: usize, end: usize) -> bool {
    let before_ok = start == 0 || !is_key_char(bytes[start - 1]);
    let after_ok = end >= bytes.len() || !is_key_char(bytes[end]);
    before_ok && after_ok
}

fn is_key_char(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || byte == b'_'
}

fn redaction_value_span(value: &str, key_end: usize) -> Option<(usize, usize)> {
    let bytes = value.as_bytes();
    let mut cursor = key_end;

    if matches!(bytes.get(cursor), Some(b'"' | b'\'')) {
        cursor += 1;
    }

    let whitespace_start = cursor;
    while bytes.get(cursor).is_some_and(u8::is_ascii_whitespace) {
        cursor += 1;
    }
    let saw_whitespace = cursor > whitespace_start;

    if matches!(bytes.get(cursor), Some(b'=' | b':')) {
        cursor += 1;
        while bytes.get(cursor).is_some_and(u8::is_ascii_whitespace) {
            cursor += 1;
        }
    } else if !saw_whitespace {
        return None;
    }

    let quote = match bytes.get(cursor) {
        Some(b'"') => Some(b'"'),
        Some(b'\'') => Some(b'\''),
        _ => None,
    };
    if let Some(quote) = quote {
        let value_start = cursor + 1;
        let value_end = bytes[value_start..]
            .iter()
            .position(|byte| *byte == quote)
            .map(|offset| value_start + offset)
            .unwrap_or(bytes.len());
        return (value_start < value_end).then_some((value_start, value_end));
    }

    let value_start = cursor;
    let mut value_end = cursor;
    while let Some(byte) = bytes.get(value_end) {
        if byte.is_ascii_whitespace() || matches!(byte, b',' | b';' | b'&') {
            break;
        }
        value_end += 1;
    }
    (value_start < value_end).then_some((value_start, value_end))
}

#[cfg(test)]
mod tests {
    use super::redact;

    #[test]
    fn masks_secret_values_without_removing_keys() {
        let keys = vec!["token".to_string(), "api_key".to_string()];
        let redacted = redact(
            r#"token=abc123 api_key: "sk-test" {"token":"cloudflare-secret"} --token cli-secret tokenizer=kept"#,
            &keys,
        );

        assert!(redacted.contains("token=***"));
        assert!(redacted.contains("api_key: \"***\""));
        assert!(redacted.contains(r#""token":"***""#));
        assert!(redacted.contains("--token ***"));
        assert!(redacted.contains("tokenizer=kept"));
        assert!(!redacted.contains("abc123"));
        assert!(!redacted.contains("sk-test"));
        assert!(!redacted.contains("cloudflare-secret"));
        assert!(!redacted.contains("cli-secret"));
    }
}
