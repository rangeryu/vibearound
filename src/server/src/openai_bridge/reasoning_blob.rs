const REASONING_BLOB_PREFIX: &str = "vibearound.reasoning.hex.v1:";

pub(crate) fn encode_reasoning_content(content: &str) -> String {
    let mut out = String::with_capacity(REASONING_BLOB_PREFIX.len() + content.len() * 2);
    out.push_str(REASONING_BLOB_PREFIX);
    for byte in content.as_bytes() {
        out.push(hex_digit(byte >> 4));
        out.push(hex_digit(byte & 0x0f));
    }
    out
}

fn hex_digit(value: u8) -> char {
    match value {
        0..=9 => (b'0' + value) as char,
        10..=15 => (b'a' + value - 10) as char,
        _ => unreachable!("hex digit out of range"),
    }
}

#[cfg(test)]
mod tests {
    use super::encode_reasoning_content;

    #[test]
    fn reasoning_blob_encodes_utf8_content() {
        let encoded = encode_reasoning_content("I should call the tool.\n然后继续。");

        assert!(encoded.starts_with("vibearound.reasoning.hex.v1:"));
    }
}
