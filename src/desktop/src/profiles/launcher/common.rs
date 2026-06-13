use std::borrow::Cow;
use std::collections::HashSet;
use std::path::PathBuf;

use super::templates;

#[derive(Debug, Clone)]
pub(super) struct LaunchPlan {
    pub env: Vec<(String, String)>,
    pub command: String,
    pub args: Vec<String>,
    pub window_label: String,
    pub workspace: PathBuf,
    pub macos_app_probe: Option<String>,
    #[cfg_attr(not(target_os = "windows"), allow(dead_code))]
    pub windows_process_probe: Option<String>,
    #[cfg_attr(not(target_os = "windows"), allow(dead_code))]
    pub windows_executable_path: Option<PathBuf>,
}

#[cfg(any(target_os = "windows", test))]
pub(super) fn command_words_with_args(command: &str, args: &[String]) -> Vec<String> {
    let mut words = split_command_words(command);
    words.extend(args.iter().cloned());
    words
}

#[cfg(any(target_os = "windows", test))]
fn split_command_words(command: &str) -> Vec<String> {
    let mut words = Vec::new();
    let mut current = String::new();
    let mut chars = command.chars().peekable();
    let mut quote: Option<char> = None;

    while let Some(ch) = chars.next() {
        match quote {
            Some(q) if ch == q => {
                quote = None;
            }
            Some('"') if ch == '\\' => {
                if matches!(chars.peek(), Some('"') | Some('\\')) {
                    let next = chars.next().expect("peeked next char");
                    current.push(next);
                } else {
                    current.push(ch);
                }
            }
            Some(_) => current.push(ch),
            None if ch == '\'' || ch == '"' => {
                quote = Some(ch);
            }
            None if ch.is_whitespace() => {
                if !current.is_empty() {
                    words.push(std::mem::take(&mut current));
                }
            }
            None => current.push(ch),
        }
    }

    if !current.is_empty() {
        words.push(current);
    }

    words
}

pub(super) fn build_bash_script(plan: &LaunchPlan) -> String {
    let mut out = String::new();
    out.push_str("#!/bin/bash\n");
    // Self-delete first so an unexpected ^C between here and `exec` doesn't
    // leave the credential-bearing script sitting in $TMPDIR.
    out.push_str("rm -- \"$0\"\n");
    out.push_str("set -e\n");
    out.push_str(&format!(
        "echo \"# VibeAround profile: {}\"\n",
        plan.window_label.replace('"', "'")
    ));

    let mut seen = HashSet::new();
    for (k, v) in &plan.env {
        if !seen.insert(k.as_str()) {
            tracing::warn!("[profiles] duplicate env key '{}' in render output", k);
        }
        let escaped = shell_escape::unix::escape(std::borrow::Cow::Borrowed(v.as_str()));
        out.push_str(&format!("export {}={}\n", k, escaped));
    }
    append_bash_color_env(&mut out);

    let workspace = plan.workspace.to_string_lossy();
    let cwd = shell_escape::unix::escape(std::borrow::Cow::Borrowed(workspace.as_ref()));
    out.push_str(&format!("cd {}\n", cwd));
    let command = command_with_unix_args(&plan.command, &plan.args);
    if let Some(app_name) = &plan.macos_app_probe {
        append_macos_app_launch(&mut out, &command, app_name, &plan.env);
    } else {
        out.push_str(&format!("exec {command}\n"));
    }
    out
}

fn append_macos_app_launch(
    out: &mut String,
    command: &str,
    app_name: &str,
    env: &[(String, String)],
) {
    let app_script = format!(
        "application \"{}\" is running",
        app_name.replace('\\', "\\\\").replace('"', "\\\"")
    );
    let app_script = shell_escape::unix::escape(std::borrow::Cow::Owned(app_script));
    let command = macos_open_command_with_env(command, env);
    out.push_str(&templates::macos_app_probe_script(&command, &app_script));
}

fn macos_open_command_with_env(command: &str, env: &[(String, String)]) -> String {
    let Some(rest) = command.trim_start().strip_prefix("open ") else {
        return command.to_string();
    };
    if env.is_empty() {
        return command.to_string();
    }

    let mut out = String::from("open");
    for (key, value) in env {
        if !is_valid_env_key(key) {
            continue;
        }
        let arg = format!("{key}={value}");
        out.push_str(" --env ");
        out.push_str(&shell_escape::unix::escape(Cow::Owned(arg)));
    }
    out.push(' ');
    out.push_str(rest);
    out
}

fn is_valid_env_key(key: &str) -> bool {
    !key.is_empty()
        && key
            .chars()
            .next()
            .is_some_and(|ch| ch.is_ascii_alphabetic() || ch == '_')
        && key
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || ch == '_')
}

fn command_with_unix_args(command: &str, args: &[String]) -> String {
    if args.is_empty() {
        return command.to_string();
    }

    let mut out = command.to_string();
    for arg in args {
        out.push(' ');
        out.push_str(&shell_escape::unix::escape(std::borrow::Cow::Borrowed(
            arg.as_str(),
        )));
    }
    out
}

