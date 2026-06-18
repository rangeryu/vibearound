# Provider Profile Official Verification

Date: 2026-06-18

Scope: every provider currently listed in `src/resources/profile-catalog`.

Rule used for this pass:

- Keep endpoint/product/plan rows only when an official provider document confirms the base URL or the provider is explicitly a user-supplied custom endpoint.
- Keep catalog model IDs only when the provider model page, model API docs, pricing page, or first-party integration docs confirm the slug or state that older slugs redirect.
- Encode `image_input`, `file_input`, and `web_search` only when the provider/interface documentation confirms that input/tool behavior for that endpoint. Do not infer capabilities from a model name reused by another provider.
- When a provider exposes many models by discovery, the catalog keeps a curated default set rather than pretending to be exhaustive.

## Azure OpenAI

Catalog endpoint:

- `openai-responses`, custom resource URL supplied by the user.

Official evidence:

- Microsoft Foundry "Use the Azure OpenAI Responses API" documents the v1 Responses endpoint shape under `https://{resource}.openai.azure.com/openai/v1/`.
- Microsoft Foundry "Web search with the Responses API" documents Azure's `web_search` tool for Responses API, with Azure-specific limitations.

Verification result:

- Keep empty `default_base_url`, because Azure endpoint is resource-specific.
- Keep empty model list, because the user enters a deployment name.
- Keep `reasoning_effort` and `web_search` at endpoint level for Responses API, with the understanding that Azure deployment/region access can still reject unavailable tools.

## Alibaba DashScope / Bailian

Catalog endpoints:

- Coding Plan CN and international, OpenAI-compatible and Anthropic-compatible.
- Token Plan CN Beijing, OpenAI-compatible Chat, OpenAI-compatible Responses, and Anthropic-compatible.

Official evidence:

- Alibaba Model Studio "Claude Code" page documents Coding Plan Anthropic base URLs `https://coding.dashscope.aliyuncs.com/apps/anthropic` and `https://coding-intl.dashscope.aliyuncs.com/apps/anthropic`, and Token Plan Anthropic base URL `https://token-plan.cn-beijing.maas.aliyuncs.com/apps/anthropic`.
- Alibaba Model Studio "More tools" / tool integration pages document Coding Plan OpenAI-compatible base URLs `https://coding.dashscope.aliyuncs.com/v1` and `https://coding-intl.dashscope.aliyuncs.com/v1`.
- Alibaba Model Studio Token Plan quickstart documents `https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1`.
- Alibaba Model Studio Token Plan overview lists supported Token Plan models including current Qwen, DeepSeek, Kimi, GLM, and MiniMax families.
- Alibaba Model Studio Token Plan tool docs document built-in tool support through Responses API for `qwen3.7-max`, `qwen3.7-plus`, `qwen3.6-plus`, and `qwen3.6-flash`.

Verification result:

- Keep Coding Plan as a separate plan from Token Plan and pay-as-you-go DashScope.
- Keep Token Plan CN Beijing endpoint; do not use legacy generic `dashscope-intl.aliyuncs.com`.
- Keep Coding Plan and Token Plan model lists curated to the newest broad-use coding/flagship choices rather than enumerating every DashScope model.
- Keep Token Plan Chat and Anthropic model lists aligned for the selected base text models; keep Token Plan Responses as a separate Qwen built-in-tool subset.
- Do not configure Anthropic model discovery under `apps/anthropic/v1/models`; tested/known route is not supported.
- Model lists remain curated plan defaults. Capability flags are conservative; no file input is marked.

## DeepSeek

Catalog endpoints:

- OpenAI-compatible API at `https://api.deepseek.com`.
- Anthropic-compatible API at `https://api.deepseek.com/anthropic`.

Official evidence:

- DeepSeek list-models API documents `GET /models` and current `deepseek-v4-pro` / `deepseek-v4-flash`.
- DeepSeek Anthropic API guide documents `https://api.deepseek.com/anthropic`, model mapping, thinking, tools, and message content support.

