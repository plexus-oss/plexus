import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  LABEL_TOOL_NAME,
  resolveLabelProvider,
  runLabelModel,
} from "@/lib/ai/label/provider";
import { OllamaUnavailableError } from "@/lib/ai/label/ollama";

const ARGS = {
  system: "You are a telemetry analyst.",
  prompt: "Window: 0 to 1000.",
  schema: { type: "object", properties: {} } as Record<string, unknown>,
};

const ENV_KEYS = ["OLLAMA_URL", "ANTHROPIC_API_KEY", "LABEL_MODEL"] as const;
const savedEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> =
  {};

/** A minimal Response-like object for mocking global fetch. */
function fakeResponse(body: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

function ollamaBody(extra: Record<string, unknown> = {}) {
  return {
    model: "llama3.2",
    message: { content: JSON.stringify({ observations: [] }) },
    ...extra,
  };
}

function anthropicBody(extra: Record<string, unknown> = {}) {
  return {
    model: "claude-haiku-4-5-20251001",
    content: [
      { type: "text", text: "Reporting now." },
      { type: "tool_use", name: LABEL_TOOL_NAME, input: { observations: [] } },
    ],
    usage: { input_tokens: 500, output_tokens: 60 },
    ...extra,
  };
}

beforeEach(() => {
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = savedEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("resolveLabelProvider", () => {
  it("selects ollama when OLLAMA_URL is explicitly set", () => {
    process.env.OLLAMA_URL = "http://localhost:11434";
    expect(resolveLabelProvider()).toBe("ollama");
  });

  it("prefers ollama over anthropic when both are configured", () => {
    process.env.OLLAMA_URL = "http://localhost:11434";
    process.env.ANTHROPIC_API_KEY = "sk-test";
    expect(resolveLabelProvider()).toBe("ollama");
  });

  it("selects anthropic when only ANTHROPIC_API_KEY is set", () => {
    process.env.ANTHROPIC_API_KEY = "sk-test";
    expect(resolveLabelProvider()).toBe("anthropic");
  });

  it("returns null when neither is configured", () => {
    expect(resolveLabelProvider()).toBeNull();
  });
});

describe("runLabelModel", () => {
  it("throws the unavailable error without any network call when nothing is configured", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(runLabelModel(ARGS)).rejects.toBeInstanceOf(
      OllamaUnavailableError,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("routes to Ollama when OLLAMA_URL is set and maps eval counts to usage", async () => {
    process.env.OLLAMA_URL = "http://localhost:11434";
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        fakeResponse(ollamaBody({ prompt_eval_count: 100, eval_count: 20 })),
      );
    vi.stubGlobal("fetch", fetchMock);

    const reply = await runLabelModel(ARGS);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain("/api/chat");
    expect(reply.provider).toBe("ollama");
    expect(reply.model).toBe("llama3.2");
    expect(reply.result).toEqual({ observations: [] });
    expect(reply.usage).toEqual({ input_tokens: 100, output_tokens: 20 });
  });

  it("omits usage when Ollama reports no eval counts", async () => {
    process.env.OLLAMA_URL = "http://localhost:11434";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(fakeResponse(ollamaBody())));

    const reply = await runLabelModel(ARGS);
    expect(reply.usage).toBeUndefined();
  });

  it("NEVER falls back to Anthropic when OLLAMA_URL is set and Ollama fails", async () => {
    process.env.OLLAMA_URL = "http://localhost:11434";
    process.env.ANTHROPIC_API_KEY = "sk-test"; // present, must not be used
    const fetchMock = vi
      .fn()
      .mockRejectedValue(new TypeError("fetch failed: ECONNREFUSED"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(runLabelModel(ARGS)).rejects.toBeInstanceOf(
      OllamaUnavailableError,
    );
    // Exactly one call, and it went to Ollama — no cloud fallback, ever.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain("/api/chat");
    expect(String(fetchMock.mock.calls[0][0])).not.toContain("anthropic.com");
  });

  it("routes to Anthropic with a forced tool and parses the tool_use input", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-test";
    const fetchMock = vi.fn().mockResolvedValue(fakeResponse(anthropicBody()));
    vi.stubGlobal("fetch", fetchMock);

    const reply = await runLabelModel(ARGS);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("https://api.anthropic.com/v1/messages");
    expect(init.headers).toMatchObject({
      "Content-Type": "application/json",
      "x-api-key": "sk-test",
      "anthropic-version": "2023-06-01",
    });
    const body = JSON.parse(init.body);
    expect(body.model).toBe("claude-haiku-4-5-20251001");
    expect(body.max_tokens).toBe(1024);
    expect(body.temperature).toBe(0);
    expect(body.system).toBe(ARGS.system);
    expect(body.messages).toEqual([{ role: "user", content: ARGS.prompt }]);
    expect(body.tools).toHaveLength(1);
    expect(body.tools[0].name).toBe(LABEL_TOOL_NAME);
    expect(body.tools[0].input_schema).toEqual(ARGS.schema);
    expect(body.tool_choice).toEqual({ type: "tool", name: LABEL_TOOL_NAME });

    expect(reply.provider).toBe("anthropic");
    expect(reply.model).toBe("claude-haiku-4-5-20251001");
    expect(reply.result).toEqual({ observations: [] });
    expect(reply.usage).toEqual({ input_tokens: 500, output_tokens: 60 });
  });

  it("honors the LABEL_MODEL override", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-test";
    process.env.LABEL_MODEL = "claude-haiku-9-9-20990101";
    const fetchMock = vi.fn().mockResolvedValue(fakeResponse(anthropicBody()));
    vi.stubGlobal("fetch", fetchMock);

    await runLabelModel(ARGS);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.model).toBe("claude-haiku-9-9-20990101");
  });

  it("throws a plain error (not unavailable) on an Anthropic API error", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-test";
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(fakeResponse({ error: "overloaded" }, false, 529)),
    );

    const err = await runLabelModel(ARGS).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(OllamaUnavailableError);
    expect((err as Error).message).toContain("529");
  });

  it("throws when the Anthropic response carries no tool_use block", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-test";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        fakeResponse(
          anthropicBody({ content: [{ type: "text", text: "no tools here" }] }),
        ),
      ),
    );

    await expect(runLabelModel(ARGS)).rejects.toThrow(
      /no tool_use/,
    );
  });
});
