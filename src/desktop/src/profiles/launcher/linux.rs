use std::ffi::OsString;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use anyhow::{bail, Context};

use super::common::{build_bash_script, LaunchPlan};
use crate::profiles::terminal::{self, TerminalChoice};

pub(super) fn spawn(plan: LaunchPlan) -> anyhow::Result<()> {
    let script_path = write_linux_launch_script(&plan)?;
    if let Err(error) = spawn_linux_terminal(terminal::read_preference(), &script_path) {
        let _ = std::fs::remove_file(&script_path);
        return Err(error);
    }
    Ok(())
}

fn write_linux_launch_script(plan: &LaunchPlan) -> anyhow::Result<PathBuf> {
    let script_path =
        std::env::temp_dir().join(format!("vibearound-launch-{}.sh", uuid::Uuid::new_v4()));
    let body = build_bash_script(plan);
    std::fs::write(&script_path, body)
        .with_context(|| format!("write launch script {:?}", script_path))?;
    std::fs::set_permissions(&script_path, std::fs::Permissions::from_mode(0o700))
        .with_context(|| format!("chmod launch script {:?}", script_path))?;
    Ok(script_path)
}

fn spawn_linux_terminal(choice: TerminalChoice, script_path: &Path) -> anyhow::Result<()> {
    let candidates = terminal_invocations(choice, script_path)?;
    let mut missing = Vec::new();

    for candidate in candidates {
        let mut command = Command::new(candidate.program);
        command
            .args(&candidate.args)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        match command.spawn() {
            Ok(_child) => return Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                missing.push(candidate.program);
            }
            Err(error) => {
                return Err(error)
                    .with_context(|| format!("launch Linux terminal '{}'", candidate.program));
            }
        }
    }

    bail!(
        "No supported Linux terminal command found for '{}'. Tried: {}. Install one or choose another terminal in Launch settings.",
        choice.label(),
        missing.join(", ")
    )
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct TerminalInvocation {
    program: &'static str,
    args: Vec<OsString>,
}

fn terminal_invocations(
    choice: TerminalChoice,
    script_path: &Path,
) -> anyhow::Result<Vec<TerminalInvocation>> {
    let script = script_path.as_os_str().to_owned();
    let invocations = match choice {
        TerminalChoice::SystemTerminal => vec![
            invocation("xdg-terminal-exec", [script.clone()]),
            invocation(
                "x-terminal-emulator",
                [OsString::from("-e"), script.clone()],
            ),
            invocation("gnome-terminal", [OsString::from("--"), script.clone()]),
            invocation("konsole", [OsString::from("-e"), script.clone()]),
            invocation(
                "xfce4-terminal",
                [OsString::from("--execute"), script.clone()],
            ),
            invocation("kitty", [script.clone()]),
            invocation("alacritty", [OsString::from("-e"), script.clone()]),
            invocation(
                "wezterm",
                [
                    OsString::from("start"),
                    OsString::from("--"),
                    script.clone(),
                ],
            ),
            invocation("xterm", [OsString::from("-e"), script.clone()]),
        ],
        TerminalChoice::GnomeTerminal => {
            vec![invocation("gnome-terminal", [OsString::from("--"), script])]
        }
        TerminalChoice::Konsole => vec![invocation("konsole", [OsString::from("-e"), script])],
        TerminalChoice::XfceTerminal => {
            vec![invocation(
                "xfce4-terminal",
                [OsString::from("--execute"), script],
            )]
        }
        TerminalChoice::Xterm => vec![invocation("xterm", [OsString::from("-e"), script])],
        TerminalChoice::Kitty => vec![invocation("kitty", [script])],
        TerminalChoice::Alacritty => {
            vec![invocation("alacritty", [OsString::from("-e"), script])]
        }
        TerminalChoice::WezTerm => {
            vec![invocation(
                "wezterm",
                [OsString::from("start"), OsString::from("--"), script],
            )]
        }
        other => bail!("terminal '{}' is not supported on Linux", other.id()),
    };
    Ok(invocations)
}

fn invocation<const N: usize>(program: &'static str, args: [OsString; N]) -> TerminalInvocation {
    TerminalInvocation {
        program,
        args: args.into(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn arg_strings(invocation: &TerminalInvocation) -> Vec<String> {
        invocation
            .args
            .iter()
            .map(|arg| arg.to_string_lossy().to_string())
            .collect()
    }

    #[test]
    fn system_terminal_tries_system_defaults_then_common_fallbacks() {
        let script = Path::new("/tmp/vibearound launch.sh");
        let invocations = terminal_invocations(TerminalChoice::SystemTerminal, script).unwrap();

        assert_eq!(invocations[0].program, "xdg-terminal-exec");
        assert_eq!(
            arg_strings(&invocations[0]),
            vec!["/tmp/vibearound launch.sh"]
        );
        assert_eq!(invocations[1].program, "x-terminal-emulator");
        assert_eq!(
            arg_strings(&invocations[1]),
            vec!["-e", "/tmp/vibearound launch.sh"]
        );
        assert_eq!(invocations[2].program, "gnome-terminal");
        assert_eq!(invocations.last().unwrap().program, "xterm");
    }

    #[test]
    fn common_linux_terminals_execute_script_without_shell_joining() {
        let script = Path::new("/tmp/vibearound launch.sh");
        let cases = [
            (
                TerminalChoice::GnomeTerminal,
                "gnome-terminal",
                vec!["--", "/tmp/vibearound launch.sh"],
            ),
            (
                TerminalChoice::Konsole,
                "konsole",
                vec!["-e", "/tmp/vibearound launch.sh"],
            ),
            (
                TerminalChoice::XfceTerminal,
                "xfce4-terminal",
                vec!["--execute", "/tmp/vibearound launch.sh"],
            ),
            (
                TerminalChoice::Xterm,
                "xterm",
                vec!["-e", "/tmp/vibearound launch.sh"],
            ),
            (
                TerminalChoice::Kitty,
                "kitty",
                vec!["/tmp/vibearound launch.sh"],
            ),
            (
                TerminalChoice::Alacritty,
                "alacritty",
                vec!["-e", "/tmp/vibearound launch.sh"],
            ),
            (
                TerminalChoice::WezTerm,
                "wezterm",
                vec!["start", "--", "/tmp/vibearound launch.sh"],
            ),
        ];

        for (choice, program, expected_args) in cases {
            let invocations = terminal_invocations(choice, script).unwrap();
            assert_eq!(invocations.len(), 1);
            assert_eq!(invocations[0].program, program);
            assert_eq!(arg_strings(&invocations[0]), expected_args);
        }
    }

    #[test]
    fn non_linux_terminal_choice_is_rejected() {
        let error = terminal_invocations(TerminalChoice::PowerShell, Path::new("/tmp/run.sh"))
            .unwrap_err()
            .to_string();

        assert!(error.contains("not supported on Linux"));
    }
}