Verification result:

- Keep `deepseek-v4-pro` and `deepseek-v4-flash`.
- Do not mark image or document/file input; DeepSeek Anthropic explicitly lists `image`, `document`, and `search_result` content blocks as not supported.
- Keep Anthropic endpoint web-search-related capability only because DeepSeek documents `server_tool_use` and `web_search_tool_result` support in the Anthropic compatibility table. This is endpoint/tool behavior, not document input.

## Google Gemini / Vertex AI

Catalog endpoints:

- Gemini API native endpoint `https://generativelanguage.googleapis.com`.
- Google account endpoint for Gemini CLI/Code Assist.
- Gemini API OpenAI-compatible endpoint `https://generativelanguage.googleapis.com/v1beta/openai`.
- Vertex AI OpenAI-compatible custom endpoint entered by the user.

Official evidence:

- Google AI for Developers model pages document Gemini 2.5 Flash, 2.5 Flash-Lite, 2.5 Pro, Gemini 3 Flash Preview, Gemini 3.1 Flash-Lite, and Gemini 3.1 Pro Preview.
- Google AI changelog documents `gemini-3-flash-preview`.
- Google Cloud model pages document Vertex availability for Gemini 3 Flash and Gemini 3.1 Pro.
- Gemini API OpenAI compatibility docs document the `/v1beta/openai` base.

Verification result:

- Keep the current Gemini model set.
- Keep image/file/web capability for native Gemini API, because Gemini supports multimodal files and Google Search grounding in native API.
- Keep image/file for OpenAI-compatible Gemini endpoints; do not mark web search there because OpenAI-compatible web-search behavior is not the same as native Gemini grounding.
- Keep Vertex endpoint as custom base URL because project/location endpoint is user-specific.

## Kimi / Moonshot

Catalog endpoints:

- Moonshot Global OpenAI-compatible API and Anthropic-compatible API.
- Moonshot CN OpenAI-compatible API and Anthropic-compatible API.
- Kimi Coding OpenAI-compatible API.
- Kimi Coding Anthropic-compatible API.

Official evidence:

- Kimi global docs list `https://api.moonshot.ai/v1` for OpenAI-compatible calls and `https://api.moonshot.ai/anthropic` for Anthropic-compatible agent support.
- Moonshot CN docs list `https://api.moonshot.cn/v1` and `https://api.moonshot.cn/anthropic` for the China service.
- Kimi / Moonshot API docs list the current model family: `kimi-k2.7-code`, `kimi-k2.7-code-highspeed`, `kimi-k2.6`, `kimi-k2.5`, `moonshot-v1-*k`, and `moonshot-v1-*k-vision-preview`.
- Kimi Code docs document `https://api.kimi.com/coding/v1`, `https://api.kimi.com/coding/`, and model `kimi-for-coding`.

Verification result:

- Model Kimi/Moonshot as endpoint groups plus API kind, not as a four-way `global/cn x plan/api` matrix. The endpoint groups are Moonshot Global, Moonshot CN, and Kimi Coding.
- Keep K2.7 Code before older K2/K2.6 entries for Moonshot API defaults.
- Remove deprecated K2 preview/turbo aliases from the curated Moonshot list.
- Keep only `kimi-for-coding` for Kimi Coding. Removed unconfirmed legacy aliases `kimi-code` and `k2p5`.
- Keep image input only where the official model/product docs justify it. Do not mark file input or web search.
- Do not configure Moonshot Anthropic model discovery; the Anthropic discovery route is not supported.

## MiniMax

Catalog endpoints:

- API / Token Plan Global base URLs `https://api.minimax.io/v1` and `https://api.minimax.io/anthropic`.
- API / Token Plan CN base URLs `https://api.minimaxi.com/v1` and `https://api.minimaxi.com/anthropic`.

Official evidence:

