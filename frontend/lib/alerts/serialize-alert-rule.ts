/**
 * Serialize an alert_rules DB row (with slug resolved) into the wire format
 * expected by the alert-service. Used by both the bootstrap endpoint and
 * the push helper.
 *
 * Key transformations:
 *   - source_slug → wire field `source_id` (slug, not UUID)
 *   - DB column `sub_rules` → wire field `rules`
 *   - Null/empty fields stripped (Go uses *float64; 0 is a real bound)
 *   - metric omitted for compound rules
 *   - operator omitted for non-compound rules
 */

import "server-only";

import type { AlertRuleWire, SubRuleWire } from "@/lib/db/types";
import type { AlertRuleWithSlug } from "@/lib/db/server";

export function serializeAlertRuleForWire(
  row: AlertRuleWithSlug,
): AlertRuleWire {
  const rule: AlertRuleWire = {
    id: row.id,
    org_id: row.org_id,
    source_id: row.source_id,
    type: row.type,
    severity: row.severity,
  };

  // metric — required for threshold/outlier, omit for compound
  if (row.metric) {
    rule.metric = row.metric;
  }

  // conditions — strip null/empty values, omit if empty
  if (row.conditions && typeof row.conditions === "object") {
    const cond: Record<string, number> = {};
    const raw = row.conditions as Record<string, unknown>;
    if (raw.min != null) cond.min = raw.min as number;
    if (raw.max != null) cond.max = raw.max as number;
    if (raw.z_score != null) cond.z_score = raw.z_score as number;
    if (raw.min_samples != null) cond.min_samples = raw.min_samples as number;
    if (Object.keys(cond).length > 0) {
      rule.conditions = cond;
    }
  }

  // operator — only for compound rules
  if (row.operator) {
    rule.operator = row.operator as "and" | "or";
  }

  // sub_rules → wire field "rules"
  if (
    row.sub_rules &&
    Array.isArray(row.sub_rules) &&
    row.sub_rules.length > 0
  ) {
    rule.rules = row.sub_rules.map((sr) => {
      const sub = sr as Record<string, unknown>;
      const subRule: SubRuleWire = {
        type: sub.type as "threshold" | "outlier",
        metric: sub.metric as string,
        conditions: {},
      };
      if (sub.conditions && typeof sub.conditions === "object") {
        const cond: Record<string, number> = {};
        const raw = sub.conditions as Record<string, unknown>;
        if (raw.min != null) cond.min = raw.min as number;
        if (raw.max != null) cond.max = raw.max as number;
        if (raw.z_score != null) cond.z_score = raw.z_score as number;
        if (raw.min_samples != null)
          cond.min_samples = raw.min_samples as number;
        if (Object.keys(cond).length > 0) {
          subRule.conditions = cond;
        }
      }
      return subRule;
    });
  }

  // lifecycle config — omit when null (alert-service falls back to defaults)
  if (row.hysteresis_seconds != null) {
    rule.hysteresis_seconds = row.hysteresis_seconds;
  }
  if (row.cooldown_seconds != null) {
    rule.cooldown_seconds = row.cooldown_seconds;
  }

  return rule;
}
