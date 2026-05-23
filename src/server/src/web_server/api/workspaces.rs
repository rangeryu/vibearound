use axum::{http::StatusCode, Json};

use common::config;

fn workspace_item(
    ws: &std::path::Path,
    builtin: &std::path::Path,
) -> crate::api_types::WorkspaceItem {
    let is_builtin = ws == builtin;
    crate::api_types::WorkspaceItem {
        path: ws.to_string_lossy().to_string(),
        is_default: is_builtin,
        is_builtin,
    }
}

fn workspaces_response() -> crate::api_types::WorkspacesResponse {
    let cfg = config::ensure_loaded();
    let builtin = config::builtin_workspaces_dir();
    let all = cfg.all_workspaces();

    let workspaces = all.iter().map(|ws| workspace_item(ws, &builtin)).collect();

    crate::api_types::WorkspacesResponse {
        workspaces,
        default_workspace: builtin.to_string_lossy().to_string(),
    }
}

/// GET /api/workspaces -- list all workspaces.
pub async fn list_workspaces_handler() -> Json<crate::api_types::WorkspacesResponse> {
    Json(workspaces_response())
}

#[derive(serde::Deserialize)]
pub(crate) struct WorkspacePathBody {
    path: String,
}

#[derive(serde::Deserialize)]
pub(crate) struct CreateWorkspaceBody {
    name: String,
}

fn validate_workspace_name(name: &str) -> Result<String, (StatusCode, String)> {
    let name = name.trim();
    if name.is_empty() {
        return Err((StatusCode::BAD_REQUEST, "Workspace name is required".into()));
    }
    if name == "." || name == ".." || name.contains('/') || name.contains('\\') {
        return Err((
            StatusCode::BAD_REQUEST,
            "Workspace name must be a single folder name".into(),
        ));
    }
    Ok(name.to_string())
}

/// POST /api/workspaces -- add a workspace path.
pub async fn add_workspace_handler(
    Json(body): Json<WorkspacePathBody>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let path = common::workspace::normalize_workspace_cwd(std::path::PathBuf::from(&body.path));
    if !path.exists() || !path.is_dir() {
        return Err((
            StatusCode::BAD_REQUEST,
            format!(
                "Path does not exist or is not a directory: {}",
                path.to_string_lossy()
            ),
        ));
    }
    let path_string = path.to_string_lossy().to_string();
    config::update_settings_json(|root| {
        if let Some(obj) = root.as_object_mut() {
            let workspaces = obj
                .entry("workspaces")
                .or_insert_with(|| serde_json::json!([]));
            if let Some(arr) = workspaces.as_array_mut() {
                let val = serde_json::Value::String(path_string.clone());
                if !arr.contains(&val) {
                    arr.push(val);
                }
            }
        }
    })
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?;

    Ok(Json(serde_json::json!({ "added": path_string })))
}

/// POST /api/workspaces/create -- create and register a workspace under the built-in root.
pub async fn create_workspace_handler(
    Json(body): Json<CreateWorkspaceBody>,
) -> Result<Json<crate::api_types::CreateWorkspaceResponse>, (StatusCode, String)> {
    let name = validate_workspace_name(&body.name)?;
    let builtin = config::builtin_workspaces_dir();
    let path = builtin.join(name);

    if path.exists() && !path.is_dir() {
        return Err((
            StatusCode::BAD_REQUEST,
            format!("Path exists but is not a directory: {}", path.display()),
        ));
    }
    std::fs::create_dir_all(&path)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let path_string = path.to_string_lossy().to_string();
    config::update_settings_json(|root| {
        if let Some(obj) = root.as_object_mut() {
            let workspaces = obj
                .entry("workspaces")
                .or_insert_with(|| serde_json::json!([]));
            if let Some(arr) = workspaces.as_array_mut() {
                let val = serde_json::Value::String(path_string.clone());
                if !arr.contains(&val) {
                    arr.push(val);
                }
            }
        }
    })
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?;

    let response = workspaces_response();
    Ok(Json(crate::api_types::CreateWorkspaceResponse {
        workspace: workspace_item(&path, &builtin),
        workspaces: response.workspaces,
        default_workspace: response.default_workspace,
    }))
}

/// POST /api/workspaces/remove -- remove a workspace path (cannot remove built-in).
pub async fn remove_workspace_handler(
    Json(body): Json<WorkspacePathBody>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let builtin = config::builtin_workspaces_dir();
    if std::path::PathBuf::from(&body.path) == builtin {
        return Err((
            StatusCode::BAD_REQUEST,
            "Cannot remove the built-in workspace".into(),
        ));
    }
    config::update_settings_json(|root| {
        if let Some(arr) = root.get_mut("workspaces").and_then(|v| v.as_array_mut()) {
            arr.retain(|v| v.as_str() != Some(&body.path));
        }
    })
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?;

    Ok(Json(serde_json::json!({ "removed": body.path })))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_workspace_folder_names() {
        assert_eq!(validate_workspace_name(" project-a ").unwrap(), "project-a");
        assert!(validate_workspace_name("").is_err());
        assert!(validate_workspace_name("../project").is_err());
        assert!(validate_workspace_name("nested/project").is_err());
        assert!(validate_workspace_name("nested\\project").is_err());
    }
}