- MiniMax global docs document OpenAI-compatible, Responses/Codex, and Anthropic-compatible usage around `MiniMax-M3`.
- MiniMax CN docs under `platform.minimaxi.com` document `https://api.minimaxi.com/v1`, `https://api.minimaxi.com/anthropic`, and `MiniMax-M3`.
- MiniMax Token Plan tool docs document global and China base URLs for coding tools.

Verification result:

- Label endpoint groups explicitly as `API / Token Plan Global` and `API / Token Plan CN`; do not display bare `Global` or `CN`.
- Keep `MiniMax-M3` first within each endpoint group.
- Keep M2.7 and M2.5 family as compatibility/model options with 204.8K context.
- Mark image input only on `MiniMax-M3`; do not mark file input or web search in the catalog.

## NVIDIA NIM

Catalog endpoint:

- OpenAI-compatible chat endpoint `https://integrate.api.nvidia.com/v1`.

Official evidence:

- NVIDIA NIM API docs document chat completions at `https://integrate.api.nvidia.com/v1/chat/completions`.
- NVIDIA model pages document Nemotron 3 Super and Nano context windows and text output behavior.
- NVIDIA API reference/model list documents NIM slugs such as `nvidia/nemotron-3-super-120b-a12b`, `nvidia/nemotron-3-nano-30b-a3b`, `nvidia/nvidia-nemotron-nano-9b-v2`, `qwen/qwen3-coder-480b-a35b-instruct`, and `openai/gpt-oss-120b`.

Verification result:

- Keep the current curated NIM chat model list.
- Do not mark file/image/web capabilities globally; individual NIM models differ and the current curated text/chat list is conservative.

## OpenRouter

Catalog endpoint:

- OpenAI-compatible chat endpoint `https://openrouter.ai/api/v1`.

Official evidence:

- OpenRouter docs document the unified OpenAI-compatible API.
- OpenRouter model browser exposes the listed model slugs.
- OpenRouter multimodal docs document image inputs and universal PDF/file processing through the chat completions API.

Verification result:

- Keep the endpoint and curated default model set.
- Keep image/file capability only on models where the catalog picked common multimodal defaults; OpenRouter can parse files for any model, but model-native behavior varies, so no endpoint-global file flag is set.
- Web search is not marked globally; OpenRouter web search requires plugin/tool configuration or `:online` model variants.

## Volcengine / ModelArk

Catalog endpoints:

- Ark API OpenAI Chat / Responses / Anthropic-compatible.
- Coding Plan OpenAI Chat / Anthropic-compatible.
- Agent Plan OpenAI Chat / Anthropic-compatible.

Official evidence:

- Volcengine Ark API docs document generic Ark API calling through `https://ark.cn-beijing.volces.com/api/v3`.
- Volcengine coding-tool docs document `https://ark.cn-beijing.volces.com/api/coding/v3` and Claude Code-style endpoint `https://ark.cn-beijing.volces.com/api/coding`.
- Volcengine third-party tool / Agent Plan docs document `https://ark.cn-beijing.volces.com/api/plan/v3` and `https://ark.cn-beijing.volces.com/api/plan`.

Verification result:

- Keep Ark API, Coding Plan, and Agent Plan separate.
- Keep model aliases separated by plan; do not mix plan aliases into Ark API rows.
- Keep Volcengine model lists curated, not exhaustive. Ark API keeps the current Doubao Seed 2.0 mainline plus a small number of externally hosted flagship models; Coding/Agent Plan keeps current coding/general flagships such as Ark Code, Doubao Seed 2.0, MiniMax M3, GLM 5.2, DeepSeek V4 Pro, and Kimi K2.6.
- Keep OpenAI Responses only for Ark API, where the catalog already exposes it.
- Current file/image flags are plan- and protocol-specific. Anthropic-compatible endpoints remain more conservative than OpenAI-compatible endpoints.

## xAI / Grok

Catalog endpoints:

- OpenAI-compatible Chat and Responses base `https://api.x.ai/v1`.

Official evidence:

