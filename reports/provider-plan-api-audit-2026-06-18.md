# Provider Plan/API Audit

Date: 2026-06-18

Scope: Kimi, MiniMax, Volcengine, Alibaba Bailian/DashScope, GLM/Z.AI, DeepSeek, Xiaomi MiMo.

This audit uses the following hierarchy:

`provider -> product/plan/API -> region -> interface protocol -> base URL -> models -> capabilities`

Terms:

- `API` means the normal pay-as-you-go/token-metered public API product.
- `Coding Plan`, `Token Plan`, and `Agent Plan` are product or billing shapes.
- `OpenAI Chat`, `OpenAI Responses`, and `Anthropic Messages` are interface protocols under a product/plan. They are not separate plans.
- `Model discovery` means a models-list endpoint that can be called with the same base product/plan credentials.
- `Capabilities` must be attached to the endpoint/interface/model combination, not to a global model ID. The same model name can expose different image, file, web search, tool, thinking, or output behavior through different providers, plans, regions, or protocol adapters.
- Official provider documentation is the source of truth. cc-switch, the local catalog, and unauthenticated endpoint probes are reference signals only; they can identify candidates to investigate, but they must not be treated as final evidence for endpoint, model, or capability configuration.

## Model Discovery

Unauthenticated probes were used only to distinguish existing authenticated endpoints from missing routes. A `401`/auth error means the route exists but requires credentials; a `404` means the route should not be configured as a discovery endpoint.

| Provider | Product/plan | Discovery endpoint | Status | Notes |
|---|---|---|---|---|
| Kimi | Moonshot API | `GET https://api.moonshot.cn/v1/models` | Exists, auth required | OpenAI-compatible discovery. |
| Kimi | Kimi Coding API | `GET https://api.kimi.com/coding/v1/models` | Exists, auth required | OpenAI-compatible discovery. |
| Kimi | Moonshot Anthropic | `GET https://api.moonshot.cn/anthropic/v1/models` | 404 | Do not configure Anthropic discovery here. |
| MiniMax | API / Token Plan | `GET https://api.minimax.io/v1/models` | Official, auth required | OpenAI-compatible discovery. |
| MiniMax | API / Token Plan | `GET https://api.minimax.io/anthropic/v1/models` | Official, auth required | Anthropic-compatible discovery. |
| Volcengine | Ark API | `GET https://ark.cn-beijing.volces.com/api/v3/models` | Exists, auth required | OpenAI-compatible discovery. |
| Volcengine | Coding Plan | `GET https://ark.cn-beijing.volces.com/api/coding/v3/models` | Exists, auth required | OpenAI-compatible discovery. |
| Volcengine | Anthropic-compatible API | `GET https://ark.cn-beijing.volces.com/api/compatible/v1/models` | Exists, auth required | Probe confirms route exists. |
| Bailian | API, CN | `GET https://dashscope.aliyuncs.com/compatible-mode/v1/models` | Exists, auth required | OpenAI-compatible discovery. |
| Bailian | Coding Plan, CN | `GET https://coding.dashscope.aliyuncs.com/v1/models` | Exists, auth required | OpenAI-compatible discovery. |
| Bailian | Anthropic apps | `GET .../apps/anthropic/v1/models` | 404 on tested CN routes | Do not configure Anthropic discovery on `apps/anthropic`. |
| GLM/Z.AI | API | `GET https://api.z.ai/api/paas/v4/models` | Exists, auth required | Global OpenAI-compatible discovery. |
| GLM/Z.AI | API, CN | `GET https://open.bigmodel.cn/api/paas/v4/models` | Exists, auth required | CN OpenAI-compatible discovery. |
| GLM/Z.AI | Coding Plan, CN | `GET https://open.bigmodel.cn/api/coding/paas/v4/models` | Exists, auth required | Coding Plan discovery. |
| GLM/Z.AI | Anthropic | `GET https://api.z.ai/api/anthropic/v1/models` | Auth response | Route exists; verify response shape with a key before relying on it. |
| GLM/Z.AI | Anthropic, CN | `GET https://open.bigmodel.cn/api/anthropic/v1/models` | Auth response | Route exists; verify response shape with a key before relying on it. |
| DeepSeek | API | `GET https://api.deepseek.com/models` | Official, auth required | Official example returns `deepseek-v4-flash` and `deepseek-v4-pro`. |
| MiMo | API | `GET https://api.xiaomimimo.com/v1/models` | Exists, auth required | OpenAI-compatible discovery. |
| MiMo | Token Plan CN | `GET https://token-plan-cn.xiaomimimo.com/v1/models` | Exists, auth required | OpenAI-compatible discovery. |
| MiMo | Anthropic | `GET https://api.xiaomimimo.com/anthropic/v1/models` | 404 | Do not configure Anthropic discovery. |
| MiMo | Token Plan Anthropic CN | `GET https://token-plan-cn.xiaomimimo.com/anthropic/v1/models` | 404 | Do not configure Anthropic discovery. |

## Kimi

| Product/plan/API | Region | Interface protocol | Base URL | Models | Capabilities |
|---|---|---|---|---|---|
| Moonshot API | Global | OpenAI Chat | `https://api.moonshot.ai/v1` | `kimi-k2.7-code`, `kimi-k2.7-code-highspeed`, `kimi-k2.6`, `kimi-k2.5`, `moonshot-v1-*k`, `moonshot-v1-*k-vision-preview` | Chat, streaming, tool/function calling; K2.7 Code is the coding-oriented Kimi model and always uses thinking. Kimi K2.x and vision-preview models are multimodal. |
| Moonshot API | Global | Anthropic Messages | `https://api.moonshot.ai/anthropic` | Same curated Moonshot model family | Claude-compatible messages endpoint documented for agent tools; no Anthropic model discovery route found. |
| Moonshot API | CN | OpenAI Chat | `https://api.moonshot.cn/v1` | Same curated Moonshot model family as global docs | CN service endpoint. |
| Moonshot API | CN | Anthropic Messages | `https://api.moonshot.cn/anthropic` | Same curated Moonshot model family | CN Claude-compatible messages endpoint documented for agent tools. |
| Kimi Coding API | Coding product | OpenAI Chat | `https://api.kimi.com/coding/v1` | `kimi-for-coding` | Dedicated coding-tool endpoint. |
| Kimi Coding API | Coding product | Anthropic Messages | `https://api.kimi.com/coding/` | `kimi-for-coding` | Claude Code-style endpoint; requires `User-Agent: claude-code/0.1.0`. |

