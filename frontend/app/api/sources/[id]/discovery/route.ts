/**
 * Discovery rules on a connection source.
 *
 * POST   /api/sources/[id]/discovery  — save a rule + run one bounded sync
 * DELETE /api/sources/[id]/discovery  — remove a rule (?table=)
 *
 * A rule ("this table's <idColumn> names my drones") is stored on the
 * connection's config.discovery; the discovery loop keeps entities synced
 * afterward. Discovered entities remain when a rule is removed — cleanup is
 * a deliberate manual act, never a side effect.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAuth } from "@/lib/auth/session";
import { findSourceByIdOrSlug } from "@/lib/api/find-source";
import { enforceSource } from "@/lib/access/sources";
import { isApiError, errorResponse } from "@/lib/api/errors";
import { validateBody } from "@/lib/api/validate";
import { sourceQueries } from "@/lib/db";
import { discoveryRulesOf, type DiscoveryRule } from "@/lib/discovery/types";
import { syncRule, type DiscoveryStats } from "@/lib/discovery/discover";
import { isPollDialect } from "@/lib/alerts/event-poll-sql";
import { SOURCE_KIND_IDS } from "@/lib/sources/kinds";

const RuleSchema = z.object({
  table: z.string().min(1).max(256),
  schema: z.string().min(1).max(256).optional(),
  idColumn: z.string().min(1).max(256),
  timeColumn: z.string().min(1).max(256).optional(),
  kind: z.string().refine((k) => SOURCE_KIND_IDS.includes(k), "unknown kind"),
  enabled: z.boolean().default(true),
});

async function loadConnection(orgId: string, id: string, ctx: {
  userId: string | null;
  orgRole: string | null;
}) {
  const source = await findSourceByIdOrSlug(orgId, id);
  if (!source) return { error: NextResponse.json({ error: "Source not found" }, { status: 404 }) };
  await enforceSource(
    { orgId, userId: ctx.userId ?? undefined, orgRole: ctx.orgRole ?? undefined, isApiKeyAuth: false },
    source,
    "edit",
  );
  if (source.source_type !== "connection") {
    return { error: NextResponse.json({ error: "Not a connection source" }, { status: 400 }) };
  }
  if (!isPollDialect(source.connection_type ?? null)) {
    return {
      error: NextResponse.json(
        { error: `Discovery is not supported for ${source.connection_type} connections` },
        { status: 400 },
      ),
    };
  }
  return { source };
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { orgId, userId, orgRole } = await getAuth();
    if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { id } = await params;
    const rule = (await validateBody(request, RuleSchema)) as DiscoveryRule;

    const loaded = await loadConnection(orgId, id, { userId, orgRole });
    if ("error" in loaded) return loaded.error;
    const source = loaded.source;

    const config = (source.config ?? {}) as Record<string, unknown>;
    const rules = discoveryRulesOf(config).filter(
      (r) => !(r.table === rule.table && (r.schema ?? null) === (rule.schema ?? null)),
    );
    rules.push(rule);
    await sourceQueries.update(orgId, source.id, {
      config: { ...config, discovery: rules } as unknown as import("@/lib/db").Json,
    });

    // One bounded inline sync so the "40 drones found" moment is immediate;
    // the loop takes over from here.
    const stats: DiscoveryStats = {
      connections: 0, rules: 0, discovered: 0, converged: 0, freshness: 0, errors: 0,
    };
    try {
      await syncRule(source, rule, stats);
    } catch (err) {
      console.error("[discovery] inline sync failed:", err);
      return NextResponse.json(
        { rule, discovered: 0, error: "Rule saved; first sync failed — the background loop will retry" },
        { status: 201 },
      );
    }

    return NextResponse.json(
      { rule, discovered: stats.discovered, converged: stats.converged },
      { status: 201 },
    );
  } catch (error) {
    if (isApiError(error)) return errorResponse(error);
    console.error("[discovery] POST failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { orgId, userId, orgRole } = await getAuth();
    if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { id } = await params;
    const table = request.nextUrl.searchParams.get("table");
    if (!table) {
      return NextResponse.json({ error: "Missing 'table' query param" }, { status: 400 });
    }

    const loaded = await loadConnection(orgId, id, { userId, orgRole });
    if ("error" in loaded) return loaded.error;
    const source = loaded.source;

    const config = (source.config ?? {}) as Record<string, unknown>;
    const rules = discoveryRulesOf(config).filter((r) => r.table !== table);
    await sourceQueries.update(orgId, source.id, {
      config: { ...config, discovery: rules } as unknown as import("@/lib/db").Json,
    });
    return NextResponse.json({ rules });
  } catch (error) {
    if (isApiError(error)) return errorResponse(error);
    console.error("[discovery] DELETE failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
