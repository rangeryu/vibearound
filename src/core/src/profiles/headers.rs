use std::collections::{BTreeMap, BTreeSet};

use anyhow::{bail, Result};
use reqwest::header::{HeaderMap, HeaderName, HeaderValue};

const RESERVED_CUSTOM_HEADER_NAMES: &[&str] = &[
    "authorization",
    "connection",
    "content-length",
    "content-type",
    "host",
    "keep-alive",
    "proxy-authorization",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade",
    "x-api-key",
    "anthropic-version",
];

pub fn merged_upstream_headers(
    catalog_headers: &BTreeMap<String, String>,
    custom_headers: Option<&BTreeMap<String, String>>,
) -> Result<HeaderMap> {
    let mut headers = HeaderMap::new();
    for (name, value) in catalog_headers {
        if let Some((header_name, header_value)) = parse_header(name, value)? {
            headers.insert(header_name, header_value);
        }
    }
    let custom_headers = match custom_headers {
        Some(custom_headers) => sanitize_custom_headers(custom_headers, catalog_headers)?,
        None => BTreeMap::new(),
    };
    for (name, value) in custom_headers {
        if let Some((header_name, header_value)) = parse_header(&name, &value)? {
            headers.insert(header_name, header_value);
        }
    }
    Ok(headers)
}

pub fn sanitize_custom_headers(
    custom_headers: &BTreeMap<String, String>,
    catalog_headers: &BTreeMap<String, String>,
) -> Result<BTreeMap<String, String>> {
    let catalog_names = header_name_set(catalog_headers)?;
    let mut custom_names = BTreeSet::new();
    let mut sanitized = BTreeMap::new();

    for (raw_name, raw_value) in custom_headers {
        let Some((header_name, header_value)) = parse_header(raw_name, raw_value)? else {
            continue;
        };
        let canonical_name = header_name.as_str().to_string();
        if catalog_names.contains(&canonical_name) {
            bail!(
                "custom upstream header '{}' is already provided by the provider catalog",
                raw_name
            );
        }
        if !custom_names.insert(canonical_name) {
            bail!("custom upstream header '{}' is duplicated", raw_name);
        }
        sanitized.insert(
            raw_name.trim().to_string(),
            header_value.to_str().unwrap_or_default().to_string(),
        );
    }

    Ok(sanitized)
}

fn header_name_set(headers: &BTreeMap<String, String>) -> Result<BTreeSet<String>> {
    let mut names = BTreeSet::new();
    for (name, value) in headers {
        if let Some((header_name, _)) = parse_header(name, value)? {
            names.insert(header_name.as_str().to_string());
        }
    }
    Ok(names)
}

fn parse_header(raw_name: &str, raw_value: &str) -> Result<Option<(HeaderName, HeaderValue)>> {
    let name = raw_name.trim();
    let value = raw_value.trim();
    if name.is_empty() && value.is_empty() {
        return Ok(None);
    }
    if name.is_empty() {
        bail!("custom upstream header name must not be empty");
    }
    if value.is_empty() {
        bail!("custom upstream header '{name}' value must not be empty");
    }

    let header_name = HeaderName::from_bytes(name.as_bytes()).map_err(|_| {
        anyhow::anyhow!("custom upstream header '{name}' is not a valid HTTP header name")
    })?;
    if RESERVED_CUSTOM_HEADER_NAMES.contains(&header_name.as_str()) {
        bail!("custom upstream header '{name}' is managed by the proxy");
    }
    let header_value = HeaderValue::from_str(value)
        .map_err(|_| anyhow::anyhow!("custom upstream header '{name}' has an invalid value"))?;
    Ok(Some((header_name, header_value)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn profile_headers_append_catalog_headers() {
        let catalog = [("User-Agent".to_string(), "catalog".to_string())]
            .into_iter()
            .collect();
        let custom = [("X-Title".to_string(), "VibeAround".to_string())]
            .into_iter()
            .collect();

        let headers = merged_upstream_headers(&catalog, Some(&custom)).unwrap();

        assert_eq!(
            headers
                .get("user-agent")
                .and_then(|value| value.to_str().ok()),
            Some("catalog")
        );
        assert_eq!(
            headers.get("x-title").and_then(|value| value.to_str().ok()),
            Some("VibeAround")
        );
        assert_eq!(headers.len(), 2);
    }

    #[test]
    fn rejects_custom_headers_that_match_catalog_headers() {
        let catalog = [("User-Agent".to_string(), "catalog".to_string())]
            .into_iter()
            .collect();
        let custom = [("user-agent".to_string(), "profile".to_string())]
            .into_iter()
            .collect();

        let err = sanitize_custom_headers(&custom, &catalog).unwrap_err();

        assert!(err.to_string().contains("already provided"));
    }

    #[test]
    fn rejects_headers_managed_by_proxy() {
        let catalog = BTreeMap::new();
        let custom = [("Authorization".to_string(), "Bearer token".to_string())]
            .into_iter()
            .collect();

        let err = sanitize_custom_headers(&custom, &catalog).unwrap_err();

        assert!(err.to_string().contains("managed by the proxy"));
    }

    #[test]
    fn rejects_duplicate_custom_headers_case_insensitively() {
        let catalog = BTreeMap::new();
        let custom = [
            ("X-Test".to_string(), "one".to_string()),
            ("x-test".to_string(), "two".to_string()),
        ]
        .into_iter()
        .collect();

        let err = sanitize_custom_headers(&custom, &catalog).unwrap_err();

        assert!(err.to_string().contains("duplicated"));
    }

    #[test]
    fn rejects_invalid_header_values() {
        let catalog = BTreeMap::new();
        let custom = [("X-Test".to_string(), "bad\nvalue".to_string())]
            .into_iter()
            .collect();

        let err = sanitize_custom_headers(&custom, &catalog).unwrap_err();

        assert!(err.to_string().contains("invalid value"));
    }
}
