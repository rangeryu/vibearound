use axum::Json;

/// GET /api/profiles -- list saved profiles and the CLI targets each can launch.
pub async fn list_profiles_handler() -> Json<Vec<crate::api_types::ProfileLaunchOption>> {
    let agent_prefs = common::agent_state::read_prefs();
    let profile_connections =
        common::profiles::connections::merged_profile_connections(&agent_prefs);
    let profiles = common::profiles::schema::list()
        .into_iter()
        .map(common::profiles::normalize_legacy_profile_and_persist)
        .map(|profile| {
            let launch_targets =
                common::profiles::connections::launch_targets_for_profile_with_connections(
                    &profile,
                    &profile_connections,
                )
                .into_iter()
                .map(|target| crate::api_types::ProfileLaunchTarget {
                    id: target.id.to_string(),
                    label: target.label.to_string(),
                    api_type: target.api_type,
                    proxy_target_api_type: target.proxy_target_api_type,
                })
                .collect();
            crate::api_types::ProfileLaunchOption {
                id: profile.id,
                label: profile.label,
                provider: profile.provider,
                launch_targets,
            }
        })
        .collect();
    Json(profiles)
}