Catalog implications:

- Do not model Kimi as `global/cn x plan/api` four combinations. Model it as endpoint groups plus API kind: Moonshot Global, Moonshot CN, and Kimi Coding.
- Keep API and Kimi Coding as separate endpoint groups.
- Do not model OpenAI and Anthropic as separate plans.
- Prefer K2.7 Code family for current coding defaults if official account access exposes it.

## MiniMax

| Product/plan/API | Region | Interface protocol | Base URL | Models | Capabilities |
|---|---|---|---|---|---|
| API / Pay as you go | Global | OpenAI Chat | `https://api.minimax.io/v1` | `MiniMax-M3`, `MiniMax-M2.7`, `MiniMax-M2.7-highspeed`, `MiniMax-M2.5`, `MiniMax-M2.5-highspeed` | M3: 1M context, text/image/video content, tool use, thinking. M2.x: 204.8K context, text/tool-call blocks. |
| API / Pay as you go | Global | OpenAI Responses | `https://api.minimax.io/v1` | Same current LLM family, especially `MiniMax-M3` | Responses API supports reasoning controls for M3. |
| API / Pay as you go | Global | Anthropic Messages | `https://api.minimax.io/anthropic` | Same current LLM family | Official Anthropic-compatible messages API, model discovery supported at `/anthropic/v1/models`. |
| API / Pay as you go | CN | OpenAI Chat | `https://api.minimaxi.com/v1` | Pending first-party MiniMax CN docs | Candidate CN mirror; do not finalize without official documentation. |
| API / Pay as you go | CN | Anthropic Messages | `https://api.minimaxi.com/anthropic` | Pending first-party MiniMax CN docs | Candidate CN mirror; do not finalize without official documentation. |
| Token Plan | Global | OpenAI Chat / Responses | `https://api.minimax.io/v1` | Token Plan docs and tool setup center on `MiniMax-M3` | Same base URL; product distinction is the Token Plan key and entitlement. |
| Token Plan | Global | Anthropic Messages | `https://api.minimax.io/anthropic` | `MiniMax-M3` first | Claude Code / agent tool configuration. |

Catalog implications:

- Display endpoint groups explicitly as `API / Token Plan Global` and `API / Token Plan CN`; avoid ambiguous labels such as `Global`, `CN`, or "default source".
- Keep `MiniMax-M3` first-class and first in each endpoint group's model list.
- Keep API and Token Plan naming visible even when their base URLs match.
- Add/keep model discovery for both OpenAI and Anthropic interfaces.

## Volcengine / ModelArk

| Product/plan/API | Region | Interface protocol | Base URL | Models | Capabilities |
|---|---|---|---|---|---|
| API / Ark | CN Beijing | OpenAI Chat | `https://ark.cn-beijing.volces.com/api/v3` | Curated flagship set: Doubao Seed 2.0 Code/Pro/Lite and DeepSeek V4 Pro | Chat, streaming, tools and reasoning according to the deployed model. |
| API / Ark | CN Beijing | OpenAI Responses | `https://ark.cn-beijing.volces.com/api/v3` | Same curated Ark API set | Responses-compatible calls where enabled. |
| API / Ark | CN Beijing | Anthropic-compatible | `https://ark.cn-beijing.volces.com/api/compatible` | Same curated Ark API set | Claude-compatible messages. |
| Coding Plan | CN Beijing | OpenAI Chat | `https://ark.cn-beijing.volces.com/api/coding/v3` | Curated coding/flagship set: `ark-code-latest`, `doubao-seed-2.0-code`, `doubao-seed-2.0-pro`, `minimax-m3`, `glm-5.2`, `deepseek-v4-pro`, `kimi-k2.6` | Coding-tool plan; default model should come from official Coding Plan docs, not reference projects. |
| Coding Plan | CN Beijing | Anthropic-compatible | `https://ark.cn-beijing.volces.com/api/coding` | Same curated Coding Plan set | Claude Code-style endpoint. |
| Agent Plan | CN Beijing | OpenAI Chat | `https://ark.cn-beijing.volces.com/api/plan/v3` | Same curated coding/flagship set | Agent Plan endpoint. |
| Agent Plan | CN Beijing | Anthropic-compatible | `https://ark.cn-beijing.volces.com/api/plan` | Same curated coding/flagship set | Claude-compatible Agent Plan endpoint. |

Catalog implications:

- Current local catalog already contains `api/coding/v3` and `api/plan/v3`; keep them as plan-level entries.
- Separate Ark API, Coding Plan, and Agent Plan. Do not mix plan aliases into generic Ark API unless the official plan says they are available there.
- Keep Volcengine model lists curated to current common/flagship models, including flagship third-party models where the plan exposes them; do not enumerate every hosted model alias.

## Alibaba Bailian / DashScope

