-- Source-only scoping: satellite ID lists migrate into the source allow-list
-- via the discovery associations (each ID → the entity source whose
-- association filter_value matches), then the columns drop.
--
-- Semantic note: a member who previously had FULL source access plus a
-- satellite row filter becomes scoped to their entity sources (+ derived
-- connections). That is the intended meaning of "a satellite customer" under
-- the source-only model.
--
-- IDs with no matching entity source are logged as warnings (visible in the
-- release-command output) rather than silently dropped.
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT m.org_id, m.user_id, sid AS sat_id
    FROM "org_members" m, unnest(m."allowed_satellite_ids") AS sid
    WHERE m."allowed_satellite_ids" IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM "source_associations" a
        WHERE a.org_id = m.org_id AND a.filter_value = sid
      )
  LOOP
    RAISE WARNING 'scope migration: satellite id % for member % (org %) has no matching entity source — not migrated',
      r.sat_id, r.user_id, r.org_id;
  END LOOP;
END $$;--> statement-breakpoint
UPDATE "org_members" m
SET "allowed_source_ids" = (
  SELECT COALESCE(m."allowed_source_ids", '{}'::uuid[]) ||
         COALESCE(array_agg(DISTINCT a.entity_id), '{}'::uuid[])
  FROM "source_associations" a
  WHERE a.org_id = m.org_id
    AND a.filter_value = ANY (m."allowed_satellite_ids")
)
WHERE m."allowed_satellite_ids" IS NOT NULL;--> statement-breakpoint
UPDATE "org_invites" i
SET "allowed_source_ids" = (
  SELECT COALESCE(i."allowed_source_ids", '{}'::uuid[]) ||
         COALESCE(array_agg(DISTINCT a.entity_id), '{}'::uuid[])
  FROM "source_associations" a
  WHERE a.org_id = i.org_id
    AND a.filter_value = ANY (i."allowed_satellite_ids")
)
WHERE i."allowed_satellite_ids" IS NOT NULL AND i."accepted_at" IS NULL;--> statement-breakpoint
ALTER TABLE "org_invites" DROP COLUMN "allowed_satellite_ids";--> statement-breakpoint
ALTER TABLE "org_members" DROP COLUMN "allowed_satellite_ids";
