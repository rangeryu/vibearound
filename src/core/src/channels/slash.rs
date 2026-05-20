//! Slash command parsing.
//!
//! Converts raw prompt text into a `SlashAction` variant. Handles
//! IM-client quirks (line wraps, extra whitespace, `/va <rest>` aliases for
//! Slack, `/agent <rest>` passthrough for sending commands into the
//! downstream agent CLI).

/// A parsed system slash command. `None` means the text was a regular
/// prompt, not a slash command — the caller should forward it to the agent.
pub(crate) enum SlashAction {
    /// `/agent <rest>` — strip prefix, send rest as a slash command to the
    /// agent CLI (e.g. `/agent status` → `/status`).
    AgentPassthrough(String),
    /// `/agent` — summarize current agent and agent namespace usage.
    AgentSummary,
    /// `/agent --list` — list VibeAround agent launch targets.
    ListAgents,
    /// `/agent --help` — list current agent's own commands.
    ListAgentCommands,
    /// `/agent --switch <agent>` — switch VibeAround agent launch target.
    AgentSwitch(String),
    /// `/new` — reset session (new conversation, same agent).
    NewSession,
    /// `/switch <agent_kind>[+profile]` — switch agent launch target.
    SwitchAgent(String),
    /// `/profile <profile>` — switch profile.
    SwitchProfile(String),
    /// `/workspace` or `/workspace --list` — list workspace choices.
    WorkspaceList,
    /// `/workspace <id|name>` — select workspace before agent startup.
    WorkspaceSwitch(String),
    /// `/status` — show VibeAround route status.
    Status,
    /// `/close` — close route.
    Close,
    /// `/help` or `/commands` — show system command menu.
    ShowCommandMenu,
    /// `/pickup <agent_kind> <session_id> [cwd]` — import a session from a
    /// coding agent (Direction 1, legacy full command).
    Pickup {
        agent_kind: String,
        session_id: String,
        cwd: Option<String>,
    },
    /// `/pickup <CODE>` — short code lookup.
    PickupCode(String),
    /// `/pair <CODE>` — pair a browser with this VibeAround instance.
    Pair(String),
    /// `/handover` — export current session to a coding agent (Direction 2).
    Handover,
    /// `/plan` — switch the current session to plan mode (no tool execution).
    /// Equivalent to `/mode plan`, kept as a shorthand.
    PlanMode,
    /// `/mode <modeId>` — switch session permission mode.
    /// Supported: default, plan, acceptEdits, bypassPermissions, dontAsk.
    SetMode(String),
    /// Unknown slash command.
    Unknown(String),
}

/// Normalize IM line-wrapping: replace `\r\n` / `\n` / `\r` plus any trailing
/// spaces after them with one space. IM clients sometimes convert line breaks
/// to spaces or sprinkle extra whitespace around user-entered commands.
fn strip_line_wraps(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut chars = s.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '\r' || c == '\n' {
            if c == '\r' && chars.peek() == Some(&'\n') {
                chars.next();
            }
            while chars.peek().is_some_and(|c| *c == ' ') {
                chars.next();
            }
            out.push(' ');
        } else {
            out.push(c);
        }
    }
    out
}

