use std::os::unix::fs::PermissionsExt;

use anyhow::{bail, Context};

use super::common::{build_bash_script, LaunchPlan};
use crate::profiles::terminal::{self, TerminalChoice};

pub(super) fn spawn(plan: LaunchPlan) -> anyhow::Result<()> {
    let script = build_bash_script(&plan);
    let script_path = std::env::temp_dir().join(format!(
        "vibearound-launch-{}.command",
        uuid::Uuid::new_v4()
    ));
    std::fs::write(&script_path, &script)
        .with_context(|| format!("write launch script {:?}", script_path))?;
    std::fs::set_permissions(&script_path, std::fs::Permissions::from_mode(0o700))
        .with_context(|| format!("chmod launch script {:?}", script_path))?;

    let app_name = match terminal::read_preference() {
        TerminalChoice::Terminal => "Terminal",
        TerminalChoice::Iterm2 => "iTerm",
        other => bail!("terminal '{}' is not supported on macOS", other.id()),
    };

    let status = std::process::Command::new("open")
        .arg("-a")
        .arg(app_name)
        .arg(&script_path)
        .status()
        .with_context(|| format!("invoke `open -a {}`", app_name))?;

    if !status.success() {
        let _ = std::fs::remove_file(&script_path);
        bail!(
            "`open -a {}` failed (exit {:?}). Make sure {0}.app is installed and try again.",
            app_name,
            status.code()
        );
    }
    Ok(())
}
