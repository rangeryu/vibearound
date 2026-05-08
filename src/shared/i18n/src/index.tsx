import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export const LOCALES = ["en", "zh-CN"] as const;
export type Locale = (typeof LOCALES)[number];

export const LOCALE_LABELS: Record<Locale, string> = {
  en: "English",
  "zh-CN": "简体中文",
};

const STORAGE_KEY = "vibearound.locale";

type Params = Record<string, string | number | null | undefined>;

const zhCN: Record<string, string> = {
  // Shared
  Language: "语言",
  English: "English",
  "Simplified Chinese": "简体中文",
  Loading: "加载中",
  "Loading…": "加载中…",
  Refresh: "刷新",
  Start: "启动",
  Stop: "停止",
  Cancel: "取消",
  Back: "返回",
  Next: "下一步",
  Confirm: "确认",
  Save: "保存",
  "Get Started": "开始",
  "Save changes": "保存更改",
  "Create profile": "创建配置",
  "Saving…": "保存中…",
  Edit: "编辑",
  Delete: "删除",
  More: "更多",
  Restore: "恢复",
  Maximize: "最大化",
  "Close session": "关闭会话",
  Unavailable: "不可用",
  current: "当前",
  "not installed": "未安装",

  // Desktop dashboard
  Running: "运行中",
  Spawning: "启动中",
  "Not started": "未启动",
  Stopped: "已停止",
  Crashed: "已崩溃",
  Failed: "失败",
  Busy: "忙碌",
  Idle: "空闲",
  Status: "状态",
  Tunnel: "隧道",
  Agents: "Agent",
  Channels: "频道",
  Launch: "启动",
  Previews: "预览",
  Workspaces: "工作区",
  Live: "实时",
  Polling: "轮询中",
  "Server failed to start": "服务器启动失败",
  Retry: "重试",
  "Open Config Wizard": "打开配置向导",
  "Open Web Dashboard": "打开 Web 控制台",
  "Runtime health for tunnels, agents, and messaging channels.":
    "查看隧道、Agent 和消息频道的运行状态。",
  "No tunnel running": "没有运行中的隧道",
  "No agents running": "没有运行中的 Agent",
  "No channels running": "没有运行中的频道",
  "retry {{seconds}}s": "{{seconds}} 秒后重试",
  "Tunnel ({{provider}})": "隧道（{{provider}}）",
  "Stopped {{name}}": "已停止 {{name}}",
  "Restarting {{name}}": "正在重启 {{name}}",

  // Launch
  "One-click coding agent in your Terminal": "一键在终端启动 Coding Agent",
  "New profile": "新建配置",
  "New workspace": "新建工作区",
  "Quick launch": "快速启动",
  "Launch the default CLI": "启动默认 CLI",
  "Launch {{agent}} directly": "直接启动 {{agent}}",
  "Launch {{agent}} with {{profile}}": "用 {{profile}} 启动 {{agent}}",
  "Terminal opened for {{profile}}": "已为 {{profile}} 打开终端",
  "{{agent}} launched (no env injected)": "{{agent}} 已启动（未注入环境变量）",
  "Quick launch opened": "已打开快速启动",
  "Resume launch opened": "已打开恢复启动",
  "Resume Session": "恢复会话",
  Session: "会话",
  "Session resume unavailable": "会话恢复不可用",
  "{{agent}} does not support selecting a session to resume":
    "{{agent}} 不支持选择会话恢复",
  "Launch with selected profile, workspace, and session":
    "使用所选配置、工作区和会话启动",
  "Selected profile is missing": "所选配置不存在",
  "No session to resume": "没有可恢复的会话",
  "No launch agents enabled": "没有启用可启动的 agent",
  "Loading launch settings": "正在读取启动设置",
  "Launch is already in progress": "正在启动中",
  "VibeAround default updated": "已更新 VibeAround 默认项",
  Disabled: "已禁用",
  "None selected": "未选择",
  "Direct profile is fixed": "直接启动固定在顶部",
  "Direct profile cannot be edited or deleted": "直接启动不能编辑或删除",
  "Default workspace is fixed": "默认工作区是固定的",
  "Default workspace cannot be edited or deleted": "默认工作区不能编辑或删除",
  "This item cannot be reordered": "此项不能拖拽排序",
  "Reordering unavailable while launching": "启动中暂时不能排序",
  "No actions available": "没有可用操作",
  "Quick Launch will start a new session": "快速启动会开启新会话",
  "Use existing CLI login": "使用 CLI 已有登录态",
  "Native CLI login": "CLI 原生登录",
  Direct: "直接",
  "Proxy on": "代理开启",
  Proxy: "代理",
  "Set default": "设为默认",
  "Set app default": "设为应用默认",
  "Manual config": "手动配置",
  "Proxy settings": "代理设置",
  "{{count}} sessions": "{{count}} 个会话",
  "{{label}} (not installed)": "{{label}}（未安装）",
  "For {{workspace}}": "{{workspace}} 下",
  "Last session": "最近会话",
  "just now": "刚刚",
  "{{count}} min ago": "{{count}} 分钟前",
  "{{count}} h ago": "{{count}} 小时前",
  "{{count}} d ago": "{{count}} 天前",
  "No session in this workspace": "此工作区暂无会话",
  "Show archived": "显示已归档",
  Archived: "已归档",
  "Quick Launch default updated": "已更新快速启动默认配置",
  "Direct Quick Launch default updated": "已更新直接快速启动默认项",
  "Profile order updated": "配置顺序已更新",
  "Profile deleted": "已删除配置",
  "Workspace order updated": "工作区顺序已更新",
  "Workspace removed": "已移除工作区",
  'Delete workspace "{{label}}"?': "删除工作区「{{label}}」？",
  "No profiles yet": "还没有配置",
  "Add your provider's API key once. From then on it's one click to launch claude or codex with that key already wired up — VibeAround opens a fresh Terminal window and stays out of the way.":
    "只需保存一次服务商 API key，之后一键即可用该 key 启动 Claude 或 Codex。VibeAround 会打开新的终端窗口，其余交给 CLI 自己运行。",
  "Add your first profile": "添加第一个配置",
  "Direct launch": "直接启动",
  "Direct launch stays pinned above profiles":
    "直接启动固定显示在配置上方",
  "No profile — uses each CLI's existing login session":
    "不使用配置，沿用各 CLI 已有登录会话",
  "Use {{agent}} as Quick Launch default without a profile":
    "将 {{agent}} 设为不使用配置的快速启动默认项",
  "Edit profile · {{label}}": "编辑配置 · {{label}}",
  "Pick a provider": "选择服务商",
  "New profile · {{provider}}": "新建配置 · {{provider}}",
  "Configure a Quick Launch provider profile.": "配置快速启动的服务商凭据。",
  "The provider {{provider}} is no longer in the catalog. Form fell back to a custom endpoint — re-pick a provider via Back, or edit the URL/key and save.":
    "服务商 {{provider}} 已不在 catalog 中。表单已回退到自定义 endpoint，你可以返回重新选择服务商，或编辑 URL/key 后保存。",
  "Label is required": "必须填写名称",
  "Pick at least one API type": "至少选择一种 API 类型",
  "{{field}} is required": "必须填写 {{field}}",
  "Model is required for {{apiType}}": "{{apiType}} 必须填写模型",
  "Base URL is required for {{apiType}}": "{{apiType}} 必须填写 Base URL",
  Profile: "配置",
  Label: "名称",
  "Visible name for this profile.": "这个配置的显示名称。",
  Credentials: "凭据",
  "Model settings": "模型设置",
  Endpoint: "Endpoint",
  "Base URL": "Base URL",
  "Leave blank to use the catalog default.": "留空则使用 catalog 默认值。",
  "Required for custom endpoints.": "自定义 endpoint 必填。",
  "Endpoint URL from the provider dashboard.":
    "服务商控制台里的 endpoint URL。",
  "Deployment name": "部署名称",
  Model: "模型",
  "Select a model": "选择模型",
  "model id (e.g. gpt-4o, claude-sonnet-4-6)":
    "模型 id（例如 gpt-4o、claude-sonnet-4-6）",
  "Reasoning effort": "推理强度",
  "DeepSeek proxy": "DeepSeek 代理",
  "Thinking mode": "Thinking 模式",
  "Replay reasoning content": "回放 reasoning content",
  "API kinds": "API 类型",
  "Endpoint type": "Endpoint 类型",
  "Select every API shape this endpoint supports.":
    "选择这个 endpoint 支持的所有 API 形态。",
  Hide: "隐藏",
  Reveal: "显示",
  "Search providers": "搜索服务商",
  "Preset providers": "预设服务商",
  "No providers found. The catalog ships with the desktop binary; if you see this, the install is broken.":
    "未找到服务商。Catalog 随桌面应用一起发布，如果看到这条消息，说明安装已损坏。",
  "No matching providers": "没有匹配的服务商",
  Custom: "自定义",
  "Custom endpoint": "自定义 endpoint",
  "Bring your own URL + key": "使用自己的 URL 和 key",
  "Use API key": "使用 API key",
  "API key": "API key",
  "Used by Codex and OpenCode for reasoning/tools. Must be an Azure deployment that supports the Responses API.":
    "Codex 和 OpenCode 会用它处理 reasoning/tools。必须是支持 Responses API 的 Azure 部署。",
  "Chat Completions fallback for CLIs/providers that cannot use Responses.":
    "给不支持 Responses 的 CLI/服务商使用的 Chat Completions 回退方案。",
  "Anthropic API": "Anthropic API",
  "OpenAI-compatible Chat": "OpenAI 兼容 Chat",
  "OpenAI Responses": "OpenAI Responses",
  "Gemini API": "Gemini API",
  "Terminal app": "终端应用",
  "API proxy": "API 代理",
  Auto: "自动",
  "Force on": "强制开启",
  Off: "关闭",
  "Launch settings": "启动设置",
  "Terminal: {{terminal}}": "终端：{{terminal}}",
  "API proxy: {{mode}}": "API 代理：{{mode}}",
  Workspace: "工作区",
  "Choose Launch Workspace": "选择启动工作区",
  "Choose folder...": "选择文件夹...",
  "Choose launch workspace": "选择启动工作区",
  "Use {{agent}} with {{profile}} as Quick Launch default":
    "将 {{agent}} + {{profile}} 设为快速启动默认项",
  "Launch {{agent}} via {{apiType}}": "通过 {{apiType}} 启动 {{agent}}",
  "Click to launch {{agent}} via {{apiType}} anyway.":
    "仍然通过 {{apiType}} 启动 {{agent}}。",
  "Connection settings": "连接设置",
  "{{label}} Connections": "{{label}} 连接",
  "Choose how Claude Code and Codex CLI connect through this profile.":
    "选择 Claude Code 和 Codex CLI 如何通过这个配置连接。",
  "Choose how coding agents connect through this profile.":
    "选择 Coding Agent 如何通过这个配置连接。",
  "Client API: {{protocol}}": "客户端 API：{{protocol}}",
  Native: "原生",
  "Via proxy": "通过代理",
  Unsupported: "不支持",
  Optional: "可选",
  as: "作为",
  "Requires {{protocol}}": "需要 {{protocol}}",
  "Default route": "默认路径",
  "Selected route": "已选路径",
  "Enable proxy": "启用代理",
  'Enable proxy for "{{profile}}" to launch {{agent}} with {{api}}':
    "为「{{profile}}」启用代理后可用 {{api}} 启动 {{agent}}",
  "Proxy target": "代理目标",
  "Anthropic Messages": "Anthropic Messages",
  "OpenAI Chat Completions": "OpenAI Chat Completions",
  Anthropic: "Anthropic",
  Responses: "Responses",
  "{{clientApi}} -> {{targetApi}} (proxy off)":
    "{{clientApi}} -> {{targetApi}}（代理关闭）",
  "Fake model id": "伪装模型 ID",
  "Proxy model": "代理模型",
  "Select model": "选择模型",
  Headers: "请求头",
  "Default headers": "默认请求头",
  "Append headers": "追加请求头",
  "Add header": "添加请求头",
  "Remove header": "移除请求头",
  "Configure proxy headers.": "配置代理请求头。",
  "Setup guide": "配置指南",
  "Manual setup": "手动配置",
  "Click a value to copy.": "点击字段值即可复制。",
  "Use any non-empty API key value when the local proxy is already running with a saved profile key.":
    "本地代理已使用保存的配置 key 运行时，API key 填任意非空值即可。",
  Copied: "已复制",
  "Manual setting": "手动配置",
  "{{agent}} manual setting": "{{agent}} 手动配置",
  "Copy this snippet into the CLI config file yourself. VibeAround does not edit the file automatically.":
    "把这段配置自行粘贴到 CLI 配置文件里。VibeAround 不会自动改写文件。",
  "Configuration file": "配置文件",
  "How to modify": "修改方法",
  "Open the Codex config file, then add this snippet or update the existing VibeAround profile block.":
    "打开 Codex 配置文件，添加这段配置，或更新已有的 VibeAround 配置块。",
  "Open the OpenCode config file, then add or merge this provider block.":
    "打开 OpenCode 配置文件，然后添加或合并这段 provider 配置。",
  "The top-level profile line makes plain codex use this VibeAround profile by default.":
    "顶层 profile 配置项会让直接运行 codex 时默认使用这个 VibeAround 配置。",
  "Paste this property inside the root JSON object of Claude settings.":
    "把这个属性粘贴到 Claude settings 的根 JSON 对象里。",
  "If env already exists, merge these keys into the existing env object instead of creating another env block.":
    "如果已经有 env，请把这些 key 合并到已有 env 对象里，不要再创建第二个 env。",
  "Config snippet": "配置片段",
  "Codex config snippet": "Codex 配置片段",
  "OpenCode config snippet": "OpenCode 配置片段",
  "Copy config": "复制配置",
  "Header name is required for {{context}}":
    "{{context}} 的请求头名称不能为空",
  "Header value is required for {{context}} header {{name}}":
    "{{context}} 的请求头 {{name}} 必须填写值",
  "Header {{name}} is not a valid HTTP header name":
    "请求头 {{name}} 不是有效的 HTTP header 名称",
  "Header {{name}} value cannot contain line breaks":
    "请求头 {{name}} 的值不能包含换行",
  "Header {{name}} is managed by the proxy":
    "请求头 {{name}} 由代理管理，不能自定义",
  "Header {{name}} is already provided by {{context}}":
    "请求头 {{name}} 已由 {{context}} 提供",
  "Header {{name}} is duplicated for {{context}}":
    "{{context}} 中重复配置了请求头 {{name}}",
  "via proxy": "通过代理",
  unsupported: "不支持",
  "{{agent}} routes through proxy to {{provider}} {{apiType}}":
    "{{agent}} 通过代理连接到 {{provider}} {{apiType}}",
  '"{{profile}}" does not support {{agent}} yet':
    '"{{profile}}" 暂时不支持 {{agent}}',
  "{{agent}} is unsupported for this profile": "这个配置不支持 {{agent}}",
  'Delete profile "{{label}}"?': "删除配置「{{label}}」？",
  "Reorder {{label}}": "重新排序 {{label}}",

  // Onboarding
  Goals: "目标",
  Welcome: "欢迎",
  "Quick Launch": "快速启动",
  "Welcome to VibeAround": "欢迎使用 VibeAround",
  "Let's set things up so you can vibe code from anywhere. This will only take a minute — configure your agents, messaging channels, and tunnel.":
    "先完成几个简单设置，你就可以从任何地方 vibe code。只需一分钟，配置 Agent、消息频道和隧道即可。",
  "How will you use VibeAround?": "你打算如何使用 VibeAround？",
  "Choose what you want to set up now. You can change this later at any time, so skip anything you're unsure about.":
    "选择现在要配置的部分。之后可以随时修改，不确定的内容先跳过也没关系。",
  "Coding agent launch": "Coding Agent 启动",
  "Launch Claude, Codex, and other CLIs quickly":
    "快速启动 Claude、Codex 等 CLI",
  "Use multiple provider profiles": "使用多个服务商配置",
  "Route clients through the local API proxy":
    "通过本地 API proxy 转发客户端请求",
  "IM integration": "IM 对接",
  "Connect messaging platforms and bot plugins": "连接消息平台和 bot 插件",
  "Start and continue coding sessions from your phone":
    "从手机发起和接管 coding session",
  "Use QR login and plugin-specific settings": "支持扫码登录和插件配置",
  "Expose local webhooks and remote access when needed":
    "按需暴露本地 webhook 和远程访问",
  "Use Cloudflare, ngrok, or localtunnel":
    "支持 Cloudflare、ngrok、localtunnel",
  "Skip this when you only work locally": "只在本机使用时可以跳过",
  "Step {{current}} of {{total}} — {{step}}":
    "第 {{current}} / {{total}} 步 — {{step}}",
  "Continue Anyway": "仍然继续",
  "Open VibeAround": "打开 VibeAround",
  "Confirming…": "确认中…",
  "Pick the CLI VibeAround should start from Launch and IM messages.":
    "选择 VibeAround 在启动页和 IM 消息中默认启动的 CLI。",
  "Best recommended": "推荐选择",
  "Other CLIs": "其他 CLI",
  "API profiles": "API 配置",
  "Optional. Save API keys now; choose launch defaults later in Launch.":
    "可选。现在保存 API key，之后在启动页选择默认启动项。",
  "Add API profile": "添加 API 配置",
  "No API profiles yet. You can add one now or skip this step.":
    "还没有 API 配置。你可以现在添加，也可以跳过这一步。",
  "Default workspace": "默认工作区",
  "IM Channels": "IM 频道",
  "Connect messaging bots to vibe code from your phone. Install plugins from the registry, then configure and enable them.":
    "连接消息机器人后，就能在手机上 vibe code。先从 registry 安装插件，然后配置并启用。",
  "View on GitHub": "在 GitHub 查看",
  Installing: "安装中",
  "Installing…": "安装中…",
  Install: "安装",
  "QR Login": "二维码登录",
  "Generate a QR code, scan it with the app, then wait for authorization.":
    "生成二维码，用对应 App 扫描，然后等待授权。",
  Reconnect: "重新连接",
  "Waiting…": "等待中…",
  Connect: "连接",
  "QR code": "二维码",
  "Scan with the app and confirm on your phone.":
    "用 App 扫码，并在手机上确认。",
  "Expose your local server to the internet for IM webhooks and remote access. Skip if you only use it locally.":
    "将本地服务暴露到互联网，用于 IM webhook 和远程访问。如果只本地使用，可以跳过。",
  Recommended: "推荐",
  "Auth Token": "Auth Token",
  "Domain (optional)": "域名（可选）",
  "Tunnel Token": "Tunnel Token",
  "Hostname (optional)": "主机名（可选）",
  "Ready to Launch": "准备启动",
  "Review your configuration. You can always change these in settings.json later.":
    "检查你的配置。之后仍可在 settings.json 中修改。",
  "None configured": "未配置",
  "VibeAround will add an MCP server entry to your coding agents' global settings and install a handover skill for session transfer between devices. Your existing agent settings will not be overwritten.":
    "VibeAround 会向 Coding Agent 的全局设置添加 MCP server，并安装用于跨设备转移会话的 handover skill。已有 Agent 设置不会被覆盖。",
  "Installation Cancelled": "安装已取消",
  "Installation Completed with Errors": "安装完成，但有错误",
  "Installation Complete": "安装完成",
  "Installing VibeAround": "正在安装 VibeAround",
  "Review the results below.": "查看下面的结果。",
  "Setting up your agents and plugins...": "正在设置 Agent 和插件...",
  "Collapse install log": "收起安装日志",
  "Expand install log": "展开安装日志",
  "Delete {{label}}": "删除 {{label}}",
  "Toggle {{name}}": "启用/停用 {{name}}",
  "Already authenticated.": "已完成认证。",
  "Scan the QR code.": "请扫描二维码。",
  "Connected successfully.": "连接成功。",
  "Not confirmed.": "未确认。",
  "Connection lost. Try again.": "连接丢失，请重试。",
  "Cancelled.": "已取消。",
  Cancelled: "已取消",
  "Already installed": "已安装",
  "Install complete": "安装完成",
  "Installing MCP config…": "正在安装 MCP 配置…",
  "MCP config installed": "MCP 配置已安装",
  "Skill file installed": "Skill 文件已安装",
  "Plugin not found in registry": "Registry 中未找到插件",
  "Running: git clone + npm install + build":
    "正在运行：git clone + npm install + build",
  "MCP config": "MCP 配置",
  "Skill file": "Skill 文件",
  "CLI install": "CLI 安装",
  "Plugin install": "插件安装",

  // Desktop pages
  "Active dev-server proxies and markdown previews. Owner links are permanent; share links rotate every {{minutes}} minutes.":
    "活跃的开发服务器代理和 Markdown 预览。Owner 链接长期有效，分享链接每 {{minutes}} 分钟轮换一次。",
  "No active previews. Ask your coding agent to run preview or md_preview.":
    "没有活跃预览。让你的 Coding Agent 运行 preview 或 md_preview。",
  Local: "本地",
  "Tunnel · owner": "隧道 · owner",
  "Tunnel · share": "隧道 · 分享",
  "Tunnel not running": "隧道未运行",
  "Share key expired": "分享 key 已过期",
  "Close (kills dev server)": "关闭（会终止开发服务器）",
  Close: "关闭",
  "Workspace folders where agents build projects. The built-in workspace is always the default.":
    "Agent 构建项目时使用的工作区文件夹。内置工作区始终是默认工作区。",
  "Select Workspace Folder": "选择工作区文件夹",
  Selecting: "选择中",
  "Selecting…": "选择中…",
  "Add Folder": "添加文件夹",
  "Built-in": "内置",
  Default: "默认",
  "Remove workspace": "移除工作区",
  "No workspaces configured": "未配置工作区",
  "unified runtime for ai coding agents": "面向 AI Coding Agent 的统一运行时",

  // Web dashboard
  Terminal: "终端",
  Chat: "聊天",
  "{{running}}/{{total}} active": "{{running}}/{{total}} 活跃",
  connected: "已连接",
  "Switch to light theme": "切换到浅色主题",
  "Switch to dark theme": "切换到深色主题",
  "Tab view": "标签视图",
  "Grid view": "网格视图",
  "WebSocket follows page host (tunnel works on phone)":
    "WebSocket 跟随页面 host（手机隧道可用）",
  "Tunnel: — (see desktop tray)": "隧道：—（见桌面托盘）",
  "Exit Maximized": "退出最大化",
  "{{count}} proc": "{{count}} 个进程",
  "Add CLI": "添加 CLI",
  "Add CLI session": "添加 CLI 会话",
  "New session": "新会话",
  Profiles: "配置",
  "tmux sessions": "tmux 会话",
  "session name…": "会话名…",
  "No sessions yet. Add a CLI to start.": "还没有会话。添加一个 CLI 开始。",
  RUNNING: "运行中",
  IDLE: "空闲",
  STOPPED: "已停止",
  ERROR: "错误",
  "Restore panel": "恢复面板",
  "Maximize panel": "最大化面板",
  Prompt: "输入",
  "Type text to send to terminal…": "输入要发送到终端的文本…",
  Send: "发送",
  "No messages yet": "还没有消息",
  "Send a message to start a conversation.": "发送一条消息开始对话。",
  "Chat with {{agent}}": "与 {{agent}} 聊天",
  "Send a message to start.": "发送消息开始。",
  "channel: web": "频道：web",
  "chat: {{value}}": "聊天：{{value}}",
  "agent: {{value}}": "Agent：{{value}}",
  "version: {{value}}": "版本：{{value}}",
  "sessionId: {{value}}": "会话 ID：{{value}}",
  "Using tool: {{tool}}…": "正在使用工具：{{tool}}…",
  "Error: {{error}}": "错误：{{error}}",
  "Message {{agent}}…": "给 {{agent}} 发消息…",
  "Connecting…": "连接中…",
  "Message Claude…": "给 Claude 发消息…",
  "Chat with": "聊天对象",
  "Loading sessions…": "正在加载会话…",
  "Scroll to bottom": "滚动到底部",

  // Pairing
  "Token is required.": "必须填写 token。",
  "That doesn't look like a VibeAround auth token.":
    "这看起来不像 VibeAround auth token。",
  "Pair your browser": "配对浏览器",
  "Connect this browser to your VibeAround instance.":
    "将这个浏览器连接到你的 VibeAround 实例。",
  "Generating pairing code…": "正在生成配对码…",
  "Your pairing code": "你的配对码",
  "Waiting for /pair {{code}} · {{seconds}}s":
    "等待 /pair {{code}} · {{seconds}} 秒",
  "Code expired": "配对码已过期",
  "✓ Paired! Loading dashboard…": "✓ 已配对，正在加载控制台…",
  "How to pair": "如何配对",
  "Open any IM channel connected to VibeAround.":
    "打开任意已连接 VibeAround 的 IM 频道。",
  "This page will update automatically.": "此页面会自动更新。",
  "Generate new code": "生成新的配对码",
  "I have a token — paste it": "我已有 token，直接粘贴",
  "Session auth token (from ~/.vibearound/auth.json)":
    "Session auth token（来自 ~/.vibearound/auth.json）",
  "hex token…": "hex token…",
  "Unlock dashboard": "解锁控制台",
  "VibeAround · pairing codes expire after 1 minute":
    "VibeAround · 配对码 1 分钟后过期",
};

