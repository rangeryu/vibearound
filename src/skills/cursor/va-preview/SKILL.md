---
description: "Start a live preview so the user can see your work in their browser or phone. Use after starting a dev server or creating HTML files."
alwaysApply: false
---

# VibeAround Live Preview

After you finish building a web application, HTML page, or any browsable artifact, start a live preview so the user can see the result immediately via a shareable URL.

## When to Use

- You just started a dev server (next dev, vite, python -m http.server, etc.)
- You created HTML/CSS/JS files the user should see
- The user asked to "show me", "preview", or "let me see it"
- Only when the VibeAround MCP server is connected

## Prerequisites

The VibeAround MCP server must be connected (server name: `vibearound`). If not available, tell the user to start the VibeAround desktop app.

## Steps

### 1. Start the server (if not already running)

Before calling preview, make sure:
- The port you want is free: `lsof -i :<port>` should return nothing
- The server is actually listening (wait for "Listening on..." or similar in the output)
- Use `--host 0.0.0.0` when available for broader compatibility

### 2. Call preview_start

```
Tool: preview_start
Server: vibearound
Arguments:
  port: <the port your server is running on>
  cwd: "<current working directory>"
  title: "<short description of what you built>"  (optional)
```

If the tool says the workspace is not registered, call `register_workspace` with the `cwd` first, then retry.

### 3. Share the URL

Include the returned URL in your reply. The user can tap it to see the live preview in their browser or phone. The link expires in 5 minutes.

## Error Handling

- **MCP server not available**: The VibeAround desktop app may not be running.
- **Workspace not registered**: Call `register_workspace` first, then retry.
- **Port in use**: Check with `lsof -i :<port>` and choose a different port.
