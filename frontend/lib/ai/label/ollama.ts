/**
 * Minimal Ollama client for the local-model labeling feature.
 *
 * Deliberately SDK-free and localhost-only: one plain fetch against a local
 * `ollama serve` with structured outputs (`format: <json schema>`). No
 * Anthropic involvement, no network beyond OLLAMA_URL. The model only ever
 * proposes — callers render proposals and the human applies them.
 */
import "server-only";

export const OLLAMA_URL = process.env.OLLAMA_URL || "http://localhost:11434";
export const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "llama3.2";

const REQUEST_TIMEOUT_MS = 30_000;

/**
 * Thrown when the Ollama server can't be reached at all (connection refused
 * or timed out) — distinct from a malformed response so the API route can
 * answer 503 "labeling_unavailable" instead of 500.
 */
export class OllamaUnavailableError extends Error {
  constructor(message = `Ollama unreachable at ${OLLAMA_URL}`) {
    super(message);
    this.name = "OllamaUnavailableError";
  }
}

export interface OllamaChatJsonArgs {
  system: string;
  user: string;
  /** JSON schema the model's reply must conform to (Ollama structured outputs). */
  schema: Record<string, unknown>;
}

/**
 * POST /api/chat with `stream: false`, `format: schema`, temperature 0, and
 * parse `message.content` as JSON. Returns the parsed object plus the model
 * name that actually served the request, and Ollama's token accounting
 * (prompt_eval_count / eval_count) when the server reports it.
 */
export async function ollamaChatJson<T>(
  args: OllamaChatJsonArgs,
): Promise<{
  result: T;
  model: string;
  promptEvalCount?: number;
  evalCount?: number;
}> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        messages: [
          { role: "system", content: args.system },
          { role: "user", content: args.user },
        ],
        stream: false,
        format: args.schema,
        options: { temperature: 0 },
      }),
      signal: controller.signal,
    });
  } catch {
    // fetch rejects on refused connections and on abort (timeout) — both mean
    // "no usable local model right now".
    throw new OllamaUnavailableError();
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    throw new Error(`Ollama responded ${res.status}: ${await res.text()}`);
  }

  const data = (await res.json()) as {
    model?: string;
    message?: { content?: string };
    prompt_eval_count?: number;
    eval_count?: number;
  };
  const content = data.message?.content;
  if (!content) throw new Error("Ollama returned an empty message");

  let parsed: T;
  try {
    parsed = JSON.parse(content) as T;
  } catch {
    throw new Error("Ollama returned non-JSON content");
  }
  return {
    result: parsed,
    model: data.model || OLLAMA_MODEL,
    promptEvalCount: data.prompt_eval_count,
    evalCount: data.eval_count,
  };
}
