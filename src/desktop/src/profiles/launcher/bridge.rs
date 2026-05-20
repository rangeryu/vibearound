//! Profile rendering decisions for desktop launches.
//!
//! Core owns the shared profile/bridge renderer so desktop, web terminal, and
//! future headless launches all agree on env vars, command args, and local
//! settings materialization. Desktop only layers on local launch preferences
//! that are specific to the terminal UI.

use ::common::{config, profiles};
use anyhow::anyhow;
use profiles::ProfileDef;

use super::codex;
use crate::profiles::terminal::{self, CompatibilityBridgeMode};

pub(super) fn render_for_launch(
    profile: &ProfileDef,
    launch_target: &str,
    launch_id: &str,
) -> anyhow::Result<profiles::render::RenderedProfile> {
    let route = crate::profiles::resolve_profile_agent_route(profile, launch_target)
        .ok_or_else(|| anyhow!("profile '{}' cannot launch '{}'", profile.id, launch_target))?;
    if route.bridge_target_api_type.is_some() {
        return profiles::runtime::render_for_agent_route(
            profile,
            launch_target,
            launch_id,
            &route,
        );
    }

    let mut rendered = profiles::runtime::render_for_launch_api_type(
        profile,
        launch_target,
        &route.client_api_type,
    )?;
    apply_compatibility_bridge(
        profile,
        launch_target,
        launch_id,
        &route.client_api_type,
        &mut rendered,
    )?;
    Ok(rendered)
}

fn apply_compatibility_bridge(
    profile: &ProfileDef,
    launch_target: &str,
    _launch_id: &str,
    api_type: &str,
    rendered: &mut profiles::render::RenderedProfile,
) -> anyhow::Result<()> {
    if terminal::read_compatibility_bridge_preference() == CompatibilityBridgeMode::Off {
        return Ok(());
    }

    if launch_target != "codex" || api_type != "openai-chat" {
        return Ok(());
    }

    let provider_key = format!("model_providers.{}", profile.provider);
    let bridge_base_url = format!(
        "http://127.0.0.1:{}/va/local-api/{}/codex-openai-chat/openai-chat/v1",
        config::DEFAULT_PORT,
        profile.id
    );

    codex::push_config_arg(
        &mut rendered.command_args,
        &format!("{provider_key}.base_url"),
        &codex::toml_string(&bridge_base_url),
    );
    codex::push_config_arg(
        &mut rendered.command_args,
        &format!("{provider_key}.wire_api"),
        &codex::toml_string("responses"),
    );

    Ok(())
}
