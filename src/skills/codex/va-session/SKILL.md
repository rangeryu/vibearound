---
name: va-session
description: Resolve your current session ID for use with other VibeAround tools. Called by other skills that need session context (e.g. va-preview, vibearound handover).
---

# VibeAround Session ID

Resolve your current session ID. Other VibeAround skills reference this skill when they need session context for lifecycle management.

## How to Resolve

### Method 1: Via Codex MCP metadata (preferred)

Call the `get_session_id` MCP tool with `agent_kind` set to `codex`:

```
Tool: get_session_id
Server: vibearound
Arguments:
  agent_kind: "codex"
```

VibeAround reads Codex's MCP call metadata and returns the current Codex
thread/session ID.

### Method 2: Via VibeAround env vars

Check if the environment variables `VIBEAROUND_CHANNEL_KIND` and `VIBEAROUND_CHAT_ID` are set. If yes, call the `get_session_id` MCP tool:

```
Tool: get_session_id
Server: vibearound
Arguments:
  channel_kind: "<value of $VIBEAROUND_CHANNEL_KIND>"
  chat_id: "<value of $VIBEAROUND_CHAT_ID>"
```

The tool returns the exact session ID from VibeAround's internal state.

## Return Value

Return the session ID string to the calling skill. If neither method succeeds, return nothing — callers handle the missing case gracefully.
