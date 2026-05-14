<div align="center">

# VibeAround

**让本地 Coding Agent 出现在你工作的每个入口。**

[下载](https://github.com/jazzenchen/VibeAround/releases/latest) | [演示](https://youtu.be/6kxNKTMz-AM) | [Wiki](https://github.com/jazzenchen/VibeAround/wiki) | [English](README.md)

<p align="center">
  <img src="https://img.shields.io/badge/Rust-1.82+-000?style=flat-square&logo=rust&logoColor=fff" alt="Rust" />
  <img src="https://img.shields.io/badge/Tauri-2.10-24C8DB?style=flat-square&logo=tauri&logoColor=fff" alt="Tauri" />
  <img src="https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react&logoColor=000" alt="React" />
  <img src="https://img.shields.io/badge/ACP-Rust_SDK-000?style=flat-square" alt="ACP" />
  <img src="https://img.shields.io/badge/License-MIT-blue?style=flat-square" alt="License: MIT" />
</p>

</div>

VibeAround 把你的电脑变成本地优先的 AI 编程控制中心。Claude Code、Codex CLI、Gemini CLI、Cursor CLI、Kiro CLI、Qwen Code、OpenCode 仍然运行在你的项目和工具链旁边，但你可以从桌面应用、浏览器终端，甚至手机 IM 里进入它们。

它面向的是日常 agentic coding 里那些真实而琐碎的循环：在正确 workspace 启动正确 Agent，不改全局配置就切换 provider，桥接不兼容的 AI API 格式，把正在运行的会话接力到手机，打开本地预览链接，然后继续往前推进。

## 界面截图

| 模型配置 | 频道插件 |
|---|---|
| <img src="https://pub-806a1b8456464ce7a6c110f84946697e.r2.dev/documents/v0.5.12/screenshots/cn-profiles.webp" alt="VibeAround 模型配置" width="100%" /> | <img src="https://pub-806a1b8456464ce7a6c110f84946697e.r2.dev/documents/v0.5.12/screenshots/cn-channels.webp" alt="VibeAround 频道插件" width="100%" /> |

## 你可以用它做什么

### 启动本地 Coding Agent

在正确 workspace 里，用正确的 provider profile 启动 Claude Code、Codex CLI、Gemini CLI、OpenCode 等 Agent。

### 打通 AI API 格式

让 DeepSeek、阿里云百炼、Kimi、MiniMax、Z.AI/GLM 等 provider 接入你喜欢的本地 Coding Agent，即使它们的 API 格式并不一样。

### 从桌面、浏览器或 IM 对话

从桌面应用、浏览器终端、Telegram、飞书/Lark、Discord、Slack、微信、钉钉、企业微信或 QQ Bot 访问同一个本地 Agent。

### 接力会话和预览

用 `/handover` 和 `/pickup` 在电脑和手机之间移动实时会话，也可以把本地开发服务、Markdown 或 HTML 预览生成带鉴权的短时链接。

## 演示视频

[![VibeAround 演示视频 - 会话接力、Agent 切换、多频道并发](https://img.youtube.com/vi/6kxNKTMz-AM/maxresdefault.jpg)](https://youtu.be/6kxNKTMz-AM)

*在 IM 中直达本地 Agent，在终端与手机之间接力会话，并在对话中切换 Agent。*

## 下载 VibeAround

最新版本是 [VibeAround v0.5.16](https://github.com/jazzenchen/VibeAround/releases/tag/v0.5.16)。

| 平台 | 推荐下载 |
|---|---|
| macOS Apple Silicon | [VibeAround_0.5.16_arm64.dmg](https://github.com/jazzenchen/VibeAround/releases/download/v0.5.16/VibeAround_0.5.16_arm64.dmg) |
| Windows x64 | [Setup EXE](https://github.com/jazzenchen/VibeAround/releases/download/v0.5.16/VibeAround_0.5.16_x64-setup.exe)、[MSI](https://github.com/jazzenchen/VibeAround/releases/download/v0.5.16/VibeAround_0.5.16_x64_en-US.msi) 或 [免安装 ZIP](https://github.com/jazzenchen/VibeAround/releases/download/v0.5.16/VibeAround-win-0.5.16-portable.zip) |
| Linux x64 | [AppImage](https://github.com/jazzenchen/VibeAround/releases/download/v0.5.16/VibeAround_0.5.16_amd64.AppImage) 或 [deb](https://github.com/jazzenchen/VibeAround/releases/download/v0.5.16/VibeAround_0.5.16_amd64.deb) |

macOS 当前发布 Apple Silicon 版本。Windows 和 Linux 桌面包由 GitHub Actions 构建；macOS DMG 已签名并完成 notarization。

## 支持能力

### Coding agents

Agent 通过 [ACP (Agent Client Protocol)](https://agentclientprotocol.com/) 在 stdio 上通信。需要 npm 分发 bridge 时，VibeAround 会按需安装。

| Agent | IM 对话 | 会话接力 | Launch profile |
|---|---|---|---|
| Claude Code | ✅ | ✅ | ✅ |
| Codex CLI | ✅ | ✅ | ✅ |
| Gemini CLI | ✅ | ✅ | 直接启动 |
| Cursor CLI | ✅ | ✅ | 直接启动 |
| Kiro CLI | ✅ | ✅ | 直接启动 |
| Qwen Code | ✅ | ✅ | 直接启动 |
| OpenCode | ✅ | ❌ | 直接启动 |

### Model providers 和 proxy 路由

Provider profile 让本地 Agent 可以连接官方 API、OpenAI-compatible endpoint 或经过转换的 proxy route，而不用手动改 CLI 配置文件。

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

VibeAround 的本地 API proxy 由 [va-ai-api-proxy](https://github.com/jazzenchen/va-ai-api-proxy) 驱动，重点打通三种常见 Agent API 形态：

| API 形态 | 常见 endpoint |
|---|---|
| OpenAI Responses | `/v1/responses` |
| OpenAI Chat Completions | `/v1/chat/completions` |
| Anthropic Messages | `/v1/messages` |

### 频道插件

每个 IM 频道都是独立的 Node.js 插件，基于 [@vibearound/plugin-channel-sdk](https://www.npmjs.com/package/@vibearound/plugin-channel-sdk) 构建。官方插件可在首次引导中安装。

| 频道 | 认证方式 | 私聊 | 文件/图片 | 流式输出 |
|---|---|---|---|---|
| Telegram | Bot Token | ✅ | ✅ | ✅ |
| 飞书 / Lark | 应用凭证 | ✅ | ✅ | ✅ |
| Discord | Bot Token | ✅ | ✅ | ✅ |
| Slack | Bot + App Token | ✅ | ✅ | ✅ |
| 微信 | 二维码登录 | ✅ | ✅ | ❌ |
| 钉钉 | AppKey + Secret | ✅ | ✅ | ✅ |
| 企业微信 | Bot ID + Secret | ✅ | ✅ | ✅ |
| QQ Bot | App ID + Token | ✅ | ✅ | ❌ |

## 文档

- [安装指南](https://github.com/jazzenchen/VibeAround/wiki/Setup-Guide-CN)
- [产品入口](https://github.com/jazzenchen/VibeAround/wiki/Product-Surfaces-CN)
- [Model Profiles 与 Agent Launch](https://github.com/jazzenchen/VibeAround/wiki/Model-Profiles-and-Agent-Launch-CN)
- [频道插件](https://github.com/jazzenchen/VibeAround/wiki/Channel-Plugins-CN)
- [配置模型](https://github.com/jazzenchen/VibeAround/wiki/Configuration-Model-CN)
- [构建与打包](https://github.com/jazzenchen/VibeAround/wiki/Build-and-Packaging-CN)
- [FAQ 和故障排除](https://github.com/jazzenchen/VibeAround/wiki/FAQ-and-Troubleshooting-CN)

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
| `/profile <name>` | 切换 profile |
| `/close` | 关闭当前对话 |
| `/handover` | 导出当前会话，以便在其他入口继续 |
| `/pickup <code>` | 恢复从其他频道移交的会话 |
| `/agent <command>` | 向底层 Agent 发送斜杠命令，例如 `/agent status` |

在 Slack 中，`/` 前缀会被客户端拦截，请改用 `/va` 或 `/vibearound`，例如 `/va switch claude`。

## 社区

提问、交流想法，或者聊聊你如何使用 VibeAround。

<img src="https://pub-806a1b8456464ce7a6c110f84946697e.r2.dev/wechat-group-compressed.webp" width="150" alt="VibeAround 微信群二维码" />

## 许可证

[MIT](LICENSE)
