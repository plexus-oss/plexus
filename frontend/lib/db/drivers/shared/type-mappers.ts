export function mapPgType(dataTypeID: number): string {
  const typeMap: Record<number, string> = {
    16: "boolean",
    20: "bigint",
    21: "smallint",
    23: "integer",
    25: "text",
    700: "real",
    701: "double precision",
    1042: "char",
    1043: "varchar",
    1082: "date",
    1114: "timestamp",
    1184: "timestamptz",
    1700: "numeric",
    3802: "jsonb",
    114: "json",
  };
  return typeMap[dataTypeID] || "unknown";
}

export function mapMySQLType(typeId: number | undefined): string {
  const typeMap: Record<number, string> = {
    0: "decimal",
    1: "tinyint",
    2: "smallint",
    3: "integer",
    4: "float",
    5: "double",
    7: "timestamp",
    8: "bigint",
    9: "mediumint",
    10: "date",
    11: "time",
    12: "datetime",
    13: "year",
    15: "varchar",
    16: "bit",
    245: "json",
    246: "decimal",
    252: "blob",
    253: "varchar",
    254: "char",
  };
  return typeMap[typeId ?? -1] || "unknown";
}

export function inferInfluxType(value: unknown): string {
  if (value === null || value === undefined) return "string";
  if (typeof value === "number") return "double";
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "string") {
    if (/^\d{4}-\d{2}-\d{2}T/.test(value)) return "dateTime:RFC3339";
    return "string";
  }
  return "string";
}
