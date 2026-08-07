import { describe, it, expect } from "vitest";
import { db } from "../client";
import { sources } from "../schema";
import {
  sourceAssociationQueries,
  sourceQueries,
} from "../queries/sources";

const ORG = "assoc-org";

async function insertSource(slug: string, type: string): Promise<string> {
  const [row] = await db
    .insert(sources)
    .values({
      org_id: ORG,
      slug,
      source_type: type,
      name: slug,
      status: "online",
      config: {},
      metadata: {},
      tags: [],
      is_telemetry_store: false,
      visibility: "org",
    } as typeof sources.$inferInsert)
    .returning({ id: sources.id });
  return row!.id;
}

describe("sourceAssociationQueries", () => {
  it("upserts idempotently on (org, entity, connection, table)", async () => {
    const conn = await insertSource("flight-db", "connection");
    const drone = await insertSource("drone-7", "device");

    const first = await sourceAssociationQueries.upsert(ORG, {
      entity_type: "device",
      entity_id: drone,
      connection_id: conn,
      table_name: "flights",
      filter_column: "drone_id",
      filter_value: "7",
    });
    const second = await sourceAssociationQueries.upsert(ORG, {
      entity_type: "device",
      entity_id: drone,
      connection_id: conn,
      table_name: "flights",
      filter_column: "drone_id",
      filter_value: "seven", // re-mapped value updates in place
    });

    expect(second.id).toBe(first.id);
    const byEntity = await sourceAssociationQueries.findByEntity(ORG, drone);
    expect(byEntity).toHaveLength(1);
    expect(byEntity[0]!.filter_value).toBe("seven");
  });

  it("finds by connection and cascades when the connection is deleted", async () => {
    const conn = await insertSource("fleet-db", "connection");
    const a = await insertSource("rover-a", "device");
    const b = await insertSource("rover-b", "device");
    for (const [entity, value] of [
      [a, "a"],
      [b, "b"],
    ] as const) {
      await sourceAssociationQueries.upsert(ORG, {
        entity_type: "device",
        entity_id: entity,
        connection_id: conn,
        table_name: "runs",
        filter_column: "rover",
        filter_value: value,
      });
    }
    expect(
      await sourceAssociationQueries.findByConnection(ORG, conn),
    ).toHaveLength(2);

    await sourceQueries.delete(ORG, conn);
    expect(
      await sourceAssociationQueries.findByConnection(ORG, conn),
    ).toHaveLength(0); // FK ON DELETE CASCADE
  });

  it("deleteByEntity removes the rows entity deletion would orphan", async () => {
    const conn = await insertSource("orphan-db", "connection");
    const entity = await insertSource("orphan-1", "device");
    await sourceAssociationQueries.upsert(ORG, {
      entity_type: "device",
      entity_id: entity,
      connection_id: conn,
      table_name: "t",
      filter_column: "c",
      filter_value: "1",
    });

    await sourceAssociationQueries.deleteByEntity(ORG, entity);
    expect(
      await sourceAssociationQueries.findByEntity(ORG, entity),
    ).toHaveLength(0);
  });
});
