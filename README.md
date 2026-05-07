<div align="center">

<img src="https://pub-806a1b8456464ce7a6c110f84946697e.r2.dev/documents/v0.1/banner.webp" width="100%" alt="VibeAround - vibe coding with your local AI agent, from anywhere" />

# VibeAround

**Your local coding agents, everywhere you work.**

[Download](https://github.com/jazzenchen/VibeAround/releases/latest) | [Demo](https://youtu.be/6kxNKTMz-AM) | [Wiki](https://github.com/jazzenchen/VibeAround/wiki) | [简体中文](README_CN.md)

<p align="center">
  <img src="https://img.shields.io/badge/Rust-1.82+-000?style=flat-square&logo=rust&logoColor=fff" alt="Rust" />
  <img src="https://img.shields.io/badge/Tauri-2.10-24C8DB?style=flat-square&logo=tauri&logoColor=fff" alt="Tauri" />
  <img src="https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react&logoColor=000" alt="React" />
  <img src="https://img.shields.io/badge/ACP-Rust_SDK-000?style=flat-square" alt="ACP" />
  <img src="https://img.shields.io/badge/License-MIT-blue?style=flat-square" alt="License: MIT" />
</p>

</div>

VibeAround turns your own machine into a local-first command center for AI coding work. Keep Claude Code, Codex CLI, Gemini CLI, Cursor CLI, Kiro CLI, Qwen Code, and OpenCode running where your repo and tools already live, then reach them from the desktop app, a browser terminal, or the IM app on your phone.

It is built for the messy, everyday loop of agentic coding: start the right agent in the right workspace, switch providers without rewriting config files, hand a live session to your phone, open a preview link, and keep moving.

## What You Get

### One-click coding agent launch

Start supported CLIs from a workspace with saved provider profiles. Launch Claude Code, Codex, Gemini CLI, OpenCode, and other agents directly, or route compatible agents through VibeAround's local API proxy when a provider needs translation.

### Provider profiles that travel with the launch

Save profiles for DeepSeek, Azure OpenAI, Gemini, Moonshot/Kimi, OpenRouter, MiniMax, Z.AI/GLM, or a custom endpoint. Use different profiles side by side without changing a CLI's global config.

### Chat with local agents from IM

Talk to the same local agent from Telegram, Feishu/Lark, Discord, Slack, WeChat, DingTalk, WeCom, or QQ Bot. The agent can edit code, run commands, start dev servers, and stream progress back into the conversation.

### Move sessions between surfaces

Use `/handover` and `/pickup` to move a live coding session between terminal, browser, and IM. Start from your laptop, continue from your phone, then return to the desktop without rebuilding the thread from scratch.

### Browser terminal and shareable previews

Open a full shell from a browser, including mobile-friendly terminal controls. Share local dev servers, rendered Markdown, and HTML previews through short-lived authenticated links.

## Download VibeAround

The latest release is [VibeAround v0.5.8](https://github.com/jazzenchen/VibeAround/releases/tag/v0.5.8).

| Platform | Recommended download |
|---|---|
| macOS Apple Silicon | [VibeAround_0.5.8_arm64.dmg](https://github.com/jazzenchen/VibeAround/releases/download/v0.5.8/VibeAround_0.5.8_arm64.dmg) |
| Windows x64 | [Setup EXE](https://github.com/jazzenchen/VibeAround/releases/download/v0.5.8/VibeAround_0.5.8_x64-setup.exe), [MSI](https://github.com/jazzenchen/VibeAround/releases/download/v0.5.8/VibeAround_0.5.8_x64_en-US.msi), or [portable ZIP](https://github.com/jazzenchen/VibeAround/releases/download/v0.5.8/VibeAround-win-0.5.8-portable.zip) |
| Linux x64 | [AppImage](https://github.com/jazzenchen/VibeAround/releases/download/v0.5.8/VibeAround_0.5.8_amd64.AppImage) or [deb](https://github.com/jazzenchen/VibeAround/releases/download/v0.5.8/VibeAround_0.5.8_amd64.deb) |

macOS is currently published for Apple Silicon. Windows and Linux desktop packages are produced by GitHub Actions; the macOS DMG is signed and notarized.

## Demo

[![VibeAround demo - session handover, agent switching, multi-channel concurrency](https://img.youtube.com/vi/6kxNKTMz-AM/maxresdefault.jpg)](https://youtu.be/6kxNKTMz-AM)

*Reach your local agent from IM, move a session between terminal and phone, and switch agents mid-conversation.*

## Works With

### Coding agents

Agents communicate over stdio through [ACP (Agent Client Protocol)](https://agentclientprotocol.com/). VibeAround can install npm-distributed bridges when they are needed.

| Agent | IM chat | Session handover | Launch profiles |
|---|---|---|---|
| Claude Code | Yes | Yes | Yes |
| Codex CLI | Yes | Yes | Yes |
| Gemini CLI | Yes | Yes | Direct launch |
| Cursor CLI | Yes | Yes | Direct launch |
| Kiro CLI | Yes | Yes | Direct launch |
| Qwen Code | Yes | Yes | Direct launch |
| OpenCode | Yes | No | Direct launch |

### Channel plugins

Each IM channel runs as a standalone Node.js plugin built with [@vibearound/plugin-channel-sdk](https://www.npmjs.com/package/@vibearound/plugin-channel-sdk). Official plugin entries can be installed from onboarding.

| Channel | Auth | DM | File/Image | Streaming |
|---|---|---|---|---|
| Telegram | Bot token | Yes | Yes | Yes |
| Feishu / Lark | App credentials | Yes | Yes | Yes |
| Discord | Bot token | Yes | Yes | Yes |
| Slack | Bot + App token | Yes | Yes | Yes |
| WeChat | QR code login | Yes | Yes | No |
| DingTalk | AppKey + Secret | Yes | Yes | Yes |
| WeCom | Bot ID + Secret | Yes | Yes | Yes |
| QQ Bot | App ID + Token | Yes | Yes | No |

## Documentation

- [Setup Guide](https://github.com/jazzenchen/VibeAround/wiki/Setup-Guide)
- [Product Surfaces](https://github.com/jazzenchen/VibeAround/wiki/Product-Surfaces)
- [Model Profiles and Agent Launch](https://github.com/jazzenchen/VibeAround/wiki/Model-Profiles-and-Agent-Launch)
- [Channel Plugins](https://github.com/jazzenchen/VibeAround/wiki/Channel-Plugins)
- [Configuration Model](https://github.com/jazzenchen/VibeAround/wiki/Configuration-Model)
- [Build and Packaging](https://github.com/jazzenchen/VibeAround/wiki/Build-and-Packaging)
- [FAQ & Troubleshooting](https://github.com/jazzenchen/VibeAround/wiki/FAQ-and-Troubleshooting)

## Develop Locally

```bash
cd src
bun install
bun run prebuild
bun run dev
```

Prerequisites: Rust 1.82+, Node.js 24 LTS recommended, Bun 1.3+. On macOS, also run `xcode-select --install`; on Linux, install the WebKitGTK/Tauri system dependencies for your distro.

## Slash Commands

| Command | What it does |
|---|---|
| `/help` | Show available commands |
| `/new` | Reset the session and start a fresh conversation |
| `/switch <agent>` | Switch agents mid-conversation |
| `/profile <name>` | Switch profile |
| `/close` | Close the conversation |
| `/handover` | Export the current session so you can resume it elsewhere |
| `/pickup <code>` | Resume a session handed over from another channel |
| `/agent <command>` | Send a slash command to the underlying agent, for example `/agent status` |

In Slack, the `/` prefix is reserved by the client, so use `/va` or `/vibearound`, for example `/va switch claude`.

## License

[MIT](LICENSE)