| Product/plan/API | Region | Interface protocol | Base URL | Models | Capabilities |
|---|---|---|---|---|---|
| API / Pay as you go | CN Beijing | OpenAI Chat | `https://dashscope.aliyuncs.com/compatible-mode/v1` | Qwen commercial/open models plus enabled third-party models such as DeepSeek, Kimi, GLM, MiniMax, MiMo where available | Chat, streaming, function calling/tools, structured output, thinking according to model. |
| API / Pay as you go | CN Beijing | Anthropic Messages | `https://dashscope.aliyuncs.com/apps/anthropic` | Same account-entitled model set where exposed via Anthropic-compatible apps | Claude-compatible endpoint; tested Anthropic model discovery route is 404. |
| API / Pay as you go | US | OpenAI Chat | `https://dashscope-us.aliyuncs.com/compatible-mode/v1` | Region-entitled DashScope models | OpenAI-compatible endpoint. |
| API / Pay as you go | Singapore | OpenAI Chat | `https://{WorkspaceId}.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1` | Region/workspace-entitled DashScope models | Official docs recommend workspace domain for international regions. |
| API / Pay as you go | Singapore | Anthropic Messages | `https://{WorkspaceId}.ap-southeast-1.maas.aliyuncs.com/apps/anthropic` | Region/workspace-entitled models where exposed | Anthropic-compatible workspace endpoint. |
| API / Pay as you go | EU | OpenAI Chat | `https://{WorkspaceId}.eu-central-1.maas.aliyuncs.com/compatible-mode/v1` | Region/workspace-entitled DashScope models | OpenAI-compatible workspace endpoint. |
| Coding Plan | CN | OpenAI Chat | `https://coding.dashscope.aliyuncs.com/v1` | Curated current coding defaults: `qwen3.7-plus`, `qwen3.6-plus`, `kimi-k2.5`, `glm-5`, `MiniMax-M2.5` | Coding Plan key; model discovery exists at `/v1/models`. Keep the catalog to broad latest/flagship choices, not every DashScope model. |
| Coding Plan | CN | Anthropic Messages | `https://coding.dashscope.aliyuncs.com/apps/anthropic` | Same curated Coding Plan model family | Claude Code-style endpoint. |
| Coding Plan | International | OpenAI Chat | `https://coding-intl.dashscope.aliyuncs.com/v1` | Same curated Coding Plan model family where entitled | Coding Plan international endpoint. |
| Coding Plan | International | Anthropic Messages | `https://coding-intl.dashscope.aliyuncs.com/apps/anthropic` | Same curated Coding Plan model family where entitled | Claude-compatible endpoint. |
| Token Plan | CN Beijing | OpenAI Chat | `https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1` | Curated broad Token Plan defaults: `qwen3.7-max`, `qwen3.7-plus`, `qwen3.6-plus`, `qwen3.6-flash`, `deepseek-v4-pro`, `kimi-k2.6`, `glm-5.2`, `MiniMax-M2.5` | Token Plan key. Plain Chat is separate from Responses built-in tools. |
| Token Plan | CN Beijing | OpenAI Responses | `https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1` | Tool-capable Qwen subset: `qwen3.7-max`, `qwen3.7-plus`, `qwen3.6-plus`, `qwen3.6-flash` | Responses API is required for built-in tool families such as search/code/web/image tools on supported Qwen models. |
| Token Plan | CN Beijing | Anthropic Messages | `https://token-plan.cn-beijing.maas.aliyuncs.com/apps/anthropic` | Same curated Token Plan base text model family as Chat | Claude-compatible Token Plan endpoint. |

Catalog implications:

- Current catalog keeps explicit Bailian Coding Plan and Token Plan entries instead of overloading pay-as-you-go.
- Replace or de-emphasize legacy `https://dashscope-intl.aliyuncs.com/compatible-mode/v1` in favor of official workspace regional domains.
- Keep DashScope model lists curated to the newest common/flagship models; do not enumerate the full marketplace.
- Use model discovery for OpenAI-compatible endpoints; do not use `apps/anthropic/v1/models` unless official docs or authenticated testing proves support.

## GLM / Z.AI

| Product/plan/API | Region | Interface protocol | Base URL | Models | Capabilities |
|---|---|---|---|---|---|
| API / Pay as you go | Global | OpenAI Chat | `https://api.z.ai/api/paas/v4` | Curated general API set: `glm-5.2`, `glm-5-turbo`, `glm-5v-turbo`, `glm-5.1`, `glm-4.7`, `glm-4.5-air` | Current general API endpoint. |
| API / Pay as you go | CN | OpenAI Chat | `https://open.bigmodel.cn/api/paas/v4` | Same curated general API set where CN account has access | CN BigModel endpoint. |
| Coding Plan | Global | OpenAI Chat | `https://api.z.ai/api/coding/paas/v4` | Official Coding Plan docs list `GLM-5.2`, `GLM-5-Turbo`, `GLM-4.7`, `GLM-4.5-Air` | Coding Plan endpoint. |
| Coding Plan | CN | OpenAI Chat | `https://open.bigmodel.cn/api/coding/paas/v4` | Coding Plan docs currently name `GLM-5.2`, `GLM-5-Turbo`, `GLM-4.7`, `GLM-4.5-Air`; older GLM-5.x aliases may route forward | Coding Plan endpoint for CN. |
| Coding Plan | Global | Anthropic Messages | `https://api.z.ai/api/anthropic` | Same curated Coding Plan model set | Claude-compatible Coding Plan endpoint. |
| Coding Plan | CN | Anthropic Messages | `https://open.bigmodel.cn/api/anthropic` | Same curated Coding Plan model set | CN Claude-compatible Coding Plan endpoint. |

Catalog implications:

- Treat Coding Plan as a separate product from normal API.
- Do not expose `api/anthropic` as a normal pay-as-you-go API endpoint; keep it under Coding Plan.
- Verify exact case-sensitive model IDs with authenticated model discovery before changing persisted IDs from lower-case aliases to display-case docs names.

## DeepSeek

| Product/plan/API | Region | Interface protocol | Base URL | Models | Capabilities |
|---|---|---|---|---|---|
| API / Pay as you go | Global | OpenAI Chat | `https://api.deepseek.com` | `deepseek-v4-pro`, `deepseek-v4-flash` | Chat, streaming, thinking/reasoning, tools. Official list-models endpoint returns the current available models. |
| API / Pay as you go | Global | Anthropic Messages | `https://api.deepseek.com/anthropic` | `deepseek-v4-pro`, `deepseek-v4-flash` | Official Anthropic mapping: Opus maps to pro; Haiku/Sonnet map to flash. Supports thinking and tools; image/document content blocks are not supported. |

Catalog implications:

- Current catalog shape is mostly aligned.
- Keep model discovery at root `/models`, not `/v1/models`.

## Xiaomi MiMo

| Product/plan/API | Region | Interface protocol | Base URL | Models | Capabilities |
|---|---|---|---|---|---|
| API / Pay as you go | Official public API | OpenAI Chat | `https://api.xiaomimimo.com/v1` | `mimo-v2.5-pro`, `mimo-v2.5`, `mimo-v2-pro`, `mimo-v2-omni`, `mimo-v2-flash` | Pro: text, thinking, streaming, function call, structured output, web search, 1M context, 128K output. Omni: full-modal understanding plus the same text/tool capabilities; `mimo-v2.5` is 1M/128K, `mimo-v2-omni` is 256K/128K. Flash: 256K/64K. |
| API / Pay as you go | Official public API | Anthropic Messages | `https://api.xiaomimimo.com/anthropic` | Official tools overview confirms Anthropic base URL; model capability limits still need Anthropic-specific docs | Model discovery under `/anthropic/v1/models` is 404, so do not attach Anthropic discovery. |
| Token Plan | CN | OpenAI Chat | `https://token-plan-cn.xiaomimimo.com/v1` | Same text model family; coding docs recommend `mimo-v2.5-pro` | Token Plan key; model discovery exists at `/v1/models`. |
| Token Plan | Singapore | OpenAI Chat | `https://token-plan-sgp.xiaomimimo.com/v1` | Same text model family where plan has access | Token Plan regional endpoint. |
| Token Plan | Europe/Amsterdam | OpenAI Chat | `https://token-plan-ams.xiaomimimo.com/v1` | Same text model family where plan has access | Token Plan regional endpoint. |
| Token Plan | CN | Anthropic Messages | `https://token-plan-cn.xiaomimimo.com/anthropic` | Official tools overview confirms Token Plan Anthropic base URL | Model discovery under `/anthropic/v1/models` is 404. |

