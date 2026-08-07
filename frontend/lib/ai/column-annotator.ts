/**
 * Column Annotator — Uses Haiku to suggest column metadata (unit, semantic
 * type, ML role, aggregation, label, description) from column names + sample
 * values, so users can one-click-accept annotations on the Data tab.
 *
 * Defensive AI call pattern:
 * - Returns null on any failure (non-fatal)
 * - JSON parsing with markdown code block detection
 * - Direct fetch to Anthropic API
 *
 * Security:
 * - All column names and sample values are sanitized before the prompt
 * - Every suggestion is validated with ColumnSuggestionSchema (caller drops
 *   anything invalid or hallucinated)
 *
 * The whole column set is sent in ONE call: the model classifies far better
 * with full context (lat/lon → location, id → identifier) and one round-trip
 * is cheaper than N.
 */

import {
  ColumnSuggestionSchema,
  type SuggestColumns,
} from "@/lib/validation/api-schemas";
import type { ColumnSuggestion } from "@/lib/db/types";
import { recordAiTokens } from "@/lib/ai/usage";

const ANNOTATOR_MODEL = "claude-haiku-4-5-20251001";

const MAX_COLUMNS = 60;
const MAX_SAMPLES = 5;

// Sanitize a string for safe inclusion in a prompt (strip control chars, limit length)
function sanitizeForPrompt(s: string, maxLen = 100): string {
  return s.replace(/[^\x20-\x7E]/g, "").slice(0, maxLen);
}

function sampleToString(v: unknown): string {
  if (v === null || v === undefined) return "null";
  if (typeof v === "object") {
    try {
      return JSON.stringify(v);
    } catch {
      return "[object]";
    }
  }
  return String(v);
}

const SYSTEM_PROMPT = `You are a data annotation expert. Given the columns of a dataset (names, inferred types, and a few sample values), suggest metadata for each column so the platform can do better AI/ML inference.

Respond with ONLY a JSON object (no markdown, no explanation):
{
  "columns": [
    {
      "column_key": "<echo the exact column_key you were given>",
      "label": "short human-friendly name, e.g. Battery Voltage",
      "unit": "physical unit symbol if applicable, e.g. V, A, °C, %, RPM, m, m/s, Pa, hPa (omit if none)",
      "semantic_type": "one of: identifier | category | measurement | status | location | timestamp | text | boolean",
      "ml_role": "one of: feature | target | identifier | ignore",
      "aggregation": "one of: avg | sum | min | max | last | none",
      "description": "one concise sentence describing what this column represents",
      "confidence": 0.0 to 1.0
    }
  ]
}

Guidelines:
- Only use the exact enum values listed above. Omit a field entirely if you are unsure rather than guessing an invalid value.
- "column_key" MUST exactly match one of the provided keys. Do not invent columns.
- identifier columns (ids, uuids, keys) → semantic_type "identifier", ml_role "identifier", aggregation "none".
- continuous numeric sensor readings → semantic_type "measurement", ml_role "feature", aggregation "avg".
- lat/lon/altitude/coordinates → semantic_type "location".
- enum-like or label columns → semantic_type "category" or "status".
- time columns → semantic_type "timestamp", aggregation "none".
- confidence should reflect how certain you are from the name, type, and samples.`;

/**
 * Suggest metadata for a batch of columns. Returns null on any failure.
 * The caller validates/persists; this only proposes.
 */
export async function suggestColumnMetadata(
  source: { slug: string; name?: string | null; deviceType?: string | null },
  columns: SuggestColumns["columns"],
  orgId?: string,
): Promise<ColumnSuggestion[] | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.warn("[ColumnAnnotator] ANTHROPIC_API_KEY not configured");
    return null;
  }

  if (columns.length === 0) return null;

  const requestedKeys = new Set(columns.map((c) => c.column_key));

  const safeCols = columns.slice(0, MAX_COLUMNS).map((c) => {
    const samples = (c.sample_values ?? [])
      .slice(0, MAX_SAMPLES)
      .map((v) => sanitizeForPrompt(sampleToString(v), 60));
    const range =
      c.min != null || c.max != null
        ? ` range[min=${c.min ?? "?"}, max=${c.max ?? "?"}]`
        : "";
    return [
      `- column_key: ${sanitizeForPrompt(c.column_key, 256)}`,
      `  type: ${sanitizeForPrompt(c.inferred_type, 64)}${range}`,
      samples.length ? `  samples: ${samples.join(", ")}` : null,
    ]
      .filter(Boolean)
      .join("\n");
  });

  const prompt = [
    `Source slug: ${sanitizeForPrompt(source.slug, 64)}`,
    source.name ? `Source name: ${sanitizeForPrompt(source.name, 128)}` : null,
    source.deviceType
      ? `Device type: ${sanitizeForPrompt(source.deviceType, 64)}`
      : null,
    `\nColumns (${columns.length}):`,
    ...safeCols,
    columns.length > MAX_COLUMNS
      ? `... and ${columns.length - MAX_COLUMNS} more (omitted)`
      : null,
  ]
    .filter(Boolean)
    .join("\n");

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: ANNOTATOR_MODEL,
        max_tokens: 2048,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(
        "[ColumnAnnotator] API error:",
        response.status,
        errorText,
      );
      return null;
    }

    const data = await response.json();
    recordAiTokens(
      orgId,
      ANNOTATOR_MODEL,
      data?.usage?.input_tokens ?? 0,
      data?.usage?.output_tokens ?? 0,
    );
    const content = data.content?.[0]?.text;
    if (!content) {
      console.error("[ColumnAnnotator] No content in response");
      return null;
    }

    // Parse JSON (handle markdown code blocks)
    let jsonStr = content;
    const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1];
    }

    const parsed = JSON.parse(jsonStr);
    const rawColumns = Array.isArray(parsed?.columns) ? parsed.columns : [];

    // Validate each suggestion; drop invalid / hallucinated / clamp confidence.
    const suggestions: ColumnSuggestion[] = [];
    for (const raw of rawColumns) {
      const result = ColumnSuggestionSchema.safeParse(raw);
      if (!result.success) continue;
      const s = result.data;
      if (!requestedKeys.has(s.column_key)) continue;
      suggestions.push({
        ...s,
        confidence: Math.min(1, Math.max(0, s.confidence)),
      });
    }

    return suggestions;
  } catch (error) {
    console.error("[ColumnAnnotator] Error:", error);
    return null;
  }
}
