use agent_client_protocol::schema as acp;
use serde_json::{json, Value};

pub(super) fn from_session_setup(
    config_options: Option<&[acp::SessionConfigOption]>,
    modes: Option<&acp::SessionModeState>,
) -> Option<Value> {
    config_options
        .and_then(from_config_options)
        .or_else(|| modes.and_then(from_modes))
}

pub(super) fn from_config_options(config_options: &[acp::SessionConfigOption]) -> Option<Value> {
    let option = config_options.iter().find(|option| {
        matches!(
            option.category.as_ref(),
            Some(acp::SessionConfigOptionCategory::Mode)
        ) || option.id.to_string() == "mode"
    })?;
    let select = match &option.kind {
        acp::SessionConfigKind::Select(select) => select,
        _ => return None,
    };
    let options = flatten_select_options(&select.options);
    if options.is_empty() {
        return None;
    }
    Some(json!({
        "source": "config_option",
        "configId": option.id.to_string(),
        "name": option.name,
        "description": option.description,
        "currentValue": select.current_value.to_string(),
        "options": options,
    }))
}

pub(super) fn from_modes(modes: &acp::SessionModeState) -> Option<Value> {
    if modes.available_modes.is_empty() {
        return None;
    }
    Some(json!({
        "source": "session_mode",
        "currentValue": modes.current_mode_id.to_string(),
        "options": modes.available_modes.iter().map(|mode| json!({
            "value": mode.id.to_string(),
            "name": mode.name,
            "description": mode.description,
        })).collect::<Vec<_>>(),
    }))
}

pub(super) fn with_current_value(state: &Value, current_value: &str) -> Option<Value> {
    let mut next = state.clone();
    let object = next.as_object_mut()?;
    object.insert(
        "currentValue".to_string(),
        Value::String(current_value.to_string()),
    );
    Some(next)
}

fn flatten_select_options(options: &acp::SessionConfigSelectOptions) -> Vec<Value> {
    match options {
        acp::SessionConfigSelectOptions::Ungrouped(options) => {
            options.iter().map(select_option_to_json).collect()
        }
        acp::SessionConfigSelectOptions::Grouped(groups) => groups
            .iter()
            .flat_map(|group| {
                group.options.iter().map(|option| {
                    let mut value = select_option_to_json(option);
                    if let Some(object) = value.as_object_mut() {
                        object.insert("group".to_string(), Value::String(group.name.clone()));
                    }
                    value
                })
            })
            .collect(),
        _ => Vec::new(),
    }
}

fn select_option_to_json(option: &acp::SessionConfigSelectOption) -> Value {
    json!({
        "value": option.value.to_string(),
        "name": option.name,
        "description": option.description,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prefers_mode_config_option_over_legacy_modes() {
        let config_options = vec![
            acp::SessionConfigOption::select(
                "model",
                "Model",
                "gpt-5.2",
                vec![acp::SessionConfigSelectOption::new("gpt-5.2", "GPT-5.2")],
            )
            .category(acp::SessionConfigOptionCategory::Model),
            acp::SessionConfigOption::select(
                "permissions",
                "Session permissions",
                "fullAccess",
                vec![
                    acp::SessionConfigSelectOption::new("default", "Default permissions"),
                    acp::SessionConfigSelectOption::new("fullAccess", "Full access"),
                ],
            )
            .category(acp::SessionConfigOptionCategory::Mode),
        ];
        let modes = acp::SessionModeState::new(
            "default",
            vec![acp::SessionMode::new("default", "Default")],
        );

        let value = from_session_setup(Some(&config_options), Some(&modes)).expect("mode state");

        assert_eq!(value["source"], "config_option");
        assert_eq!(value["configId"], "permissions");
        assert_eq!(value["currentValue"], "fullAccess");
        assert_eq!(value["options"].as_array().unwrap().len(), 2);
    }

    #[test]
    fn flattens_grouped_mode_options() {
        let config_options = vec![acp::SessionConfigOption::select(
            "mode",
            "Session permissions",
            "autoReview",
            vec![acp::SessionConfigSelectGroup::new(
                "permissions",
                "Permissions",
                vec![
                    acp::SessionConfigSelectOption::new("autoReview", "Auto-review"),
                    acp::SessionConfigSelectOption::new("fullAccess", "Full access"),
                ],
            )],
        )
        .category(acp::SessionConfigOptionCategory::Mode)];

        let value = from_config_options(&config_options).expect("mode state");
        let options = value["options"].as_array().unwrap();

        assert_eq!(options[0]["group"], "Permissions");
        assert_eq!(options[1]["value"], "fullAccess");
    }
}