Catalog implications:

- Current local catalog has OpenAI Chat API and Token Plan regional endpoints.
- Add MiMo Anthropic invocation endpoints only where official MiMo docs confirm the plan/API base; do not attach Anthropic model discovery.
- Use `/v1/models` discovery for API and Token Plan OpenAI endpoints.

## Current Local Catalog Gaps To Check

These are not code changes yet; they are follow-up checks before modifying `src/resources/profile-catalog`.

| Provider | Gap / risk |
|---|---|
| Kimi | Current catalog still contains older K2.6/K2 preview-heavy defaults. Confirm and promote K2.7 Code family where official account exposes it. |
| Kimi | OpenAI Kimi Coding endpoint `https://api.kimi.com/coding/v1` should exist as a separate Kimi Coding product/API entry. |
| MiniMax | `MiniMax-M3` should be added and promoted over M2.7 for new setup. |
| MiniMax | Add model discovery metadata for OpenAI and Anthropic-compatible endpoints. |
| Volcengine | Keep Ark API, Coding Plan, and Agent Plan separate. Current catalog already has OpenAI and Anthropic-style base URLs for Coding/Agent plans. |
| Bailian | Add explicit Token Plan entries: `https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1` and `https://token-plan.cn-beijing.maas.aliyuncs.com/apps/anthropic`. |
| Bailian | Replace legacy international generic DashScope endpoint with workspace regional domains where the UI asks for a workspace ID. |
| Bailian | OpenAI-compatible discovery exists; Anthropic `apps/anthropic/v1/models` should not be used. |
| GLM/Z.AI | Add CN Anthropic endpoint if missing: `https://open.bigmodel.cn/api/anthropic`. |
| GLM/Z.AI | Coding Plan docs have moved toward GLM-5.2 naming; verify exact API IDs with discovery/key before replacing lower-case aliases. |
| DeepSeek | Mostly aligned; preserve root `/models` discovery. |
| MiMo | Add Anthropic invocation endpoints only with an explicit note that Anthropic model discovery is unsupported. |

## Endpoint-Model Capability Matrix

Capability values below are endpoint-scoped. They should not be copied from one provider or interface to another only because the model name matches.

Legend:

- `Y`: supported by the documented endpoint/model combination.
- `N`: not supported or explicitly absent.
- `Adapter`: depends on the provider's adapter, not only the model.
- `Tool`: available as a hosted/tool integration rather than plain model input/output.
- `Verify`: needs authenticated model discovery or an official per-model capability response before encoding as hard truth.

## Documentation Verification Map

This section maps each product/plan/API row to the official document that actually supports it. A document for one product/region must not be reused as evidence for another product/region unless the document explicitly says so.