/// Parse a slash command from prompt text. Returns `None` if the text is
/// not a slash command (regular prompt → forward to agent).
pub(crate) fn parse_slash_command(text: &str) -> Option<SlashAction> {
    // Pre-process: strip IM line-wraps, then collapse runs of spaces into one.
    let cleaned = strip_line_wraps(text);
    let collapsed = cleaned.split_whitespace().collect::<Vec<_>>().join(" ");
    let trimmed = collapsed.trim();
    if !trimmed.starts_with('/') {
        return None;
    }

    // /va <rest> and /vibearound <rest> — Slack-friendly aliases.
    // Strip the prefix and re-parse the rest as if user typed /<rest>.
    //   "/va help"          → "/help"
    //   "/va switch claude" → "/switch claude"
    //   "/va agent status"  → "/agent status" → agent passthrough
    for prefix in ["/va ", "/vibearound "] {
        if let Some(rest) = trimmed.strip_prefix(prefix) {
            let rest = rest.trim();
            if rest.is_empty() {
                return Some(SlashAction::ShowCommandMenu);
            }
            let reparsed = if rest.starts_with('/') {
                rest.to_string()
            } else {
                format!("/{}", rest)
            };
            return parse_slash_command(&reparsed);
        }
    }
    if trimmed == "/va" || trimmed == "/vibearound" {
        return Some(SlashAction::ShowCommandMenu);
    }

    // /agent namespace:
    //   /agent                 — summary
    //   /agent --list          — VibeAround launch targets
    //   /agent --help          — current agent commands
    //   /agent --switch codex  — switch VibeAround launch target
    //   /agent status          — passthrough to agent CLI as "/status"
    if let Some(rest) = trimmed.strip_prefix("/agent/") {
        let rest = rest.trim();
        if rest.is_empty() {
            return Some(SlashAction::AgentSummary);
        }
        return Some(parse_agent_namespace(rest).unwrap_or_else(|| {
            SlashAction::AgentPassthrough(format!("/{}", rest.strip_prefix('/').unwrap_or(rest)))
        }));
    }
    if let Some(rest) = trimmed.strip_prefix("/agent ") {
        let rest = rest.trim();
        if rest.is_empty() {
            return Some(SlashAction::AgentSummary);
        }
        return Some(parse_agent_namespace(rest).unwrap_or_else(|| {
            let cmd = rest.strip_prefix('/').unwrap_or(rest);
            SlashAction::AgentPassthrough(format!("/{}", cmd))
        }));
    }
    if trimmed == "/agent" {
        return Some(SlashAction::AgentSummary);
    }

    let parts: Vec<&str> = trimmed.splitn(2, ' ').collect();
    let cmd = parts[0];
    let arg = parts.get(1).map(|s| s.trim().to_string());

    match cmd {
        "/new" => Some(SlashAction::NewSession),
        "/switch" => match arg {
            Some(kind) if !kind.is_empty() => Some(SlashAction::SwitchAgent(kind)),
            _ => Some(SlashAction::Unknown(trimmed.to_string())),
        },
        "/profile" => match arg {
            Some(profile) if !profile.is_empty() => Some(SlashAction::SwitchProfile(profile)),
            _ => Some(SlashAction::Unknown(trimmed.to_string())),
        },
        "/workspace" => match arg {
            Some(arg) if arg == "--list" => Some(SlashAction::WorkspaceList),
            Some(workspace) if !workspace.is_empty() => {
                Some(SlashAction::WorkspaceSwitch(workspace))
            }
            _ => Some(SlashAction::WorkspaceList),
        },
        "/status" => Some(SlashAction::Status),
        "/close" => Some(SlashAction::Close),
        "/help" | "/commands" => Some(SlashAction::ShowCommandMenu),
        "/pickup" => {
            // /pickup <CODE>                          — short code
            // /pickup <agent_kind> <session_id> [cwd] — legacy full form
            match arg {
                Some(rest) if !rest.is_empty() => {
                    let parts: Vec<&str> = rest.splitn(3, ' ').collect();
                    if parts.len() == 1 {
                        Some(SlashAction::PickupCode(parts[0].to_string()))
                    } else if parts.len() >= 2 && !parts[1].is_empty() {
                        let cwd = parts
                            .get(2)
                            .map(|s| s.trim().to_string())
                            .filter(|s| !s.is_empty());
                        Some(SlashAction::Pickup {
                            agent_kind: parts[0].to_string(),
                            session_id: parts[1].to_string(),
                            cwd,
                        })
                    } else {
                        Some(SlashAction::Unknown(trimmed.to_string()))
                    }
                }
                _ => Some(SlashAction::Unknown(trimmed.to_string())),
            }
        }
        "/handover" => Some(SlashAction::Handover),
        "/plan" => Some(SlashAction::PlanMode),
        "/mode" => match arg {
            Some(mode) if !mode.is_empty() => Some(SlashAction::SetMode(mode)),
            _ => Some(SlashAction::Unknown(trimmed.to_string())),
        },
        "/pair" => match arg {
            Some(code) if !code.is_empty() => Some(SlashAction::Pair(code)),
            _ => Some(SlashAction::Unknown(trimmed.to_string())),
        },
        _ => Some(SlashAction::Unknown(trimmed.to_string())),
    }
}

fn parse_agent_namespace(rest: &str) -> Option<SlashAction> {
    match rest {
        "--list" | "list" => Some(SlashAction::ListAgents),
        "--help" | "help" => Some(SlashAction::ListAgentCommands),
        "--switch" | "switch" => Some(SlashAction::Unknown("/agent --switch".to_string())),
        _ => rest
            .strip_prefix("--switch ")
            .or_else(|| rest.strip_prefix("switch "))
            .map(str::trim)
            .filter(|target| !target.is_empty())
            .map(|target| SlashAction::AgentSwitch(target.to_string())),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn switch_agent(text: &str) -> String {
        match parse_slash_command(text) {
            Some(SlashAction::SwitchAgent(agent)) => agent,
            _ => panic!("expected switch command"),
        }
    }

    fn agent_switch(text: &str) -> String {
        match parse_slash_command(text) {
            Some(SlashAction::AgentSwitch(target)) => target,
            _ => panic!("expected agent switch command"),
        }
    }

    #[test]
    fn switch_accepts_line_wrap_between_command_and_agent() {
        assert_eq!(switch_agent("/switch\nclaude"), "claude");
        assert_eq!(switch_agent("/switch\r\n  codex"), "codex");
    }

    #[test]
    fn va_switch_accepts_line_wraps() {
        assert_eq!(switch_agent("/va switch\nopencode"), "opencode");
        assert_eq!(switch_agent("/va\nswitch codex"), "codex");
    }

    #[test]
    fn parses_agent_namespace_commands() {
        assert!(matches!(
            parse_slash_command("/agent --list"),
            Some(SlashAction::ListAgents)
        ));
        assert!(matches!(
            parse_slash_command("/agent --help"),
            Some(SlashAction::ListAgentCommands)
        ));
        assert_eq!(
            agent_switch("/agent --switch codex+deepseek"),
            "codex+deepseek"
        );
    }

    #[test]
    fn parses_workspace_commands() {
        assert!(matches!(
            parse_slash_command("/workspace"),
            Some(SlashAction::WorkspaceList)
        ));
        assert!(matches!(
            parse_slash_command("/workspace --list"),
            Some(SlashAction::WorkspaceList)
        ));
        match parse_slash_command("/workspace VibeAround") {
            Some(SlashAction::WorkspaceSwitch(workspace)) => assert_eq!(workspace, "VibeAround"),
            _ => panic!("expected workspace switch"),
        }
    }

    #[test]
    fn parses_status_command() {
        assert!(matches!(
            parse_slash_command("/status"),
            Some(SlashAction::Status)
        ));
    }
}
