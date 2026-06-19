import { expect, test } from "bun:test";

import {
  extractLocalAgentResponseText,
  localAgentBasePath,
  localAgentErrorText,
  localAgentTestPayload,
  maskLocalApiAuthHeader,
  parseLocalAgentJson,
  type LocalAgentApiTarget,
} from "../src/Launch/localAgentApi";

const target: LocalAgentApiTarget = {
  agentId: "codex cli",
  agentLabel: "Codex CLI",
  profileId: "direct/profile",
  profileLabel: "Direct",
  workspacePath: "/tmp/project",
};

test("local agent base path encodes agent and profile path segments", () => {
  expect(localAgentBasePath(target)).toBe(
    "/va/local-agent/codex%20cli/direct%2Fprofile/v1",
  );
});

test("local agent test payloads match supported wire protocols", () => {
  expect(localAgentTestPayload("openai-responses", "model-a", "hello")).toEqual({
    model: "model-a",
    input: "hello",
    stream: false,
  });
  expect(localAgentTestPayload("openai-chat", "model-b", "hello")).toEqual({
    model: "model-b",
    messages: [{ role: "user", content: "hello" }],
    stream: false,
  });
  expect(localAgentTestPayload("anthropic", "model-c", "hello")).toEqual({
    model: "model-c",
    max_tokens: 1024,
    messages: [{ role: "user", content: "hello" }],
    stream: false,
  });
});

test("local agent response text extraction supports all protocol shapes", () => {
  expect(
    extractLocalAgentResponseText("openai-responses", {
      output: [
        {
          type: "message",
          content: [{ type: "output_text", text: "responses ok" }],
        },
      ],
    }),
  ).toBe("responses ok");
  expect(
    extractLocalAgentResponseText("openai-responses", {
      output_text: "responses fallback",
    }),
  ).toBe("responses fallback");
  expect(
    extractLocalAgentResponseText("openai-chat", {
      choices: [{ message: { role: "assistant", content: "chat ok" } }],
    }),
  ).toBe("chat ok");
  expect(
    extractLocalAgentResponseText("anthropic", {
      content: [
        { type: "text", text: "anthropic " },
        { type: "text", text: "ok" },
      ],
    }),
  ).toBe("anthropic ok");
});

test("local agent json/error/auth helpers are conservative", () => {
  expect(parseLocalAgentJson("{\"ok\":true}")).toEqual({ ok: true });
  expect(parseLocalAgentJson("not json")).toBeNull();
  expect(localAgentErrorText({ error: { message: "bad request" } }, "fallback")).toBe(
    "bad request",
  );
  expect(localAgentErrorText({}, "fallback")).toBe("fallback");
  expect(maskLocalApiAuthHeader("Authorization: Bearer abcdefghijklmnopqrstuvwxyz")).toBe(
    "Authorization: Bearer abcdefgh...uvwxyz",
  );
});