| Provider | Product/plan/API | Region | Interface | Official evidence | Verified details | Remaining check |
|---|---|---|---|---|---|---|
| Kimi | Moonshot API | Global service | OpenAI Chat | https://platform.kimi.ai/docs/guide/start-using-kimi-api | Official SDK base URL is `https://api.moonshot.ai/v1`; direct HTTP path is `/v1/chat/completions`. | None for base URL. |
| Kimi | Moonshot API | Global service | Anthropic Messages | https://platform.kimi.ai/docs/guide/agent-support | Official agent-support docs list `ANTHROPIC_BASE_URL=https://api.moonshot.ai/anthropic` and OpenAI direct base `https://api.moonshot.ai/v1`. | Anthropic model discovery route remains unsupported; do not add discovery. |
| Kimi | Moonshot API | CN service | OpenAI Chat / Anthropic Messages | https://platform.moonshot.cn/docs/guide/agent-support | CN docs recommend `api.moonshot.cn` and list `https://api.moonshot.cn/v1` plus `https://api.moonshot.cn/anthropic`. | Anthropic model discovery route remains unsupported; do not add discovery. |
| Kimi | Moonshot API | Global/CN | Models | https://platform.kimi.ai/docs/models, https://platform.kimi.ai/docs/api/models-overview, https://platform.kimi.ai/docs/guide/kimi-k2-7-code-quickstart | Current list includes `kimi-k2.7-code`, `kimi-k2.7-code-highspeed`, `kimi-k2.6`, `kimi-k2.5`, `moonshot-v1-8k`, `moonshot-v1-32k`, `moonshot-v1-128k`, and vision-preview variants; K2.x models are 256K and multimodal, K2.7 Code thinking is always on. | File/document and web-search flags are not hard-coded. |
| Kimi | Kimi Coding API | Coding product | OpenAI Chat / Anthropic | https://platform.kimi.ai/docs/guide/kimi-k2-7-code-quickstart | Kimi Coding bases are `https://api.kimi.com/coding/v1` and `https://api.kimi.com/coding/`; current documented coding model is `kimi-for-coding`. | Keep only documented coding model until official docs add aliases. |
| MiniMax | API / Pay as you go | Global | OpenAI Chat | https://platform.minimax.io/docs/api-reference/text-chat-openai.md, https://platform.minimax.io/docs/guides/text-generation.md | `https://api.minimax.io/v1`; `/v1/chat/completions`; `MiniMax-M3` has 1M context and OpenAI Chat examples for image/video input, thinking, stream, and tools. | File/document and structured output need per-API reference confirmation before hard-coding. |
| MiniMax | API / Pay as you go | Global | Anthropic Messages | https://platform.minimax.io/docs/api-reference/text-chat-anthropic.md, https://platform.minimax.io/docs/guides/text-generation.md | `https://api.minimax.io/anthropic`; Anthropic-compatible invocation; docs recommend this path for thinking/interleaved thinking. | Check M3 image/video support through Anthropic content blocks separately from OpenAI Chat examples. |
| MiniMax | API / Pay as you go | CN | OpenAI Chat / Anthropic | No first-party source confirmed yet | Candidate CN mirrors `https://api.minimaxi.com/v1` and `https://api.minimaxi.com/anthropic` appear in reference material. | Do not finalize until MiniMax first-party CN-domain docs confirm them. |
| MiniMax | Token Plan | Global | OpenAI Chat / Anthropic | https://platform.minimax.io/docs/token-plan/other-tools.md | Token Plan tool setup gives OpenAI base `https://api.minimax.io/v1`, Anthropic base `https://api.minimax.io/anthropic`, model `MiniMax-M3`, and Subscription Key. | Token Plan plan-level tools such as MCP/web search need the Token Plan MCP docs, not the generic API docs. |
| MiniMax | Token Plan | Global | Codex/Responses | https://platform.minimax.io/docs/token-plan/codex.md | Codex setup uses `MiniMax-M3`, `base_url = "https://api.minimax.io/v1"`, `wire_api = "responses"`, `model_context_window = 512000`; optional catalog marks text+image input and reasoning controls. | Codex-specific 512K config is tool guidance, not the raw API context limit; keep both distinguished. |
| Volcengine | API / Ark | CN Beijing | OpenAI Chat/Responses | https://www.volcengine.com/docs/82379/1399008 | Generic Ark API quickstart covers API calling. | Need exact official page for `api/v3` model discovery and model capability table before hard-coding file/web flags. |
| Volcengine | Coding Plan | CN Beijing | OpenAI Chat | https://www.volcengine.com/docs/82379/2188959 | Official "other tools" page states OpenAI-compatible Coding Plan interface and base URL `https://ark.cn-beijing.volces.com/api/coding/v3`. | Need official per-model capability table for Coding Plan aliases. |
| Volcengine | Coding Plan | CN Beijing | Anthropic-compatible | https://www.volcengine.com/docs/82379/1928261 | Official Coding Plan quickstart covers Claude Code style usage. | Need exact page extraction for `https://ark.cn-beijing.volces.com/api/coding` and model capabilities. |
| Volcengine | Agent Plan | CN Beijing | OpenAI/Anthropic-compatible | No first-party source confirmed yet | Candidate routes `https://ark.cn-beijing.volces.com/api/plan/v3` and `https://ark.cn-beijing.volces.com/api/plan` exist in reference material and endpoint probes. | Do not finalize until first-party Agent Plan docs confirm them. |
| Bailian | API / Pay as you go | CN Beijing | OpenAI Chat | https://help.aliyun.com/zh/model-studio/compatibility-of-openai-with-dashscope | Official page lists Beijing base `https://dashscope.aliyuncs.com/compatible-mode/v1` and full path `/chat/completions`; supports Qwen, Qwen-VL, Qwen-Coder, Qwen-Omni, Qwen-Math, DeepSeek, Kimi, GLM, MiniMax. | Third-party direct models only apply to China site mainland regions; do not copy to international regions. |
| Bailian | API / Pay as you go | US Virginia | OpenAI Chat | https://help.aliyun.com/zh/model-studio/compatibility-of-openai-with-dashscope | Official page lists `https://dashscope-us.aliyuncs.com/compatible-mode/v1`. | Need separate region model availability; supported model set may differ. |
| Bailian | API / Pay as you go | Singapore | OpenAI Chat | https://help.aliyun.com/zh/model-studio/compatibility-of-openai-with-dashscope | Official page lists `https://{WorkspaceId}.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1` and recommends migrating from `https://dashscope-intl.aliyuncs.com` to workspace domain. | Need workspace ID UI support and separate region model availability. |
| Bailian | API / Pay as you go | CN Beijing / Singapore | Anthropic Messages | https://help.aliyun.com/zh/model-studio/claude-code | Official Claude Code page lists pay-as-you-go Anthropic base `https://dashscope.aliyuncs.com/apps/anthropic` for Beijing and `https://{WorkspaceId}.ap-southeast-1.maas.aliyuncs.com/apps/anthropic` for Singapore. | Anthropic model discovery under `/apps/anthropic/v1/models` probed 404; do not add discovery unless docs change. |
| Bailian | Coding Plan | CN / International | Anthropic Messages | https://help.aliyun.com/zh/model-studio/claude-code | Official Claude Code page lists Coding Plan `ANTHROPIC_BASE_URL` as `https://coding.dashscope.aliyuncs.com/apps/anthropic` and `https://coding-intl.dashscope.aliyuncs.com/apps/anthropic`, default model `qwen3.7-plus`. | Keep capability flags conservative across the adapter. |
| Bailian | Coding Plan | CN / International | OpenAI Chat | https://help.aliyun.com/zh/model-studio/coding-plan | Official Coding Plan docs recommend current coding models including Qwen, Kimi, GLM, and MiniMax families; OpenAI-compatible endpoints are `https://coding.dashscope.aliyuncs.com/v1` and `https://coding-intl.dashscope.aliyuncs.com/v1`. | Catalog intentionally keeps a curated latest/flagship subset. |
| Bailian | Token Plan | CN Beijing | OpenAI Chat / Responses | https://help.aliyun.com/zh/model-studio/token-plan-quickstart, https://help.aliyun.com/zh/model-studio/token-plan-overview, https://help.aliyun.com/zh/model-studio/token-plan-tool | Official quickstart lists OpenAI-compatible base `https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1`; overview lists Token Plan model families; tool docs say `qwen3.7-max`, `qwen3.7-plus`, `qwen3.6-plus`, `qwen3.6-flash` have built-in search/code/web/image tools through Responses API. | Catalog intentionally keeps a curated latest/flagship subset instead of the full Token Plan catalog. |
| Bailian | Token Plan | CN Beijing | Anthropic Messages | https://help.aliyun.com/zh/model-studio/token-plan-quickstart, https://help.aliyun.com/zh/model-studio/claude-code | Token Plan quickstart lists Anthropic-compatible base `https://token-plan.cn-beijing.maas.aliyuncs.com/apps/anthropic`; Claude Code page uses same base and maps current Qwen Token Plan models. | Keep same curated base text list as Chat; no Anthropic discovery route. |
| GLM/Z.AI | API / Pay as you go | Global | OpenAI Chat | https://docs.z.ai/guides/llm/glm-5.1 | Official GLM-5.1 guide uses `https://api.z.ai/api/paas/v4/`, model `glm-5.1`; documents thinking/function/structured/search/MCP family capabilities. | Need per-model table for GLM-5.2 and V-model file/image support. |
| GLM/Z.AI | API / Pay as you go | CN | OpenAI Chat | No first-party CN source confirmed yet | Candidate CN base `https://open.bigmodel.cn/api/paas/v4` authenticates. | Do not finalize until first-party CN API page confirms exact model availability. |
| GLM/Z.AI | API / Pay as you go | Global/CN | Anthropic Messages | No first-party normal-API source confirmed yet | Candidate `https://api.z.ai/api/anthropic` and `https://open.bigmodel.cn/api/anthropic` appear in reference material/probes. | Do not finalize until first-party Anthropic-compatible docs for normal pay-as-you-go API are found. |
| GLM/Z.AI | Coding Plan | Global | OpenAI Chat | https://docs.z.ai/devpack/quick-start, https://docs.z.ai/devpack/tool/others | Official GLM Coding Plan quickstart says use the dedicated Coding API `https://api.z.ai/api/coding/paas/v4` instead of General API `https://api.z.ai/api/paas/v4`; tool integration page repeats this OpenAI-compatible base. | Need authenticated discovery for exact model IDs/case if UI docs display names differ. |
| GLM/Z.AI | Coding Plan | Global | Anthropic Messages | https://docs.z.ai/devpack/faq, https://docs.z.ai/devpack/tool/claude | Official FAQ says Coding Plan endpoint for Claude Code and Goose is `https://api.z.ai/api/anthropic`; other tools use `https://api.z.ai/api/coding/paas/v4`; only `GLM-5.2`, `GLM-5-Turbo`, `GLM-4.7`, `GLM-4.5-Air` can be called. | Need authenticated response shape check before assigning fine-grained image/file/tool flags. |
| GLM/Z.AI | Coding Plan | CN | OpenAI Chat | https://docs.bigmodel.cn/cn/coding-plan/quick-start | Official CN Coding Plan quickstart gives `https://open.bigmodel.cn/api/coding/paas/v4` and current Coding Plan model names such as GLM-5.2 family. | Need exact API model IDs/case via discovery or docs before replacing lower-case aliases. |
| DeepSeek | API / Pay as you go | Global | Model discovery | https://api-docs.deepseek.com/api/list-models | Official `GET /models`; example returns `deepseek-v4-flash` and `deepseek-v4-pro`. | None for discovery. |
| DeepSeek | API / Pay as you go | Global | Anthropic Messages | https://api-docs.deepseek.com/guides/anthropic_api | Official base `https://api.deepseek.com/anthropic`; Claude Opus maps to pro, Haiku/Sonnet maps to flash; `thinking`, `tools`, and `stream` supported; image/document/search_result content blocks not supported. | Native OpenAI Chat web-search behavior still needs separate confirmation. |
| MiMo | API / Pay as you go | Public API | OpenAI Chat | https://platform.xiaomimimo.com/static/docs/quick-start/model.md | Official model table gives `mimo-v2.5-pro`, `mimo-v2-pro`, `mimo-v2.5`, `mimo-v2-omni`, `mimo-v2-flash`; lists context/max output and text/full-modal/thinking/stream/function/structured/web-search capabilities. | Need API overview page for base URL and protocol evidence. |
| MiMo | API / Pay as you go | Public API | OpenAI Chat / Anthropic Messages | https://platform.xiaomimimo.com/static/docs/integration/tools-overview.md, https://platform.xiaomimimo.com/static/docs/quick-start/first-api-call.md | Official tool overview says pay-as-you-go MiMo API uses OpenAI base `https://api.xiaomimimo.com/v1` and Anthropic base `https://api.xiaomimimo.com/anthropic`; first API call says the platform is compatible with OpenAI API and Anthropic API formats. | Need endpoint-specific Anthropic capability limits; `/anthropic/v1/models` probes 404, so no Anthropic model discovery. |
| MiMo | Token Plan | CN | OpenAI Chat / Anthropic Messages | https://platform.xiaomimimo.com/static/docs/integration/tools-overview.md, https://platform.xiaomimimo.com/docs/tokenplan/quick-access | Official tool overview says Token Plan uses OpenAI base `https://token-plan-cn.xiaomimimo.com/v1` and Anthropic base `https://token-plan-cn.xiaomimimo.com/anthropic`, API key format `tp-xxxxx`; quick access covers Token Plan connection. | Do not finalize Singapore/Amsterdam regional endpoints until first-party regional Token Plan docs confirm them. |

