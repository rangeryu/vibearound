use std::collections::BTreeMap;

use anyhow::Result;
use reqwest::header::{HeaderMap, HeaderName, HeaderValue};

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
    if let Some(custom_headers) = custom_headers {
        for (name, value) in custom_headers {
            if let Some((header_name, header_value)) = parse_header(name, value)? {
                headers.append(header_name, header_value);
            }
        }
    }
    Ok(headers)
}

pub fn sanitize_custom_headers(
    custom_headers: &BTreeMap<String, String>,
    _catalog_headers: &BTreeMap<String, String>,
) -> Result<BTreeMap<String, String>> {
    let mut sanitized = BTreeMap::new();

    for (raw_name, raw_value) in custom_headers {
        let Some((_header_name, header_value)) = parse_header(raw_name, raw_value)? else {
            continue;
        };
        sanitized.insert(
            raw_name.trim().to_string(),
            header_value.to_str().unwrap_or_default().to_string(),
        );
    }

    Ok(sanitized)
}

fn parse_header(raw_name: &str, raw_value: &str) -> Result<Option<(HeaderName, HeaderValue)>> {
    let name = raw_name.trim();
    if name.is_empty() {
        return Ok(None);
    }

    let header_name = HeaderName::from_bytes(name.as_bytes()).map_err(|_| {
        anyhow::anyhow!("custom upstream header '{name}' is not a valid HTTP header name")
    })?;
    let header_value = HeaderValue::from_str(raw_value)
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
    fn appends_custom_headers_that_match_catalog_headers() {
        let catalog = [("User-Agent".to_string(), "catalog".to_string())]
            .into_iter()
            .collect();
        let custom = [("user-agent".to_string(), "profile".to_string())]
            .into_iter()
            .collect();

        let headers = merged_upstream_headers(&catalog, Some(&custom)).unwrap();
        let values = headers
            .get_all("user-agent")
            .iter()
            .filter_map(|value| value.to_str().ok())
            .collect::<Vec<_>>();

        assert_eq!(values, vec!["catalog", "profile"]);
    }

    #[test]
    fn preserves_headers_that_are_normally_managed_by_bridge() {
        let catalog = BTreeMap::new();
        let custom = [("Authorization".to_string(), "Bearer token".to_string())]
            .into_iter()
            .collect();

        let headers = sanitize_custom_headers(&custom, &catalog).unwrap();

        assert_eq!(
            headers.get("Authorization").map(String::as_str),
            Some("Bearer token")
        );
    }

    #[test]
    fn appends_duplicate_custom_headers_case_insensitively() {
        let catalog = BTreeMap::new();
        let custom = [
            ("X-Test".to_string(), "one".to_string()),
            ("x-test".to_string(), "two".to_string()),
        ]
        .into_iter()
        .collect();

        let headers = merged_upstream_headers(&catalog, Some(&custom)).unwrap();
        let values = headers
            .get_all("x-test")
            .iter()
            .filter_map(|value| value.to_str().ok())
            .collect::<Vec<_>>();

        assert_eq!(values, vec!["one", "two"]);
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
