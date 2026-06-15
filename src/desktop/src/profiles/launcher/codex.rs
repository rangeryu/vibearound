//! Codex-specific launch argument helpers.

pub(super) fn push_config_arg(args: &mut Vec<String>, key: &str, value: &str) {
    args.push("-c".to_string());
    args.push(format!("{key}={value}"));
}

/// Wraps a value as a TOML literal string (`'...'`) when possible. Literal
/// strings avoid `"` characters in Codex `-c` arguments, which matters for
/// Windows PowerShell native-command argument passing.
pub(super) fn toml_string(s: &str) -> String {
    if !s.contains('\'') {
        return format!("'{s}'");
    }

    let mut out = String::with_capacity(s.len() + 2);
    out.push('"');
    for ch in s.chars() {
        match ch {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            other => out.push(other),
        }
    }
    out.push('"');
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn appends_config_args() {
        let mut args = Vec::new();
        push_config_arg(
            &mut args,
            "model_providers.deepseek.base_url",
            &toml_string(
                "http://127.0.0.1:12358/va/local-api/deepseek/codex-openai-chat/openai-chat/v1",
            ),
        );
        push_config_arg(
            &mut args,
            "model_providers.deepseek.wire_api",
            &toml_string("responses"),
        );

        assert_eq!(
            args,
            vec![
                "-c".to_string(),
                "model_providers.deepseek.base_url='http://127.0.0.1:12358/va/local-api/deepseek/codex-openai-chat/openai-chat/v1'".to_string(),
                "-c".to_string(),
                "model_providers.deepseek.wire_api='responses'".to_string(),
            ]
        );
    }

    #[test]
    fn toml_string_falls_back_when_literal_cannot_represent_value() {
        assert_eq!(toml_string("plain"), "'plain'");
        assert_eq!(toml_string("team's"), "\"team's\"");
    }
}