### Kimi

| Product/plan/API | Interface | Base URL | Model(s) | Context | Image | File/doc | Web search | Thinking/reasoning | Tools/function | Structured output | Notes |
|---|---|---|---|---:|---|---|---|---|---|---|---|
| Moonshot API Global/CN | OpenAI Chat | `https://api.moonshot.ai/v1`, `https://api.moonshot.cn/v1` | `kimi-k2.7-code`, `kimi-k2.7-code-highspeed`, `kimi-k2.6`, `kimi-k2.5` | 256K | Y | N | N | Y/model-specific | Y | Verify | K2.x current docs mark multimodal input; file/doc and web search are not hard-coded. |
| Moonshot API Global/CN | OpenAI Chat | `https://api.moonshot.ai/v1`, `https://api.moonshot.cn/v1` | `moonshot-v1-8k`, `moonshot-v1-32k`, `moonshot-v1-128k` | 8K/32K/128K | N | N | N | N | Y/Verify | Verify | Text model family. |
| Moonshot API Global/CN | OpenAI Chat | `https://api.moonshot.ai/v1`, `https://api.moonshot.cn/v1` | `moonshot-v1-*-vision-preview` | 8K/32K/128K | Y | N | N | N | Y/Verify | Verify | Vision-preview family. |
| Moonshot API Global/CN | Anthropic Messages | `https://api.moonshot.ai/anthropic`, `https://api.moonshot.cn/anthropic` | Same curated Moonshot model family | Model-specific | Adapter | N | N | Adapter | Adapter | Adapter | Official agent docs confirm bases; no Anthropic model discovery route found. |
| Kimi Coding API | OpenAI Chat | `https://api.kimi.com/coding/v1` | `kimi-for-coding` | 256K | Y | N | N | Y/Adapter | Y | Verify | Dedicated coding endpoint. |
| Kimi Coding API | Anthropic Messages | `https://api.kimi.com/coding/` | `kimi-for-coding` | 256K | Adapter | N | N | Adapter | Adapter | Adapter | Claude Code-style endpoint with separate base URL. |