fn append_bash_color_env(out: &mut String) {
    out.push_str("unset NO_COLOR\n");
    out.push_str(
        "if [ -z \"${TERM:-}\" ] || [ \"$TERM\" = \"dumb\" ]; then export TERM=xterm-256color; fi\n",
    );
    out.push_str("export COLORTERM=${COLORTERM:-truecolor}\n");
    out.push_str("export CLICOLOR=${CLICOLOR:-1}\n");
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    fn plan(env: Vec<(String, String)>, command: &str, args: Vec<String>) -> LaunchPlan {
        LaunchPlan {
            env,
            command: command.to_string(),
            args,
            window_label: "Test".to_string(),
            workspace: Path::new("/tmp/work dir").to_path_buf(),
            macos_app_probe: None,
            windows_process_probe: None,
            windows_executable_path: None,
        }
    }

    #[test]
    fn build_bash_script_escapes_injection_payload() {
        let script = build_bash_script(&plan(
            vec![(
                "ANTHROPIC_API_KEY".to_string(),
                "hi$(touch /tmp/pwned)".to_string(),
            )],
            "claude",
            Vec::new(),
        ));

        assert!(script.contains("'hi$(touch /tmp/pwned)'"));
        assert!(!script.contains("$(touch /tmp/pwned)\n"));
    }

    #[test]
    fn build_bash_script_includes_self_delete_first() {
        let script = build_bash_script(&plan(Vec::new(), "claude", Vec::new()));
        let lines: Vec<&str> = script.lines().collect();
        assert_eq!(lines[0], "#!/bin/bash");
        assert_eq!(lines[1], "rm -- \"$0\"");
    }

    #[test]
    fn build_bash_script_cd_selected_workspace() {
        let script = build_bash_script(&plan(Vec::new(), "claude", Vec::new()));
        assert!(script.contains("cd '/tmp/work dir'\n"));
    }

    #[test]
    fn build_bash_script_restores_color_capable_terminal_env() {
        let script = build_bash_script(&plan(
            vec![("NO_COLOR".to_string(), "1".to_string())],
            "codex",
            Vec::new(),
        ));

        assert!(script.contains("export NO_COLOR=1\n"));
        assert!(script.contains("unset NO_COLOR\n"));
        assert!(script.contains("export TERM=xterm-256color"));
        assert!(script.contains("export COLORTERM=${COLORTERM:-truecolor}\n"));
        assert!(script.contains("export CLICOLOR=${CLICOLOR:-1}\n"));
        assert!(script.find("export NO_COLOR=1").unwrap() < script.find("unset NO_COLOR").unwrap());
    }

    #[test]
    fn build_bash_script_appends_unix_escaped_args() {
        let args = vec![
            "-c".to_string(),
            "hooks.SessionStart=[{ hooks = [{ command = \"hook --agent codex\" }] }]".to_string(),
        ];
        let script = build_bash_script(&plan(Vec::new(), "codex", args));

        assert!(script.contains("exec codex -c 'hooks.SessionStart="));
        assert!(script.contains("--agent codex"));
    }

    #[test]
    fn build_bash_script_waits_for_macos_app_probe() {
        let mut plan = plan(Vec::new(), "open -a Codex", Vec::new());
        plan.macos_app_probe = Some("Codex".to_string());
        let script = build_bash_script(&plan);

        assert!(script.contains("open -a Codex\nstatus=$?\n"));
        assert!(script.contains("for attempt in 1 2 3 4 5 6 7 8 9 10; do"));
        assert!(script.contains("sleep 0.5"));
        assert!(script.contains("[ \"$attempt\" -ge 4 ]"));
        assert!(script.contains("application \"Codex\" is running"));
        assert!(script.contains("exit \"$status\""));
        assert!(!script.contains("exec open -a Codex"));
    }

    #[test]
    fn build_bash_script_passes_env_to_macos_open() {
        let mut plan = plan(
            vec![
                (
                    "ANTHROPIC_BASE_URL".to_string(),
                    "http://127.0.0.1:12358/va/local-api/test".to_string(),
                ),
                ("ANTHROPIC_MODEL".to_string(), "MiniMax M2.7".to_string()),
            ],
            "open -a Claude",
            Vec::new(),
        );
        plan.macos_app_probe = Some("Claude".to_string());
        let script = build_bash_script(&plan);
        let open_line = script
            .lines()
            .find(|line| line.starts_with("open --env "))
            .expect("macos open command line");

        assert!(open_line.contains("ANTHROPIC_BASE_URL=http://127.0.0.1:12358/va/local-api/test"));
        assert!(open_line.contains("ANTHROPIC_MODEL=MiniMax"));
        assert!(open_line.contains("M2.7"));
        assert!(open_line.ends_with("-a Claude"));
    }

    #[test]
    fn split_command_words_handles_quoted_segments() {
        assert_eq!(
            command_words_with_args("\"C:\\Program Files\\tool.exe\" run 'two words'", &[]),
            vec!["C:\\Program Files\\tool.exe", "run", "two words"]
        );
    }
}
