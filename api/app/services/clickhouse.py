import clickhouse_connect

from app.core.config import settings

INTERVALS = ["raw", "1m", "10m", "1h", "1d"]


def auto_interval(start_ms: int, end_ms: int) -> str:
    """Pick the coarsest interval that yields ~1k points for the window."""
    minutes = (end_ms - start_ms) / 60_000
    if minutes < 10:
        return "raw"
    elif minutes < 600:     # < 10h
        return "1m"
    elif minutes < 4_320:   # < 3d
        return "10m"
    elif minutes < 21_600:  # < 15d
        return "1h"
    else:
        return "1d"


class ClickHouseService:
    def __init__(self) -> None:
        self._client = None

    async def init(self) -> None:
        self._client = await clickhouse_connect.get_async_client(
            host=settings.clickhouse_host,
            port=settings.clickhouse_port,
            username=settings.clickhouse_user,
            password=settings.clickhouse_password,
            database=settings.clickhouse_database,
            secure=settings.clickhouse_secure,
        )

    async def aclose(self) -> None:
        if self._client:
            await self._client.close()

    async def ping(self) -> None:
        await self._client.query("SELECT 1")

    async def list_known_sources(self, org_id: str) -> dict[str, int]:
        result = await self._client.query(
            """
            SELECT source_id, toUnixTimestamp64Milli(max(timestamp)) AS last_seen_ms
            FROM plexus.telemetry_dist
            WHERE org_id = {org_id:String}
            GROUP BY source_id
            """,
            parameters={"org_id": org_id},
        )
        return {row[0]: row[1] for row in result.result_rows}

    async def get_last_seen(self, org_id: str, source_id: str) -> int | None:
        result = await self._client.query(
            """
            SELECT toUnixTimestamp64Milli(max(timestamp)) AS last_seen_ms
            FROM plexus.telemetry_dist
            WHERE org_id = {org_id:String}
              AND source_id = {source_id:String}
            """,
            parameters={"org_id": org_id, "source_id": source_id},
        )
        rows = result.result_rows
        if not rows or rows[0][0] is None:
            return None
        return rows[0][0]

    async def list_metrics(self, org_id: str, source_id: str) -> list[str]:
        result = await self._client.query(
            """
            SELECT DISTINCT metric
            FROM plexus.telemetry_dist
            WHERE org_id = {org_id:String}
              AND source_id = {source_id:String}
            ORDER BY metric
            """,
            parameters={"org_id": org_id, "source_id": source_id},
        )
        return [row[0] for row in result.result_rows]

    async def query_latest_metrics(self, org_id: str, source_id: str) -> dict[str, float]:
        result = await self._client.query(
            """
            SELECT metric, argMax(value, timestamp) AS v
            FROM plexus.telemetry_dist
            WHERE org_id = {org_id:String}
              AND source_id = {source_id:String}
              AND timestamp >= now64(3) - INTERVAL 1 HOUR
            GROUP BY metric
            """,
            parameters={"org_id": org_id, "source_id": source_id},
        )
        return {row[0]: row[1] for row in result.result_rows}

    async def query_metrics(
        self,
        org_id: str,
        source_id: str,
        metrics: list[str] | None,
        start_ms: int,
        end_ms: int,
        interval: str,
        limit: int = 10_000,
    ) -> dict[str, dict[str, list]]:
        metric_clause = "AND metric IN {metrics:Array(String)}" if metrics else ""
        params: dict = {"org_id": org_id, "source_id": source_id}
        if metrics:
            params["metrics"] = metrics

        if interval == "raw":
            sql = f"""
            SELECT metric, toUnixTimestamp64Milli(timestamp) AS ts, value
            FROM plexus.telemetry_dist
            WHERE org_id = {{org_id:String}}
              AND source_id = {{source_id:String}}
              {metric_clause}
              AND timestamp >= fromUnixTimestamp64Milli({{start_ms:Int64}})
              AND timestamp <  fromUnixTimestamp64Milli({{end_ms:Int64}})
            ORDER BY metric, timestamp
            LIMIT {{limit:Int32}}
            """
            params.update({"start_ms": start_ms, "end_ms": end_ms, "limit": limit})

        elif interval in ("1m", "10m"):
            bucket = {
                "1m":  "ts_min",
                "10m": "toStartOfInterval(ts_min, INTERVAL 10 MINUTE)",
            }[interval]
            sql = f"""
            SELECT
                metric,
                toInt64(toUnixTimestamp({bucket})) * 1000 AS ts,
                min(min_value) AS min_v,
                max(max_value) AS max_v,
                IF(sum(count_value) > 0, sum(sum_value) / sum(count_value), 0) AS avg_v,
                sum(count_value) AS cnt
            FROM plexus.telemetry_1min_dist
            WHERE org_id = {{org_id:String}}
              AND source_id = {{source_id:String}}
              {metric_clause}
              AND ts_min >= toDateTime(intDiv({{start_ms:Int64}}, 1000), 'UTC')
              AND ts_min <  toDateTime(intDiv({{end_ms:Int64}}, 1000), 'UTC')
            GROUP BY metric, {bucket}
            ORDER BY metric, ts
            LIMIT {{limit:Int32}}
            """
            params.update({"start_ms": start_ms, "end_ms": end_ms, "limit": limit})

        else:  # 1h or 1d
            bucket = {
                "1h": "ts_hour",
                "1d": "toStartOfDay(ts_hour)",
            }[interval]
            sql = f"""
            SELECT
                metric,
                toInt64(toUnixTimestamp({bucket})) * 1000 AS ts,
                min(min_value) AS min_v,
                max(max_value) AS max_v,
                IF(sum(count_value) > 0, sum(sum_value) / sum(count_value), 0) AS avg_v,
                sum(count_value) AS cnt
            FROM plexus.telemetry_1hr_dist
            WHERE org_id = {{org_id:String}}
              AND source_id = {{source_id:String}}
              {metric_clause}
              AND ts_hour >= toDateTime(intDiv({{start_ms:Int64}}, 1000), 'UTC')
              AND ts_hour <  toDateTime(intDiv({{end_ms:Int64}}, 1000), 'UTC')
            GROUP BY metric, {bucket}
            ORDER BY metric, ts
            LIMIT {{limit:Int32}}
            """
            params.update({"start_ms": start_ms, "end_ms": end_ms, "limit": limit})

        rows = (await self._client.query(sql, parameters=params)).result_rows
        out: dict[str, dict[str, list]] = {}

        if interval == "raw":
            for metric, ts, value in rows:
                if metric not in out:
                    out[metric] = {"timestamp_ms": [], "value": []}
                out[metric]["timestamp_ms"].append(ts)
                out[metric]["value"].append(value)
        else:
            for metric, ts, min_v, max_v, avg_v, cnt in rows:
                if metric not in out:
                    out[metric] = {"timestamp_ms": [], "min": [], "max": [], "avg": [], "count": []}
                out[metric]["timestamp_ms"].append(ts)
                out[metric]["min"].append(min_v)
                out[metric]["max"].append(max_v)
                out[metric]["avg"].append(avg_v)
                out[metric]["count"].append(int(cnt))
        return out

    async def query_logs(
        self,
        org_id: str,
        source_id: str,
        start_ms: int,
        end_ms: int,
        limit: int = 1000,
        name: str | None = None,
    ) -> list[dict]:
        name_clause = "AND name = {name:String}" if name else ""
        params: dict = {
            "org_id": org_id,
            "source_id": source_id,
            "start_ms": start_ms,
            "end_ms": end_ms,
            "limit": limit,
        }
        if name:
            params["name"] = name
        result = await self._client.query(
            f"""
            SELECT
                toUnixTimestamp64Milli(timestamp) AS ts,
                name,
                body,
                tags
            FROM plexus.events_dist
            WHERE org_id = {{org_id:String}}
              AND source_id = {{source_id:String}}
              {name_clause}
              AND timestamp >= fromUnixTimestamp64Milli({{start_ms:Int64}})
              AND timestamp <  fromUnixTimestamp64Milli({{end_ms:Int64}})
            ORDER BY timestamp
            LIMIT {{limit:Int32}}
            """,
            parameters=params,
        )
        return [
            {"timestamp_ms": row[0], "metric": row[1], "value": row[2], "tags": dict(row[3])}
            for row in result.result_rows
        ]

    async def query_logs_tail(
        self,
        org_id: str,
        source_id: str,
        n: int,
        name: str | None = None,
    ) -> list[dict]:
        name_clause = "AND name = {name:String}" if name else ""
        params: dict = {"org_id": org_id, "source_id": source_id, "n": n}
        if name:
            params["name"] = name
        result = await self._client.query(
            f"""
            SELECT
                toUnixTimestamp64Milli(timestamp) AS ts,
                name,
                body,
                tags
            FROM plexus.events_dist
            WHERE org_id = {{org_id:String}}
              AND source_id = {{source_id:String}}
              {name_clause}
            ORDER BY timestamp DESC
            LIMIT {{n:Int32}}
            """,
            parameters=params,
        )
        rows = result.result_rows
        return [
            {"timestamp_ms": row[0], "metric": row[1], "value": row[2], "tags": dict(row[3])}
            for row in reversed(rows)
        ]

    async def count_known_sources(self, org_id: str) -> int:
        result = await self._client.query(
            """
            SELECT COUNT(DISTINCT source_id)
            FROM plexus.telemetry_dist
            WHERE org_id = {org_id:String}
            """,
            parameters={"org_id": org_id},
        )
        rows = result.result_rows
        return rows[0][0] if rows else 0

    async def query_fleet_metrics(
        self,
        org_id: str,
        metric: str,
        start_ms: int,
        end_ms: int,
        interval: str,
        limit: int = 10_000,
    ) -> dict[str, dict[str, list]]:
        params: dict = {
            "org_id": org_id,
            "metric": metric,
            "start_ms": start_ms,
            "end_ms": end_ms,
            "limit": limit,
        }

        if interval in ("1m", "10m"):
            bucket = {
                "1m":  "ts_min",
                "10m": "toStartOfInterval(ts_min, INTERVAL 10 MINUTE)",
            }[interval]
            sql = f"""
            SELECT
                source_id,
                toInt64(toUnixTimestamp({bucket})) * 1000 AS ts,
                min(min_value) AS min_v,
                max(max_value) AS max_v,
                IF(sum(count_value) > 0, sum(sum_value) / sum(count_value), 0) AS avg_v,
                sum(count_value) AS cnt
            FROM plexus.telemetry_1min_dist
            WHERE org_id = {{org_id:String}}
              AND metric = {{metric:String}}
              AND ts_min >= toDateTime(intDiv({{start_ms:Int64}}, 1000), 'UTC')
              AND ts_min <  toDateTime(intDiv({{end_ms:Int64}}, 1000), 'UTC')
            GROUP BY source_id, {bucket}
            ORDER BY source_id, ts
            LIMIT {{limit:Int32}}
            """
        else:  # 1h or 1d
            bucket = {
                "1h": "ts_hour",
                "1d": "toStartOfDay(ts_hour)",
            }[interval]
            sql = f"""
            SELECT
                source_id,
                toInt64(toUnixTimestamp({bucket})) * 1000 AS ts,
                min(min_value) AS min_v,
                max(max_value) AS max_v,
                IF(sum(count_value) > 0, sum(sum_value) / sum(count_value), 0) AS avg_v,
                sum(count_value) AS cnt
            FROM plexus.telemetry_1hr_dist
            WHERE org_id = {{org_id:String}}
              AND metric = {{metric:String}}
              AND ts_hour >= toDateTime(intDiv({{start_ms:Int64}}, 1000), 'UTC')
              AND ts_hour <  toDateTime(intDiv({{end_ms:Int64}}, 1000), 'UTC')
            GROUP BY source_id, {bucket}
            ORDER BY source_id, ts
            LIMIT {{limit:Int32}}
            """

        rows = (await self._client.query(sql, parameters=params)).result_rows
        out: dict[str, dict[str, list]] = {}
        for source_id, ts, min_v, max_v, avg_v, cnt in rows:
            if source_id not in out:
                out[source_id] = {"timestamp_ms": [], "min": [], "max": [], "avg": [], "count": []}
            out[source_id]["timestamp_ms"].append(ts)
            out[source_id]["min"].append(min_v)
            out[source_id]["max"].append(max_v)
            out[source_id]["avg"].append(avg_v)
            out[source_id]["count"].append(int(cnt))
        return out