### MiniMax

| Product/plan/API | Interface | Base URL | Model(s) | Context | Image | File/doc | Web search | Thinking/reasoning | Tools/function | Structured output | Notes |
|---|---|---|---|---:|---|---|---|---|---|---|---|
| API / Pay as you go | OpenAI Chat | `https://api.minimax.io/v1` | `MiniMax-M3` | 1M | Y | Verify | Verify | Y | Y | Verify | Official docs state OpenAI Chat supports text, image, and video input for M3. |
| API / Pay as you go | OpenAI Responses | `https://api.minimax.io/v1` | `MiniMax-M3` | 1M | Y/Adapter | Verify | Verify | Y | Y | Verify | Responses API has endpoint-specific reasoning controls; do not assume identical behavior to Chat. |
| API / Pay as you go | Anthropic Messages | `https://api.minimax.io/anthropic` | `MiniMax-M3` | 1M | Adapter | Verify | Verify | Y | Y | Adapter | Officially recommended for thinking/interleaved thinking. |
| API / Pay as you go | OpenAI Chat / Anthropic | `https://api.minimax.io/v1`, `https://api.minimax.io/anthropic` | `MiniMax-M2.7`, `MiniMax-M2.7-highspeed`, `MiniMax-M2.5`, `MiniMax-M2.5-highspeed` | 204.8K | N/Adapter | Verify | Verify | Y | Y | Verify | Docs describe M2.x as text/tool-call content block models; do not mark image just because M3 has it. |
| Token Plan | OpenAI/Anthropic | `https://api.minimax.io/v1`, `https://api.minimax.io/anthropic` | `MiniMax-M3` | 1M | Y/Adapter | Verify | Tool | Y | Y | Verify | Token Plan can add plan-level MCP/tools such as web search; this is plan capability, not just model capability. |

### Volcengine / ModelArk

| Product/plan/API | Interface | Base URL | Model(s) | Context | Image | File/doc | Web search | Thinking/reasoning | Tools/function | Structured output | Notes |
|---|---|---|---|---:|---|---|---|---|---|---|---|
| API / Ark | OpenAI Chat/Responses | `https://ark.cn-beijing.volces.com/api/v3` | `doubao-seed-2-0-code-preview-*`, `doubao-seed-2-0-pro-*`, `doubao-seed-2-0-lite-*`, `deepseek-v4-pro-*` | 256K/1.024M | Y for Doubao | Y for Doubao on OpenAI endpoints | Verify | Verify | Y | Verify | Curated current Ark API defaults, not full hosted catalog. |
| API / Ark | Anthropic-compatible | `https://ark.cn-beijing.volces.com/api/compatible` | Ark compatible model IDs | 256K/1M/200K by model | Adapter | Adapter | Verify | Adapter | Adapter | Adapter | Adapter endpoint should be separately verified; do not inherit OpenAI file/image flags. |
| Coding Plan | OpenAI Chat | `https://ark.cn-beijing.volces.com/api/coding/v3` | `ark-code-latest`, `doubao-seed-2.0-code`, `doubao-seed-2.0-pro`, `minimax-m3`, `glm-5.2`, `deepseek-v4-pro`, `kimi-k2.6` | Verify | Y on multimodal choices | Y on multimodal choices | Verify | Verify | Y | Verify | Curated plan defaults; third-party flagship models are retained where useful. |
| Coding Plan | OpenAI Chat | `https://ark.cn-beijing.volces.com/api/coding/v3` | `glm-5.1`, `deepseek-v4-flash`, `deepseek-v4-pro` | Verify | N in current catalog | N in current catalog | Verify | Y/Verify | Y/Verify | Verify | Same plan, different model aliases have different current flags. |
| Coding Plan / Agent Plan | Anthropic-compatible | `https://ark.cn-beijing.volces.com/api/coding`, `https://ark.cn-beijing.volces.com/api/plan` | Plan aliases | Verify | Adapter | Adapter | Verify | Adapter | Adapter | Adapter | Anthropic adapters should have separate capability records. |

### Alibaba Bailian / DashScope

| Product/plan/API | Interface | Base URL | Model(s) | Context | Image | File/doc | Web search | Thinking/reasoning | Tools/function | Structured output | Notes |
|---|---|---|---|---:|---|---|---|---|---|---|---|
| API / Pay as you go | OpenAI Chat | `https://dashscope.aliyuncs.com/compatible-mode/v1` | Qwen, DeepSeek, Kimi, GLM, MiniMax, MiMo models enabled in account | Model-specific | Model-specific | Model-specific | Tool/model-specific | Model-specific | Y/Model-specific | Y/Model-specific | DashScope is a marketplace/adapter. Capabilities must be read per endpoint/model from discovery/docs, not inferred from original provider. |
| API / Pay as you go | Anthropic Messages | `https://dashscope.aliyuncs.com/apps/anthropic` | Same account-entitled set where exposed | Model-specific | Adapter | Adapter | Tool/model-specific | Adapter | Adapter | Adapter | Anthropic apps route may not match OpenAI compatible capabilities. |
| Coding Plan | OpenAI Chat | `https://coding.dashscope.aliyuncs.com/v1`, `https://coding-intl.dashscope.aliyuncs.com/v1` | Curated: `qwen3.7-plus`, `qwen3.6-plus`, `kimi-k2.5`, `glm-5`, `MiniMax-M2.5` | Up to 1M/256K/model-specific | Y for Qwen plus and Kimi; N/unknown for GLM/MiniMax | N | N | Model-specific | Y | Verify | Curated newest common/flagship set, not full DashScope catalog. |
| Coding Plan | Anthropic Messages | `https://coding.dashscope.aliyuncs.com/apps/anthropic`, `https://coding-intl.dashscope.aliyuncs.com/apps/anthropic` | Same curated Coding Plan model set | Model-specific | Adapter | N | N | Adapter | Adapter | Adapter | Same plan, different protocol. |
| Token Plan | OpenAI Chat | `https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1` | Curated: `qwen3.7-max`, `qwen3.7-plus`, `qwen3.6-plus`, `qwen3.6-flash`, `deepseek-v4-pro`, `kimi-k2.6`, `glm-5.2`, `MiniMax-M2.5` | Up to 1M/256K/model-specific | Y for Qwen plus/flash and Kimi; N/unknown for text-only choices | N | N | Model-specific | Y | Verify | Plain Chat should not inherit Responses built-in tools. |
| Token Plan | OpenAI Responses | `https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1` | `qwen3.7-max`, `qwen3.7-plus`, `qwen3.6-plus`, `qwen3.6-flash` | Up to 1M/model-specific | Model-specific | Tool/model-specific | Tool | Model-specific | Y | Y/Verify | Built-in search/code/web/image tools are Responses endpoint capabilities, not generic model flags. |
| Token Plan | Anthropic Messages | `https://token-plan.cn-beijing.maas.aliyuncs.com/apps/anthropic` | Same curated Token Plan base text model set as Chat | Model-specific | Adapter | N | N | Adapter | Adapter | Adapter | Must be verified separately from Token Plan Responses. |