interface I18nContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: string, params?: Params) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(() => initialLocale());

  useEffect(() => {
    if (typeof document !== "undefined") {
      document.documentElement.lang = locale;
    }
  }, [locale]);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY, next);
    }
  }, []);

  const t = useCallback(
    (key: string, params?: Params) => translate(locale, key, params),
    [locale],
  );

  const value = useMemo(
    () => ({ locale, setLocale, t }),
    [locale, setLocale, t],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const value = useContext(I18nContext);
  if (!value) {
    throw new Error("useI18n must be used inside I18nProvider");
  }
  return value;
}

export function translate(
  locale: Locale,
  key: string,
  params?: Params,
): string {
  const template = locale === "zh-CN" ? (zhCN[key] ?? key) : key;
  if (!params) return template;
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_match, name: string) => {
    const value = params[name];
    return value == null ? "" : String(value);
  });
}

function initialLocale(): Locale {
  if (typeof window !== "undefined") {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (isLocale(stored)) return stored;

    const languages = window.navigator.languages?.length
      ? window.navigator.languages
      : [window.navigator.language];
    for (const language of languages) {
      const normalized = normalizeLocale(language);
      if (normalized) return normalized;
    }
  }
  return "en";
}

function normalizeLocale(value: string | undefined): Locale | null {
  if (!value) return null;
  const lower = value.toLowerCase();
  if (lower === "zh-cn" || lower === "zh-hans" || lower.startsWith("zh-cn")) {
    return "zh-CN";
  }
  if (lower.startsWith("zh")) return "zh-CN";
  if (lower.startsWith("en")) return "en";
  return null;
}

function isLocale(value: string | null): value is Locale {
  return value === "en" || value === "zh-CN";
}
