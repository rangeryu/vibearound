<div align="center">

<img src="https://pub-806a1b8456464ce7a6c110f84946697e.r2.dev/documents/v0.1/banner.webp" width="100%" alt="VibeAround - 你的本地 AI Agent，随时随地 vibe coding" />

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

它面向的是日常 agentic coding 里那些真实而琐碎的循环：在正确 workspace 启动正确 Agent，不改全局配置就切换 provider，把正在运行的会话接力到手机，打开本地预览链接，然后继续往前推进。

## 你可以用它做什么

### 一键启动 Coding Agent

从指定 workspace 启动支持的 CLI，直接运行 Claude Code、Codex、Gemini CLI、OpenCode 等 Agent。遇到需要兼容层的 provider 时，也可以让兼容 Agent 走 VibeAround 的本地 API proxy。

### Provider profile 跟着启动走

保存 DeepSeek、Azure OpenAI、Gemini、Moonshot/Kimi、OpenRouter、MiniMax、Z.AI/GLM 或自定义 endpoint 的 profile。不同 profile 可以并行使用，不需要反复修改 CLI 的全局配置。

### 在 IM 里和本地 Agent 对话

通过 Telegram、飞书/Lark、Discord、Slack、微信、钉钉、企业微信或 QQ Bot 和同一个本地 Agent 对话。Agent 可以改代码、跑命令、启动开发服务，并把过程流式返回到聊天里。

### 在多个入口之间移动会话

使用 `/handover` 和 `/pickup` 在终端、浏览器和 IM 之间移动同一个实时会话。你可以从电脑开始，在手机上接着处理，再回到桌面继续，不必重建上下文。

### 浏览器终端和可分享预览

从浏览器打开完整 shell，移动端也有 ESC、Ctrl、方向键等终端快捷输入。本地开发服务器、Markdown 和 HTML 预览可以生成带鉴权的短时链接，方便在手机或另一台设备上打开。

## 下载 VibeAround

最新版本是 [VibeAround v0.5.5](https://github.com/jazzenchen/VibeAround/releases/tag/v0.5.5)。

| 平台 | 推荐下载 |
|---|---|
| macOS Apple Silicon | [VibeAround_0.5.5_arm64.dmg](https://github.com/jazzenchen/VibeAround/releases/download/v0.5.5/VibeAround_0.5.5_arm64.dmg) |
| Windows x64 | [Setup EXE](https://github.com/jazzenchen/VibeAround/releases/download/v0.5.5/VibeAround_0.5.5_x64-setup.exe)、[MSI](https://github.com/jazzenchen/VibeAround/releases/download/v0.5.5/VibeAround_0.5.5_x64_en-US.msi) 或 [免安装 ZIP](https://github.com/jazzenchen/VibeAround/releases/download/v0.5.5/VibeAround-win-0.5.5-portable.zip) |
| Linux x64 | [AppImage](https://github.com/jazzenchen/VibeAround/releases/download/v0.5.5/VibeAround_0.5.5_amd64.AppImage) 或 [deb](https://github.com/jazzenchen/VibeAround/releases/download/v0.5.5/VibeAround_0.5.5_amd64.deb) |

macOS 当前发布 Apple Silicon 版本。Windows 和 Linux 桌面包由 GitHub Actions 构建；macOS DMG 已签名并完成 notarization。

## 演示视频

[![VibeAround 演示视频 - 会话接力、Agent 切换、多频道并发](https://img.youtube.com/vi/6kxNKTMz-AM/maxresdefault.jpg)](https://youtu.be/6kxNKTMz-AM)

*在 IM 中直达本地 Agent，在终端与手机之间接力会话，并在对话中切换 Agent。*

## 支持能力

### Coding agents

Agent 通过 [ACP (Agent Client Protocol)](https://agentclientprotocol.com/) 在 stdio 上通信。需要 npm 分发 bridge 时，VibeAround 会按需安装。

| Agent | IM 对话 | 会话接力 | Launch profile |
|---|---|---|---|
| Claude Code | 支持 | 支持 | 支持 |
| Codex CLI | 支持 | 支持 | 支持 |
| Gemini CLI | 支持 | 支持 | 直接启动 |
| Cursor CLI | 支持 | 支持 | 直接启动 |
| Kiro CLI | 支持 | 支持 | 直接启动 |
| Qwen Code | 支持 | 支持 | 直接启动 |
| OpenCode | 支持 | 暂不支持 | 直接启动 |

### 频道插件

每个 IM 频道都是独立的 Node.js 插件，基于 [@vibearound/plugin-channel-sdk](https://www.npmjs.com/package/@vibearound/plugin-channel-sdk) 构建。官方插件可在首次引导中安装。

| 频道 | 认证方式 | 私聊 | 文件/图片 | 流式输出 |
|---|---|---|---|---|
| Telegram | Bot Token | 支持 | 支持 | 支持 |
| 飞书 / Lark | 应用凭证 | 支持 | 支持 | 支持 |
| Discord | Bot Token | 支持 | 支持 | 支持 |
| Slack | Bot + App Token | 支持 | 支持 | 支持 |
| 微信 | 二维码登录 | 支持 | 支持 | 暂不支持 |
| 钉钉 | AppKey + Secret | 支持 | 支持 | 支持 |
| 企业微信 | Bot ID + Secret | 支持 | 支持 | 支持 |
| QQ Bot | App ID + Token | 支持 | 支持 | 暂不支持 |

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
cd src
bun install
bun run prebuild
bun run dev
```

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

## 许可证

[MIT](LICENSE)
