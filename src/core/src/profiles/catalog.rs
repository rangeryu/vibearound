//! Provider catalog — third-party endpoint metadata baked into the binary.
//!
//! Built-in providers have JSON under `src/resources/profile-catalog/`.
//! `profile-catalog/manifest.json` controls which provider files are loaded
//! and in what order.
//!
//! The catalog is still embedded in the desktop binary, but the Rust side no
//! longer hard-codes provider ids. The JSON manifest is the source of truth for
//! built-in profile catalog membership; adding fields requires only a serde
//! `#[serde(default)]` to stay forward-compatible.

use std::collections::BTreeMap;
use std::collections::BTreeSet;
use std::sync::LazyLock;

use include_dir::{include_dir, Dir};
use serde::{Deserialize, Serialize};

// ---------------------------------------------------------------------------
// Embedded JSON sources
// ---------------------------------------------------------------------------
static PROFILE_CATALOG_DIR: Dir<'_> =
    include_dir!("$CARGO_MANIFEST_DIR/../resources/profile-catalog");
static PROFILE_CATALOG_MANIFEST_JSON: &str =
    include_str!("../../../resources/profile-catalog/manifest.json");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ProviderCatalog {
    pub id: String,
    pub label: String,
    #[serde(default)]
    pub icon: Option<String>,
    #[serde(default)]
    pub homepage: Option<String>,
    /// Hide legacy/alias providers from the "new profile" picker while
    /// keeping them loadable for existing saved profiles.
    #[serde(default, skip_serializing_if = "is_false")]
    pub hidden_from_picker: bool,
    pub endpoints: Vec<EndpointDef>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct EndpointDef {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    pub api_type: String,
    pub default_base_url: String,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub headers: BTreeMap<String, String>,
    #[serde(default, skip_serializing_if = "is_false")]
    pub auth_header: bool,
    #[serde(default)]
    pub models: Vec<ModelDef>,
    #[serde(default)]
    pub capabilities: EndpointCapabilities,
    pub auth_modes: Vec<AuthModeDef>,
    /// Optional caveat shown to users next to the launch button — e.g.
    /// "codex 0.X+ requires Responses API and this provider only serves
    /// chat-completions". `None` for endpoints with no known caveat.
    #[serde(default)]
    pub compatibility_warning: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
pub struct EndpointCapabilities {
    #[serde(default)]
    pub reasoning_effort: bool,
    #[serde(default, skip_serializing_if = "ContentCapabilities::is_empty")]
    pub content: ContentCapabilities,
}

fn is_false(value: &bool) -> bool {
    !*value
}

#[derive(Debug, Clone, Default, Deserialize, Serialize, PartialEq, Eq)]
pub struct ContentCapabilities {
    #[serde(default, skip_serializing_if = "is_false")]
    pub image_input: bool,
    #[serde(default, skip_serializing_if = "is_false")]
    pub file_input: bool,
}

impl ContentCapabilities {
    pub fn is_empty(&self) -> bool {
        !self.image_input && !self.file_input
    }

    pub fn merge(&self, override_caps: &ContentCapabilities) -> ContentCapabilities {
        ContentCapabilities {
            image_input: self.image_input || override_caps.image_input,
            file_input: self.file_input || override_caps.file_input,
        }
    }
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ModelDef {
    pub id: String,
    #[serde(default)]
    pub label: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub context_window: Option<u64>,
    #[serde(default, skip_serializing_if = "ContentCapabilities::is_empty")]
    pub capabilities: ContentCapabilities,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct AuthModeDef {
    pub mode: String,
    #[serde(default)]
    pub label: Option<String>,
    #[serde(default)]
    pub fields: Vec<FieldDef>,
    #[serde(default)]
    pub render: Option<RenderRules>,
    /// Reserved for v2 OAuth flow — not consumed by v1 launcher.
    #[serde(default)]
    pub login_command: Option<Vec<String>>,
    #[serde(default)]
    pub session_file_check: Option<Vec<String>>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct FieldDef {
    pub name: String,
    pub label: String,
    #[serde(default)]
    pub secret: bool,
    #[serde(default)]
    pub required: bool,
    #[serde(default)]
    pub placeholder: Option<String>,
    #[serde(default)]
    pub validate: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct RenderRules {
    #[serde(default)]
    pub env: std::collections::BTreeMap<String, String>,
    /// Files to materialize alongside the env exports for CLIs that support
    /// an explicit config path. Codex profile launches intentionally avoid
    /// CODEX_HOME and translate these settings into `-c` CLI overrides so the
    /// user's own Codex home, skills, and plugins remain active.
    #[serde(default)]
    pub settings_files: Vec<SettingsFileTemplate>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct SettingsFileTemplate {
    pub rel_path: String,
    pub template: String,
}

#[derive(Debug, Deserialize)]
struct ProfileCatalogManifest {
    providers: Vec<ProfileCatalogManifestEntry>,
}

#[derive(Debug, Deserialize)]
struct ProfileCatalogManifestEntry {
    id: String,
    file: String,
}

// ---------------------------------------------------------------------------
// Static loader
// ---------------------------------------------------------------------------

static CATALOG: LazyLock<Vec<ProviderCatalog>> = LazyLock::new(load_builtin_catalogs);

fn load_builtin_catalogs() -> Vec<ProviderCatalog> {
    let manifest = serde_json::from_str::<ProfileCatalogManifest>(PROFILE_CATALOG_MANIFEST_JSON)
        .unwrap_or_else(|e| panic!("profile-catalog: failed to parse manifest.json: {e}"));
    let mut seen = BTreeSet::new();
    let mut catalogs = Vec::with_capacity(manifest.providers.len());

    for entry in manifest.providers {
        validate_manifest_entry(&entry);
        if !seen.insert(entry.id.clone()) {
            panic!("profile-catalog: duplicate provider id '{}'", entry.id);
        }
        let file = PROFILE_CATALOG_DIR
            .get_file(entry.file.as_str())
            .unwrap_or_else(|| {
                panic!(
                    "profile-catalog: manifest entry '{}' references missing file '{}'",
                    entry.id, entry.file
                )
            });
        let body = file.contents_utf8().unwrap_or_else(|| {
            panic!(
                "profile-catalog: manifest entry '{}' file '{}' is not valid UTF-8",
                entry.id, entry.file
            )
        });
        let catalog = serde_json::from_str::<ProviderCatalog>(body).unwrap_or_else(|e| {
            panic!(
                "profile-catalog: failed to parse {} for provider '{}': {}",
                entry.file, entry.id, e
            )
        });
        if catalog.id != entry.id {
            panic!(
                "profile-catalog: manifest id '{}' does not match file '{}' id '{}'",
                entry.id, entry.file, catalog.id
            );
        }
        catalogs.push(catalog);
    }

    catalogs
}

fn validate_manifest_entry(entry: &ProfileCatalogManifestEntry) {
    if entry.id.trim().is_empty() {
        panic!("profile-catalog: manifest contains an empty provider id");
    }
    if entry.file.trim().is_empty()
        || entry.file.contains('/')
        || entry.file.contains('\\')
        || entry.file.contains("..")
        || !entry.file.ends_with(".json")
    {
        panic!(
            "profile-catalog: manifest entry '{}' has invalid file '{}'",
            entry.id, entry.file
        );
    }
}

pub fn all() -> &'static [ProviderCatalog] {
    &CATALOG
}

pub fn get(id: &str) -> Option<&'static ProviderCatalog> {
    if id == "custom" {
        return Some(custom());
    }
    CATALOG.iter().find(|c| c.id == id)
}

pub fn endpoint_id(endpoint: &EndpointDef) -> &str {
    endpoint.id.as_deref().unwrap_or(endpoint.api_type.as_str())
}

pub fn find_endpoint<'a>(
    provider: &'a ProviderCatalog,
    api_type: &str,
    selected_endpoint_id: Option<&str>,
) -> Option<&'a EndpointDef> {
    provider
        .endpoints
        .iter()
        .find(|endpoint| {
            endpoint.api_type == api_type
                && selected_endpoint_id
                    .map(|id| endpoint_id(endpoint) == id)
                    .unwrap_or(true)
        })
        .or_else(|| {
            if selected_endpoint_id.is_some() {
                return None;
            }
            provider
                .endpoints
                .iter()
                .find(|endpoint| endpoint.api_type == api_type)
        })
}

// ---------------------------------------------------------------------------
// Synthetic "custom" provider — escape hatch for endpoints not in the
// baked-in catalog. Same render rules as baseline anthropic / openai-chat
// providers, just with no default base_url and no model suggestions; the
// user fills everything in.
// ---------------------------------------------------------------------------

// `compatibility_warning` field stays in EndpointDef for future
// per-provider caveats, but no v1 catalog entry fills it. Earlier we
// painted a blanket "codex requires Responses" warning on every
// openai-chat endpoint; user testing showed at least some third-party
// providers do serve /v1/responses, so the warning was over-cautious.
// Re-add per-provider when we have concrete evidence a specific
// endpoint breaks.

pub fn custom() -> &'static ProviderCatalog {
    static CUSTOM: LazyLock<ProviderCatalog> = LazyLock::new(|| {
        ProviderCatalog {
        id: "custom".to_string(),
        label: "Custom".to_string(),
        icon: Some("✨".to_string()),
        homepage: None,
        hidden_from_picker: false,
        endpoints: vec![
            EndpointDef {
                id: None,
                label: None,
                api_type: "anthropic".to_string(),
                default_base_url: String::new(),
                headers: BTreeMap::new(),
                auth_header: false,
                models: Vec::new(),
                capabilities: EndpointCapabilities::default(),
                compatibility_warning: None,
                auth_modes: vec![AuthModeDef {
                    mode: "api_key".to_string(),
                    label: Some("Use API key".to_string()),
                    fields: vec![FieldDef {
                        name: "api_key".to_string(),
                        label: "API key".to_string(),
                        secret: true,
                        required: true,
                        placeholder: None,
                        validate: None,
                    }],
                    render: Some(RenderRules {
                        env: btree_kv(&[
                            ("ANTHROPIC_API_KEY", "{{api_key}}"),
                            ("ANTHROPIC_BASE_URL", "{{base_url}}"),
                            ("ANTHROPIC_MODEL", "{{model}}"),
                        ]),
                        settings_files: Vec::new(),
                    }),
                    login_command: None,
                    session_file_check: None,
                }],
            },
            EndpointDef {
                id: None,
                label: None,
                api_type: "openai-responses".to_string(),
                default_base_url: String::new(),
                headers: BTreeMap::new(),
                auth_header: false,
                models: Vec::new(),
                capabilities: EndpointCapabilities {
                    reasoning_effort: true,
                    ..EndpointCapabilities::default()
                },
                compatibility_warning: None,
                auth_modes: vec![AuthModeDef {
                    mode: "api_key".to_string(),
                    label: Some("Use API key".to_string()),
                    fields: vec![FieldDef {
                        name: "api_key".to_string(),
                        label: "API key".to_string(),
                        secret: true,
                        required: true,
                        placeholder: None,
                        validate: None,
                    }],
                    render: Some(RenderRules {
                        env: btree_kv(&[("OPENAI_API_KEY", "{{api_key}}")]),
                        settings_files: vec![
                            SettingsFileTemplate {
                                rel_path: "config.toml".to_string(),
                                template: "model = \"{{model}}\"\nmodel_provider = \"custom\"\nmodel_reasoning_effort = \"{{reasoning_effort}}\"\ndisable_response_storage = true\n\n[model_providers.custom]\nname = \"Custom\"\nbase_url = \"{{base_url}}\"\nwire_api = \"responses\"\nrequires_openai_auth = true\n".to_string(),
                            },
                            SettingsFileTemplate {
                                rel_path: "auth.json".to_string(),
                                template: "{\n  \"OPENAI_API_KEY\": \"{{api_key|json}}\"\n}\n".to_string(),
                            },
                        ],
                    }),
                    login_command: None,
                    session_file_check: None,
                }],
            },
            EndpointDef {
                id: None,
                label: None,
                api_type: "openai-chat".to_string(),
                default_base_url: String::new(),
                headers: BTreeMap::new(),
                auth_header: false,
                models: Vec::new(),
                capabilities: EndpointCapabilities::default(),
                compatibility_warning: None,
                auth_modes: vec![AuthModeDef {
                    mode: "api_key".to_string(),
                    label: Some("Use API key".to_string()),
                    fields: vec![FieldDef {
                        name: "api_key".to_string(),
                        label: "API key".to_string(),
                        secret: true,
                        required: true,
                        placeholder: None,
                        validate: None,
                    }],
                    render: Some(RenderRules {
                        env: btree_kv(&[("OPENAI_API_KEY", "{{api_key}}")]),
                        settings_files: vec![
                            SettingsFileTemplate {
                                rel_path: "config.toml".to_string(),
                                template: "model = \"{{model}}\"\nmodel_provider = \"custom\"\nmodel_reasoning_effort = \"high\"\ndisable_response_storage = true\n\n[model_providers.custom]\nname = \"Custom\"\nbase_url = \"{{base_url}}\"\nwire_api = \"chat\"\nrequires_openai_auth = true\n".to_string(),
                            },
                            SettingsFileTemplate {
                                rel_path: "auth.json".to_string(),
                                template: "{\n  \"OPENAI_API_KEY\": \"{{api_key|json}}\"\n}\n".to_string(),
                            },
                        ],
                    }),
                    login_command: None,
                    session_file_check: None,
                }],
            },
        ],
    }
    });
    &CUSTOM
}

fn btree_kv(pairs: &[(&str, &str)]) -> std::collections::BTreeMap<String, String> {
    pairs
        .iter()
        .map(|(k, v)| ((*k).to_string(), (*v).to_string()))
        .collect()
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn baseline_catalog_parses() {
        // Touching `all()` triggers the LazyLock; the panic-on-parse-error
        // contract above means a successful call here proves all bundled
        // JSONs are well-formed.
        let entries = all();
        assert!(entries.len() >= 5);
        assert!(get("moonshot").is_some());
        assert!(get("kimi").is_some());
        assert!(get("dashscope").is_some());
        assert!(get("openrouter").is_some());
        assert!(get("minimax").is_some());
        assert!(get("deepseek").is_some());
        assert!(get("zai").is_some());
        assert!(get("gemini").is_some());
        assert!(get("azure").is_some());
    }

    #[test]
    fn moonshot_supports_both_api_types() {
        let provider = get("moonshot").expect("moonshot must exist");
        let api_types: Vec<_> = provider
            .endpoints
            .iter()
            .map(|e| e.api_type.as_str())
            .collect();
        assert!(api_types.contains(&"anthropic"));
        assert!(api_types.contains(&"openai-chat"));
        let kimi_coding =
            find_endpoint(provider, "anthropic", Some("kimi-coding")).expect("kimi coding");
        assert_eq!(kimi_coding.default_base_url, "https://api.kimi.com/coding/");
        assert_eq!(
            kimi_coding.headers.get("User-Agent").map(String::as_str),
            Some("claude-code/0.1.0")
        );
    }

    #[test]
    fn kimi_coding_sets_coding_endpoint_headers() {
        let provider = get("kimi").expect("kimi must exist");
        assert!(provider.hidden_from_picker);
        let endpoint = provider
            .endpoints
            .iter()
            .find(|e| e.api_type == "anthropic")
            .expect("kimi anthropic endpoint");
        assert_eq!(endpoint.default_base_url, "https://api.kimi.com/coding/");
        assert_eq!(
            endpoint.headers.get("User-Agent").map(String::as_str),
            Some("claude-code/0.1.0")
        );
        assert_eq!(
            endpoint.models.first().map(|model| model.id.as_str()),
            Some("kimi-for-coding")
        );
    }

    #[test]
    fn dashscope_exposes_protocol_specific_plan_endpoints() {
        let provider = get("dashscope").expect("dashscope must exist");
        let endpoints: Vec<_> = provider
            .endpoints
            .iter()
            .filter(|e| e.api_type == "openai-chat")
            .map(endpoint_id)
            .collect();
        assert_eq!(
            endpoints,
            vec![
                "coding-plan",
                "coding-plan-cn",
                "token-plan",
                "token-plan-cn"
            ]
        );
        let anthropic_endpoints: Vec<_> = provider
            .endpoints
            .iter()
            .filter(|e| e.api_type == "anthropic")
            .map(endpoint_id)
            .collect();
        assert_eq!(anthropic_endpoints, vec!["coding-plan", "coding-plan-cn"]);

        for &endpoint_id in &endpoints {
            let endpoint = find_endpoint(provider, "openai-chat", Some(endpoint_id))
                .unwrap_or_else(|| panic!("dashscope openai-chat endpoint {endpoint_id}"));
            assert_eq!(
                endpoint.headers.get("User-Agent").map(String::as_str),
                Some("codex-cli/0.80.0 (external, cli)")
            );
            assert_eq!(
                endpoint
                    .headers
                    .get("X-DashScope-UserAgent")
                    .map(String::as_str),
                Some("codex-cli/0.80.0 (external, cli)")
            );
            assert_eq!(
                endpoint
                    .headers
                    .get("X-DashScope-AuthType")
                    .map(String::as_str),
                Some("openai")
            );
        }
        for &endpoint_id in &anthropic_endpoints {
            let endpoint = find_endpoint(provider, "anthropic", Some(endpoint_id))
                .unwrap_or_else(|| panic!("dashscope anthropic endpoint {endpoint_id}"));
            assert_eq!(
                endpoint.headers.get("User-Agent").map(String::as_str),
                Some("claude-code/0.1.0")
            );
            assert!(endpoint.auth_header);
        }

        let token = find_endpoint(provider, "openai-chat", Some("token-plan"))
            .expect("token plan endpoint");
        assert_eq!(
            token.default_base_url,
            "https://dashscope-intl.aliyuncs.com/compatible-mode/v1"
        );

        let coding = find_endpoint(provider, "openai-chat", Some("coding-plan"))
            .expect("coding plan endpoint");
        assert_eq!(
            coding.default_base_url,
            "https://coding-intl.dashscope.aliyuncs.com/v1"
        );
        assert_eq!(
            coding
                .headers
                .get("X-DashScope-UserAgent")
                .map(String::as_str),
            Some("codex-cli/0.80.0 (external, cli)")
        );
        assert_eq!(
            coding
                .headers
                .get("X-DashScope-AuthType")
                .map(String::as_str),
            Some("openai")
        );
        assert!(coding.models.iter().any(|model| model.id == "qwen3.6-plus"));

        let anthropic = find_endpoint(provider, "anthropic", Some("coding-plan"))
            .expect("coding plan anthropic endpoint");
        assert_eq!(
            anthropic.default_base_url,
            "https://coding-intl.dashscope.aliyuncs.com/apps/anthropic"
        );
        assert!(anthropic.auth_header);
    }

    #[test]
    fn minimax_anthropic_endpoint_uses_auth_header() {
        let provider = get("minimax").expect("minimax must exist");
        let global = find_endpoint(provider, "anthropic", Some("global")).expect("global endpoint");
        let cn = find_endpoint(provider, "anthropic", Some("cn")).expect("cn endpoint");
        assert_eq!(global.default_base_url, "https://api.minimax.io/anthropic");
        assert_eq!(cn.default_base_url, "https://api.minimaxi.com/anthropic");
        assert!(global.auth_header);
        assert!(cn.auth_header);
        let auth = global
            .auth_modes
            .iter()
            .find(|auth| auth.mode == "api_key")
            .expect("api key auth");
        let render = auth.render.as_ref().expect("api key auth renders env");
        assert_eq!(
            render.env.get("ANTHROPIC_AUTH_TOKEN").map(String::as_str),
            Some("{{api_key}}")
        );
        assert!(render.env.get("ANTHROPIC_API_KEY").is_none());
    }

    #[test]
    fn azure_supports_responses_only() {
        let provider = get("azure").expect("azure must exist");
        let api_types: Vec<_> = provider
            .endpoints
            .iter()
            .map(|e| e.api_type.as_str())
            .collect();
        assert_eq!(api_types, vec!["openai-responses"]);
    }

    #[test]
    fn gemini_supports_api_key_launch() {
        let provider = get("gemini").expect("gemini must exist");
        let endpoint = provider
            .endpoints
            .iter()
            .find(|e| e.api_type == "gemini")
            .expect("gemini endpoint must exist");
        let auth = endpoint
            .auth_modes
            .iter()
            .find(|a| a.mode == "api_key")
            .expect("gemini api_key auth must exist");
        let render = auth.render.as_ref().expect("api_key auth renders env");
        assert_eq!(
            render.env.get("GEMINI_API_KEY").map(String::as_str),
            Some("{{api_key}}")
        );
        assert_eq!(
            render.env.get("GEMINI_MODEL").map(String::as_str),
            Some("{{model}}")
        );
        assert_eq!(
            render.env.get("GOOGLE_GEMINI_BASE_URL").map(String::as_str),
            Some("{{base_url}}")
        );
    }
}