### GLM / Z.AI

| Product/plan/API | Interface | Base URL | Model(s) | Context | Image | File/doc | Web search | Thinking/reasoning | Tools/function | Structured output | Notes |
|---|---|---|---|---:|---|---|---|---|---|---|---|
| API / Pay as you go | OpenAI Chat | `https://api.z.ai/api/paas/v4`, `https://open.bigmodel.cn/api/paas/v4` | `glm-5.2`, `glm-5-turbo`, `glm-5.1`, `glm-4.7`, `glm-4.5-air` | 1M/200K/model-specific | N | N | Tool/docs-supported | Y | Y | Y | Curated current general API set. |
| API / Pay as you go | OpenAI Chat | Same | `glm-5v-turbo` | 200K | Y | Y | Tool/docs-supported | Y/Verify | Y | Y/Verify | Vision/file capability is V-model-specific. |
| Coding Plan | OpenAI Chat / Anthropic Messages | `https://api.z.ai/api/coding/paas/v4`, `https://open.bigmodel.cn/api/coding/paas/v4`, `https://api.z.ai/api/anthropic`, `https://open.bigmodel.cn/api/anthropic` | `glm-5.2`, `glm-5-turbo`, `glm-4.7`, `glm-4.5-air` | 1M/200K/model-specific | N/Adapter | N/Adapter | Tool/docs-supported | Y/Adapter | Y/Adapter | Y/Verify | Coding Plan endpoint group, not normal API. |

### DeepSeek

| Product/plan/API | Interface | Base URL | Model(s) | Context | Image | File/doc | Web search | Thinking/reasoning | Tools/function | Structured output | Notes |
|---|---|---|---|---:|---|---|---|---|---|---|---|
| API / Pay as you go | OpenAI Chat | `https://api.deepseek.com` | `deepseek-v4-pro`, `deepseek-v4-flash` | 1M | N | N | Verify/Tool | Y | Y | Verify | Official model list exposes only pro/flash. Do not mark image/file on original DeepSeek API. |
| API / Pay as you go | Anthropic Messages | `https://api.deepseek.com/anthropic` | `deepseek-v4-pro`, `deepseek-v4-flash` | 1M | N | N | Server-tool result blocks supported, provider-native search needs verification | Y | Y | Adapter | Official Anthropic docs explicitly do not support image/document content blocks. |

### Xiaomi MiMo

| Product/plan/API | Interface | Base URL | Model(s) | Context | Image | File/doc | Web search | Thinking/reasoning | Tools/function | Structured output | Notes |
|---|---|---|---|---:|---|---|---|---|---|---|---|
| API / Pay as you go | OpenAI Chat | `https://api.xiaomimimo.com/v1` | `mimo-v2.5-pro`, `mimo-v2-pro` | 1M | N | N | Y | Y | Y | Y | Official Pro Series: text generation, deep thinking, streaming, function call, structured output, web search. |
| API / Pay as you go | OpenAI Chat | `https://api.xiaomimimo.com/v1` | `mimo-v2.5` | 1M | Y | Y/Full-modal | Y | Y | Y | Y | Official Omni Series: full-modal understanding plus text/tool/search capabilities. |
| API / Pay as you go | OpenAI Chat | `https://api.xiaomimimo.com/v1` | `mimo-v2-omni` | 256K | Y | Y/Full-modal | Y | Y | Y | Y | Official Omni Series, smaller context than `mimo-v2.5`. |
| API / Pay as you go | OpenAI Chat | `https://api.xiaomimimo.com/v1` | `mimo-v2-flash` | 256K | N | N | Y | Y | Y | Y | Official Flash Series: max output 64K. |
| Token Plan | OpenAI Chat | `https://token-plan-cn.xiaomimimo.com/v1`, `https://token-plan-sgp.xiaomimimo.com/v1`, `https://token-plan-ams.xiaomimimo.com/v1` | Same MiMo text family | Same as API docs unless Token Plan docs override | Same as model/interface | Same as model/interface | Same as model/interface | Same as model/interface | Same as model/interface | Same as model/interface | Token Plan is a product/credential layer; confirm if plan docs expose additional tools or limits. |
| API / Token Plan | Anthropic Messages | `https://api.xiaomimimo.com/anthropic`, `https://token-plan-cn.xiaomimimo.com/anthropic` | MiMo models where official Anthropic-compatible API exposes them | Verify | Adapter | Adapter | Adapter | Adapter | Adapter | Adapter | Official tools overview confirms bases, but Anthropic model discovery is 404; do not inherit OpenAI capability flags without Anthropic-specific documentation. |

## Sources

- cc-switch: `farion1231/cc-switch`, inspected only as a reference signal, not as a source of truth.
- Local catalog: `src/resources/profile-catalog/*.json`.
- Kimi docs: https://platform.kimi.ai/docs/models and https://platform.kimi.ai/docs/guide/kimi-k2-7-code-quickstart
- MiniMax docs: https://platform.minimax.io/docs/llms.txt
- Volcengine docs: https://www.volcengine.com/docs/82379/2160841
- Bailian docs: https://help.aliyun.com/zh/model-studio/compatibility-of-openai-with-dashscope, https://help.aliyun.com/zh/model-studio/claude-code, https://help.aliyun.com/zh/model-studio/token-plan-quickstart, https://help.aliyun.com/zh/model-studio/text-generation-model/
- GLM/Z.AI docs: https://docs.bigmodel.cn/cn/coding-plan/quick-start and https://docs.z.ai/guides/llm/glm-5.1
- DeepSeek docs: https://api-docs.deepseek.com/api/list-models and https://api-docs.deepseek.com/guides/anthropic_api
- MiMo docs: https://platform.xiaomimimo.com/static/docs/quick-start/model.md
