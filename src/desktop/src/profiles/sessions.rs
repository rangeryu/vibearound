//! Launch session summaries for resume flows.

use std::path::Path;

use serde::Serialize;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchSessionSummary {
    pub agent_id: String,
    pub session_id: String,
    pub title: String,
    pub workspace: String,
    pub updated_at: u64,
    pub short_id: String,
    pub archived: bool,
}

pub(super) fn list_sessions(
    agent_id: String,
    workspace_path: String,
    include_archived: bool,
) -> Vec<LaunchSessionSummary> {
    let agent_id = super::workspace::canonical_agent_id(&agent_id);
    common::launch_sessions::list_for_agent_workspace_with_archived(
        &agent_id,
        Path::new(&workspace_path),
        25,
        include_archived,
    )
    .into_iter()
    .map(|session| LaunchSessionSummary {
        short_id: common::launch_sessions::short_id(&session.session_id),
        agent_id: session.agent_id,
        session_id: session.session_id,
        title: session.title,
        workspace: session.workspace,
        updated_at: session.updated_at,
        archived: session.archived,
    })
    .collect()
}
