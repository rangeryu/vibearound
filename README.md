<div align="center">

# VibeAround

**Keep your vibe coding agents around.**

[Download](https://github.com/jazzenchen/VibeAround/releases/latest) | [Demo](https://youtu.be/6kxNKTMz-AM) | [Wiki](https://github.com/jazzenchen/VibeAround/wiki) | [Discord](https://discord.gg/KsJWkY64GN) | [简体中文](README_CN.md)

<p align="center">
  <img src="https://img.shields.io/badge/Rust-1.82+-000?style=flat-square&logo=rust&logoColor=fff" alt="Rust" />
  <img src="https://img.shields.io/badge/Tauri-2.10-24C8DB?style=flat-square&logo=tauri&logoColor=fff" alt="Tauri" />
  <img src="https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react&logoColor=000" alt="React" />
  <img src="https://img.shields.io/badge/ACP-Rust_SDK-000?style=flat-square" alt="ACP" />
  <img src="https://img.shields.io/badge/License-MIT-blue?style=flat-square" alt="License: MIT" />
</p>

</div>

From desktop to mobile, from browser to messaging, VibeAround keeps your local coding agents connected, reachable, and ready to work.

Run Claude Code, Codex CLI, Gemini CLI, and more side by side with different provider profiles, all routed through one universal proxy.

## Screenshots

| Model profiles | Channel plugins |
|---|---|
| <img src="https://pub-806a1b8456464ce7a6c110f84946697e.r2.dev/documents/v0.5.12/screenshots/en-profiles.webp" alt="VibeAround model profiles" width="100%" /> | <img src="https://pub-806a1b8456464ce7a6c110f84946697e.r2.dev/documents/v0.5.12/screenshots/en-channels.webp" alt="VibeAround channel plugins" width="100%" /> |

## What You Get

### Launch local coding agents

Start Claude Code, Codex CLI, Gemini CLI, OpenCode, and other agents in parallel with different provider profiles.

### Message your local agents

Chat with the same local coding agents from Telegram, Feishu/Lark, Discord, Slack, WeChat, DingTalk, WeCom, QQ Bot, or the built-in web chat.

### Use a web terminal

Open a full browser terminal for your workspace, with mobile-friendly keys and optional tmux-backed persistence.

### Keep agent configs clean

Switch providers through saved profiles and the universal proxy, without rewriting each CLI's config files.

### Route through a universal proxy

Translate OpenAI Responses, Chat Completions, Anthropic Messages, and Gemini Generate Content across providers such as DeepSeek, Alibaba DashScope, Kimi, MiniMax, Z.AI/GLM, OpenRouter, Azure OpenAI, and custom endpoints.

### Handover live sessions

Use `/handover` and `/pickup` to move a running agent session between terminal, web, and messaging without starting over.

### Share remote previews

Expose local dev servers, Markdown, and HTML previews through short-lived authenticated links.

## Demo

[![VibeAround demo - local coding agents across desktop, browser, and messaging](https://img.youtube.com/vi/6kxNKTMz-AM/maxresdefault.jpg)](https://youtu.be/6kxNKTMz-AM)

*Remotely control local agents from messaging apps, and hand over sessions between terminal and phone.*

## Download VibeAround

The latest release is [VibeAround v0.5.16](https://github.com/jazzenchen/VibeAround/releases/tag/v0.5.16).

| Platform | Recommended download |
|---|---|
| macOS Apple Silicon | [VibeAround_0.5.16_arm64.dmg](https://github.com/jazzenchen/VibeAround/releases/download/v0.5.16/VibeAround_0.5.16_arm64.dmg) |
| Windows x64 | [Setup EXE](https://github.com/jazzenchen/VibeAround/releases/download/v0.5.16/VibeAround_0.5.16_x64-setup.exe), [MSI](https://github.com/jazzenchen/VibeAround/releases/download/v0.5.16/VibeAround_0.5.16_x64_en-US.msi), or [portable ZIP](https://github.com/jazzenchen/VibeAround/releases/download/v0.5.16/VibeAround-win-0.5.16-portable.zip) |
| Linux x64 | [AppImage](https://github.com/jazzenchen/VibeAround/releases/download/v0.5.16/VibeAround_0.5.16_amd64.AppImage) or [deb](https://github.com/jazzenchen/VibeAround/releases/download/v0.5.16/VibeAround_0.5.16_amd64.deb) |

macOS is currently published for Apple Silicon. Windows and Linux desktop packages are produced by GitHub Actions; the macOS DMG is signed and notarized.

## Works With

### Coding agents

Agents communicate over stdio through [ACP (Agent Client Protocol)](https://agentclientprotocol.com/). VibeAround can install npm-distributed bridges when they are needed.

| Agent | IM chat | Session handover | Profile launch | Manual proxy config |
|---|---|---|---|---|
| Claude Code | ✅ | ✅ | ✅ | ✅ |
| Codex CLI | ✅ | ✅ | ✅ | ✅ |
| Gemini CLI | ✅ | ✅ | ✅ | ✅ |
| Cursor CLI | ✅ | ✅ | Direct launch | ❌ |
| Kiro CLI | ✅ | ✅ | Direct launch | ❌ |
| Qwen Code | ✅ | ✅ | Direct launch | ❌ |
| OpenCode | ✅ | ❌ | ✅ | ✅ |

### Model providers and proxy routes

Provider profiles let you launch local agents against first-party APIs, OpenAI-compatible endpoints, and translated routes without hand-editing CLI config files.

| Provider | Profile support |
|---|---|
| DeepSeek | Built-in endpoints and proxy routes |
| Alibaba DashScope | Built-in Coding Plan and Token Plan endpoints |
| Moonshot / Kimi | Built-in OpenAI-compatible and proxy routes |
| MiniMax | Built-in OpenAI-compatible and proxy routes |
| Z.AI / GLM | Built-in endpoints and proxy routes |
| Google Gemini | Built-in Gemini API profile |
| OpenRouter | Built-in OpenRouter profile |
| Azure OpenAI | Built-in Azure profile |
| Custom endpoint | Bring your own compatible base URL |

VibeAround's local API proxy is powered by [va-ai-api-proxy](https://github.com/jazzenchen/va-ai-api-proxy). It translates between the common agent API shapes:

| API shape | Common endpoint |
|---|---|
| OpenAI Responses | `/v1/responses` |
| OpenAI Chat Completions | `/v1/chat/completions` |
| Anthropic Messages | `/v1/messages` |
| Gemini Generate Content | `/v1beta/models/{model}:generateContent` |

### Channel plugins

Each IM channel runs as a standalone Node.js plugin built with [@vibearound/plugin-channel-sdk](https://www.npmjs.com/package/@vibearound/plugin-channel-sdk). Official plugin entries can be installed from onboarding.

| Channel | Auth | DM | File/Image | Streaming |
|---|---|---|---|---|
| Telegram | Bot token | ✅ | ✅ | ✅ |
| Feishu / Lark | App credentials | ✅ | ✅ | ✅ |
| Discord | Bot token | ✅ | ✅ | ✅ |
| Slack | Bot + App token | ✅ | ✅ | ✅ |
| WeChat | QR code login | ✅ | ✅ | ❌ |
| DingTalk | AppKey + Secret | ✅ | ✅ | ✅ |
| WeCom | Bot ID + Secret | ✅ | ✅ | ✅ |
| QQ Bot | App ID + Token | ✅ | ✅ | ❌ |

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
# Pull the va-ai-api-proxy submodule used by local API translation
git submodule update --init --recursive
cd src
bun install
bun run prebuild

# Start the Tauri desktop app in development mode
bun run dev
```

If you cloned without `--recurse-submodules`, the first command pulls `src/va-ai-api-proxy`, which provides VibeAround's AI API translation primitives.

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

## Community

Ask questions, share ideas, and talk about how you use VibeAround.

[![Discord](https://img.shields.io/badge/Discord-Join%20VibeAround-5865F2?logo=discord&logoColor=white)](https://discord.gg/KsJWkY64GN)
[![Product Hunt](https://img.shields.io/badge/Product%20Hunt-Follow%20VibeAround-DA552F?logo=producthunt&logoColor=white)](https://www.producthunt.com/products/vibearound)

## License

[MIT](LICENSE)
