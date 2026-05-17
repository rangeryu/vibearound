<div align="center">

<img src="Logo.png" alt="VibeAround logo" width="96" />

# VibeAround

**让本地编程 Agent 留在身边，从桌面、网页、IM 随时接入。**

[下载](https://github.com/jazzenchen/VibeAround/releases/latest) | [演示](https://youtu.be/6kxNKTMz-AM) | [Wiki](https://github.com/jazzenchen/VibeAround/wiki) | [English](README.md)

<p align="center">
  <img src="https://img.shields.io/badge/Rust-1.82+-000?style=flat-square&logo=rust&logoColor=fff" alt="Rust" />
  <img src="https://img.shields.io/badge/Tauri-2.10-24C8DB?style=flat-square&logo=tauri&logoColor=fff" alt="Tauri" />
  <img src="https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react&logoColor=000" alt="React" />
  <img src="https://img.shields.io/badge/ACP-Rust_SDK-000?style=flat-square" alt="ACP" />
  <img src="https://img.shields.io/badge/License-MIT-blue?style=flat-square" alt="License: MIT" />
</p>

</div>

VibeAround 是一个面向本地 AI 编程 Agent 的桌面中枢。它把 Claude Code、Codex CLI、Gemini CLI、OpenCode 等本地 Agent runtime，连接到 Tauri 桌面应用、浏览器 Dashboard、移动端友好的 Web Chat、Web Terminal，以及 Telegram、飞书/Lark、Discord、Slack、微信、钉钉、企业微信、QQ Bot 等 IM 入口。

核心想法很简单：Agent 仍然在你的电脑上运行，但你可以从当下最顺手的入口触达它。

## 为什么需要 VibeAround

本地编程 Agent 很强，但通常被困在某一个终端窗口里。VibeAround 给它们增加了稳定的入口：

| 需求 | VibeAround 提供什么 |
|---|---|
| 用不同模型 provider 启动 Agent | 保存 Profile、设置 Agent Launch 默认项、支持直连启动 |
| 让本地 CLI 使用非原生模型 API | 在 OpenAI Responses、Chat Completions、Anthropic Messages、Gemini Generate Content 之间做本地统一代理 |
| 离开终端也能继续工作 | Web Chat、IM 频道、Web Terminal、会话接力 |
| 安全查看本地工作成果 | 为 dev server、Markdown、HTML 生成短时效预览链接 |
| 保持配置可复现 | 首次引导、插件安装、配置同步、MCP 与 Skill 自动注入 |

## 产品入口

| 入口 | 适合做什么 |
|---|---|
| 桌面应用 | 首次引导、Profile、启动默认项、工作区、频道插件、隧道、预览、快速启动 |
| Web Dashboard | 在浏览器中访问 Web Chat、Web Terminal、实时预览、会话列表和本地 runtime 状态 |
| Web Chat | 多 Agent 对话、恢复会话、文件/图片/文档附件、归档会话、显示思考/工具、发送快捷键 |
| Web Terminal | 浏览器里的本地 PTY 终端，支持移动端常用控制，也可附加 tmux |
| IM 频道 | 从 Telegram、飞书/Lark、Discord、Slack、微信、钉钉、企业微信、QQ Bot 私聊本地 Agent |
| 本地 API proxy | 按 Profile 生成 loopback endpoint，用于模型路由和 API 形态转换 |

## 界面截图

| 模型配置 | 频道插件 |
|---|---|
| <img src="https://pub-806a1b8456464ce7a6c110f84946697e.r2.dev/documents/v0.5.12/screenshots/cn-profiles.webp" alt="VibeAround 模型配置" width="100%" /> | <img src="https://pub-806a1b8456464ce7a6c110f84946697e.r2.dev/documents/v0.5.12/screenshots/cn-channels.webp" alt="VibeAround 频道插件" width="100%" /> |

## 可以做什么

### 启动本地编程 Agent

直接启动 Claude Code、Codex CLI、Gemini CLI、OpenCode 等 Agent，或通过保存的 provider profile 启动。多个 Agent、多个 Profile 可以并行存在。

### 用一个代理接入多种模型

通过 Provider Profile，把本地 Agent CLI 连接到 DeepSeek、阿里云百炼、Moonshot/Kimi、MiniMax、Z.AI/GLM、Google Gemini、OpenRouter、Azure OpenAI、官方 API 或自定义兼容 endpoint。

### 从 Web 和 IM 对话

使用内置 Web Chat 或 IM 频道与同一个本地 Agent 对话。Web Chat 支持恢复会话、增量同步会话列表、显示归档会话、多文件上传、拖拽附件和可配置发送快捷键。

### 保持终端工作流不断线

打开 Web Terminal，按需附加 tmux，或从桌面托盘快速启动原生终端。用 `/handover` 和 `/pickup` 在终端、Web、IM 之间移动正在运行的会话。

### 远程预览本地工作

将本地开发服务、Markdown 文件、HTML 预览生成带鉴权的短时链接，方便在另一台浏览器或手机上查看。

## 演示视频

[![VibeAround 演示视频 - 本地编程 Agent 跨桌面、浏览器和 IM 协同](https://img.youtube.com/vi/6kxNKTMz-AM/maxresdefault.jpg)](https://youtu.be/6kxNKTMz-AM)

通过通讯软件远程控制本地 Agent，并在终端和手机之间传递会话。

## 下载

最新版本：[VibeAround v0.5.16](https://github.com/jazzenchen/VibeAround/releases/tag/v0.5.16)。

| 平台 | 推荐下载 |
|---|---|
| macOS Apple Silicon | [VibeAround_0.5.16_arm64.dmg](https://github.com/jazzenchen/VibeAround/releases/download/v0.5.16/VibeAround_0.5.16_arm64.dmg) |
| Windows x64 | [Setup EXE](https://github.com/jazzenchen/VibeAround/releases/download/v0.5.16/VibeAround_0.5.16_x64-setup.exe)、[MSI](https://github.com/jazzenchen/VibeAround/releases/download/v0.5.16/VibeAround_0.5.16_x64_en-US.msi) 或 [免安装 ZIP](https://github.com/jazzenchen/VibeAround/releases/download/v0.5.16/VibeAround-win-0.5.16-portable.zip) |
| Linux x64 | [AppImage](https://github.com/jazzenchen/VibeAround/releases/download/v0.5.16/VibeAround_0.5.16_amd64.AppImage) 或 [deb](https://github.com/jazzenchen/VibeAround/releases/download/v0.5.16/VibeAround_0.5.16_amd64.deb) |

macOS 当前发布 Apple Silicon 版本。Windows 和 Linux 桌面包由 GitHub Actions 构建；macOS DMG 已签名并完成 notarization。

## 支持的 Agent

Agent 通过 [ACP (Agent Client Protocol)](https://agentclientprotocol.com/) 在 stdio 上通信。需要 npm 分发 bridge 时，VibeAround 会按需安装。

| Agent | IM 对话 | 会话接力 | Profile 启动 | 手动 proxy 配置 |
|---|---|---|---|---|
| Claude Code | 支持 | 支持 | 支持 | 支持 |
| Codex CLI | 支持 | 支持 | 支持 | 支持 |
| Gemini CLI | 支持 | 支持 | 支持 | 支持 |
| Cursor CLI | 支持 | 支持 | 直接启动 | 不支持 |
| Kiro CLI | 支持 | 支持 | 直接启动 | 不支持 |
| Qwen Code | 支持 | 支持 | 直接启动 | 不支持 |
| OpenCode | 支持 | 不支持 | 支持 | 支持 |

## Model Providers 与 Proxy 路由

Provider Profile 让本地 Agent 可以连接官方 API、OpenAI-compatible endpoint 或经过转换的 proxy route，而不用手动改 CLI 配置文件。

| Provider | Profile 支持 |
|---|---|
| DeepSeek | 内置 endpoint 和 proxy route |
| 阿里云百炼 | 内置 Coding Plan 和 Token Plan endpoint |
| Moonshot / Kimi | 内置 OpenAI-compatible 和 proxy route |
| MiniMax | 内置 OpenAI-compatible 和 proxy route |
| Z.AI / GLM | 内置 endpoint 和 proxy route |
| Google Gemini | 内置 Gemini API profile |
| OpenRouter | 内置 OpenRouter profile |
| Azure OpenAI | 内置 Azure profile |
| Custom endpoint | 自带兼容 base URL |

VibeAround 的本地 API proxy 由 [va-ai-api-proxy](https://github.com/jazzenchen/va-ai-api-proxy) 驱动，重点打通常见 Agent API 形态：

| API 形态 | 常见 endpoint |
|---|---|
| OpenAI Responses | `/v1/responses` |
| OpenAI Chat Completions | `/v1/chat/completions` |
| Anthropic Messages | `/v1/messages` |
| Gemini Generate Content | `/v1beta/models/{model}:generateContent` |

## 频道插件

每个 IM 频道都是独立的 Node.js 插件，基于 [@vibearound/plugin-channel-sdk](https://www.npmjs.com/package/@vibearound/plugin-channel-sdk) 构建。官方插件可在首次引导中安装。

| 频道 | 认证方式 | 私聊 | 文件/图片 | 流式输出 |
|---|---|---|---|---|
| Telegram | Bot Token | 支持 | 支持 | 支持 |
| 飞书 / Lark | 应用凭证 | 支持 | 支持 | 支持 |
| Discord | Bot Token | 支持 | 支持 | 支持 |
| Slack | Bot + App Token | 支持 | 支持 | 支持 |
| 微信 | 二维码登录 | 支持 | 支持 | 不支持 |
| 钉钉 | AppKey + Secret | 支持 | 支持 | 支持 |
| 企业微信 | Bot ID + Secret | 支持 | 支持 | 支持 |
| QQ Bot | App ID + Token | 支持 | 支持 | 不支持 |

## 安全模型

- Daemon 默认只监听本机 loopback：`127.0.0.1:12358`。
- Dashboard API 和 WebSocket 路由使用本地 auth token。
- 公网 tunnel URL 需要浏览器配对。
- Preview 链接短时有效，并绑定到对应 preview session。
- Provider 凭证保存在本地 VibeAround settings/profile storage 中。

## 用户快速开始

1. 下载适合你平台的最新安装包。
2. 打开 VibeAround，完成首次引导。
3. 启用你需要的 Agent 和频道插件。
4. 添加一个或多个模型 Provider Profile。
5. 从桌面应用 Quick Launch 启动，或打开 Web Dashboard 使用 Web Chat、Web Terminal 和预览。

更详细的步骤请看 [安装指南](https://github.com/jazzenchen/VibeAround/wiki/Setup-Guide-CN)。

## 本地开发

```bash
# 拉取本地 API 转换需要的 va-ai-api-proxy submodule
git submodule update --init --recursive
cd src
bun install
bun run prebuild

# 启动 Tauri 桌面开发环境
bun run dev
```

如果 clone 时没有使用 `--recurse-submodules`，第一行会拉取 `src/va-ai-api-proxy`，它提供 VibeAround 的 AI API 转换能力。

环境要求：Rust 1.82+、推荐 Node.js 24 LTS、Bun 1.3+。macOS 还需要执行 `xcode-select --install`；Linux 需要安装发行版对应的 WebKitGTK/Tauri 系统依赖。

## 斜杠命令

| 命令 | 说明 |
|---|---|
| `/help` | 显示可用命令 |
| `/new` | 重置会话，开始新的对话 |
| `/switch <agent>` | 在对话中切换 Agent |
| `/profile <name>` | 切换 Profile |
| `/close` | 关闭当前对话 |
| `/handover` | 导出当前会话，以便在其他入口继续 |
| `/pickup <code>` | 恢复从其他频道移交的会话 |
| `/agent <command>` | 向底层 Agent 发送斜杠命令，例如 `/agent status` |

在 Slack 中，`/` 前缀会被客户端拦截，请改用 `/va` 或 `/vibearound`，例如 `/va switch claude`。

## 文档

- [安装指南](https://github.com/jazzenchen/VibeAround/wiki/Setup-Guide-CN)
- [产品入口](https://github.com/jazzenchen/VibeAround/wiki/Product-Surfaces-CN)
- [支持的 Agent](https://github.com/jazzenchen/VibeAround/wiki/Supported-Agents-CN)
- [Model Profiles 与 Agent Launch](https://github.com/jazzenchen/VibeAround/wiki/Model-Profiles-and-Agent-Launch-CN)
- [频道插件](https://github.com/jazzenchen/VibeAround/wiki/Channel-Plugins-CN)
- [配置模型](https://github.com/jazzenchen/VibeAround/wiki/Configuration-Model-CN)
- [隧道配置](https://github.com/jazzenchen/VibeAround/wiki/Tunnel-Configuration-CN)
- [认证与访问控制](https://github.com/jazzenchen/VibeAround/wiki/Authentication-CN)
- [架构说明](https://github.com/jazzenchen/VibeAround/wiki/Architecture-CN)
- [构建与打包](https://github.com/jazzenchen/VibeAround/wiki/Build-and-Packaging-CN)
- [FAQ 和故障排除](https://github.com/jazzenchen/VibeAround/wiki/FAQ-and-Troubleshooting-CN)

## 社区

提问、交流想法，或者聊聊你如何使用 VibeAround。

[![Discord](https://img.shields.io/badge/Discord-Join%20VibeAround-5865F2?logo=discord&logoColor=white)](https://discord.gg/KsJWkY64GN)
[![Product Hunt](https://img.shields.io/badge/Product%20Hunt-Follow%20VibeAround-DA552F?logo=producthunt&logoColor=white)](https://www.producthunt.com/products/vibearound)

中文交流微信群：

<img src="docs/assets/wechat-group-qr.jpeg" width="180" alt="VibeAround 微信群二维码" />

微信群二维码会周期性过期。如果图片失效，可以通过 Discord 或 GitHub Issues 索取最新二维码。

## 许可证

[MIT](LICENSE)
