import { expect, test } from "bun:test";
import { loopbackBaseUrl } from "@va/client";

import {
  extractLocalAgentModels,
  extractLocalAgentResponseText,
  localAgentBasePath,
  localAgentErrorText,
  localAgentTestPayload,
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
    "/local-agent/codex%20cli/direct%2Fprofile/v1",
  );
  expect(`${loopbackBaseUrl(12358)}${localAgentBasePath(target)}`).toBe(
    "http://127.0.0.1:12358/va/local-agent/codex%20cli/direct%2Fprofile/v1",
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

test("local agent test payloads include images and files for each protocol", () => {
  const image = {
    id: "image-1",
    name: "chart.png",
    mimeType: "image/png",
    size: 12,
    dataUrl: "data:image/png;base64,aW1hZ2U=",
  };
  const pdf = {
    id: "file-1",
    name: "notes.pdf",
    mimeType: "application/pdf",
    size: 34,
    dataUrl: "data:application/pdf;base64,ZmlsZQ==",
  };

  expect(
    localAgentTestPayload("openai-responses", "model-a", "hello", [
      image,
      pdf,
    ]),
  ).toEqual({
    model: "model-a",
    input: [
      {
        role: "user",
        content: [
          { type: "input_text", text: "hello" },
          { type: "input_image", image_url: image.dataUrl },
          {
            type: "input_file",
            filename: "notes.pdf",
            file_data: pdf.dataUrl,
          },
        ],
      },
    ],
    stream: false,
  });
  expect(localAgentTestPayload("openai-chat", "model-b", "hello", [image])).toEqual({
    model: "model-b",
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: "hello" },
          { type: "image_url", image_url: { url: image.dataUrl } },
        ],
      },
    ],
    stream: false,
  });
  expect(localAgentTestPayload("anthropic", "model-c", "hello", [pdf])).toEqual({
    model: "model-c",
    max_tokens: 1024,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: "hello" },
          {
            type: "document",
            title: "notes.pdf",
            source: {
              type: "base64",
              media_type: "application/pdf",
              data: "ZmlsZQ==",
            },
          },
        ],
      },
    ],
    stream: false,
  });
});

test("local agent models come from the models endpoint payload", () => {
  const payload = {
    data: [
      { id: "claude" },
      { id: "claude" },
      { id: "codex" },
      { id: "" },
      { object: "model" },
    ],
  };

  expect(extractLocalAgentModels(payload)).toEqual([
    { id: "claude" },
    { id: "codex" },
  ]);
  expect(extractLocalAgentModels({ data: null })).toEqual([]);
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

test("local agent json/error helpers are conservative", () => {
  expect(parseLocalAgentJson("{\"ok\":true}")).toEqual({ ok: true });
  expect(parseLocalAgentJson("not json")).toBeNull();
  expect(localAgentErrorText({ error: { message: "bad request" } }, "fallback")).toBe(
    "bad request",
  );
  expect(localAgentErrorText({}, "fallback")).toBe("fallback");
});