- xAI model docs and pricing page document `grok-4.3` with 1M context and `grok-build-0.1` with 256K context.
- xAI May 15, 2026 retirement/migration page documents redirects from legacy slugs including `grok-code-fast-1` to `grok-build-0.1` and older Grok slugs to `grok-4.3`.
- xAI web search tool docs document real-time web search.

Verification result:

- Keep `grok-4.3` and `grok-build-0.1` as primary model IDs.
- Keep legacy aliases only where xAI says they continue to resolve or redirect.
- Keep image input for both models and web search only on Responses endpoint-level capability.

## Z.AI / GLM

Catalog endpoints:

- Global API OpenAI-compatible endpoint `https://api.z.ai/api/paas/v4`.
- CN API OpenAI-compatible endpoint `https://open.bigmodel.cn/api/paas/v4`.
- Global Coding Plan OpenAI-compatible API `https://api.z.ai/api/coding/paas/v4`.
- CN Coding Plan OpenAI-compatible API `https://open.bigmodel.cn/api/coding/paas/v4`.
- Global Coding Plan Anthropic-compatible API `https://api.z.ai/api/anthropic`.
- CN Coding Plan Anthropic-compatible API `https://open.bigmodel.cn/api/anthropic`.

Official evidence:

- Z.AI API reference and quickstart document `https://api.z.ai/api/paas/v4` and use `glm-5.2` in the current general API examples.
- Z.AI Coding Plan docs document `https://api.z.ai/api/coding/paas/v4`, `https://api.z.ai/api/anthropic`, and allowed Coding Plan models.
- BigModel CN general quickstart documents `https://open.bigmodel.cn/api/paas/v4` and `glm-5.2`.
- BigModel CN Coding Plan docs document `https://open.bigmodel.cn/api/coding/paas/v4` and `https://open.bigmodel.cn/api/anthropic` as Coding Plan endpoints.

Verification result:

- Keep normal API and Coding Plan as separate products.
- Do not expose `open.bigmodel.cn/api/anthropic` as a normal CN API endpoint; it belongs to CN Coding Plan.
- Keep Coding Plan model set tightened to `glm-5.2`, `glm-5-turbo`, `glm-4.7`, and `glm-4.5-air`.
- Keep `glm-5.2` at 1M context in Coding Plan entries.
- Keep GLM V-model image/file flags only on normal API V-model IDs where catalog has explicit V variants.

## Xiaomi MiMo

Catalog endpoints:

- Pay-as-you-go OpenAI-compatible API `https://api.xiaomimimo.com/v1`.
- Pay-as-you-go Anthropic-compatible API `https://api.xiaomimimo.com/anthropic`.
- Token Plan CN OpenAI-compatible API `https://token-plan-cn.xiaomimimo.com/v1`.
- Token Plan CN Anthropic-compatible API `https://token-plan-cn.xiaomimimo.com/anthropic`.

Official evidence:

- MiMo model table documents `mimo-v2.5-pro`, `mimo-v2.5`, `mimo-v2-pro`, `mimo-v2-omni`, and `mimo-v2-flash`, plus context windows and web search support.
- MiMo first API call docs document OpenAI and Anthropic API formats and pay-as-you-go base URLs.
- MiMo tools overview documents Token Plan CN OpenAI and Anthropic base URLs and `tp-xxxxx` keys.

Verification result:

- Keep only CN Token Plan endpoint. Removed unconfirmed Singapore/Amsterdam Token Plan regional endpoints.
- Keep web search on OpenAI-compatible MiMo endpoints based on the official model capability table.
- Mark image input for `mimo-v2.5` and `mimo-v2-omni` on both OpenAI-compatible and Anthropic-compatible MiMo endpoints. Official image understanding docs show both OpenAI Chat and Anthropic Messages image examples and list those two supported models.
- Do not mark file input. MiMo docs say "Full-modal Understanding" and mention image/audio/video scenarios, but do not document file/document content-block support.
- Do not configure Anthropic model discovery under `/anthropic/v1/models`; route is unsupported.
