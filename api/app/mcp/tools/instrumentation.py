"""Instrumentation guidance tool — static markdown, one per SDK language.

Modeled on frontend/lib/agent-setup.ts (the paste-a-prompt onboarding); the
full agent-facing reference lives at https://plexus.company/agent.md.
"""

from typing import Literal

from app.core.config import settings
from mcp.types import ToolAnnotations

from app.mcp.server import mcp

_COMMON = """
## Workflow

1. Fetch https://plexus.company/agent.md and follow it as the reference.
2. Install the SDK (below).
3. Read the codebase and propose 5-10 metrics/events worth tracking — latency
   and errors on external calls, throughput, lifecycle, key domain events.
   Show the user the list (file:line, metric, why) and wait for approval.
4. If no API key exists yet: POST https://app.plexus.company/api/auth/claim
   with {"name":"<project-name>"}, give the user the verification_url to
   open, then poll GET https://app.plexus.company/api/auth/claim/<device_code>
   every 5s until approved.
5. Save the key as PLEXUS_API_KEY in a gitignored env file (add an empty entry
   to .env.example). Never hardcode or commit it.
6. Instrument the approved list under a lowercase-hyphenated source id
   (e.g. "order-service"). Never block the hot path or throw from telemetry.
7. Run it so at least one real point ships, then hand back the dashboard link:
   {app_url}/dashboards?quick=<source-id> — or build a curated dashboard with
   the create_dashboard tool.
"""

_PYTHON = """# Instrumenting with plexus-python

```bash
pip install plexus-python
```

```python
from plexus import Plexus

px = Plexus(source_id="my-service")  # reads PLEXUS_API_KEY from the env

px.send("queue_depth", 42)                      # numeric metric
px.send("battery_pct", 87.5, tags={"unit": "rover-1"})
px.event("deploy_started", "v1.4.2 rolling out")  # named event
```

Points are buffered and flushed in the background — telemetry never blocks
the hot path.
""" + _COMMON

_TYPESCRIPT = """# Instrumenting with plexus-typescript

```bash
npm install plexus-typescript
```

```ts
import { Plexus } from "plexus-typescript";

const px = new Plexus({ sourceId: "my-service" }); // reads PLEXUS_API_KEY

px.send("queue_depth", 42);                        // numeric metric
px.send("battery_pct", 87.5, { tags: { unit: "rover-1" } });
px.event("deploy_started", "v1.4.2 rolling out");  // named event
await px.flush();                                  // before process exit
```

Points are buffered and chunked automatically; browser apps should use
`plexus-typescript/browser` behind an ingest proxy (`plexus-typescript/server`)
so the API key stays server-side.
""" + _COMMON


@mcp.tool(annotations=ToolAnnotations(title="Get instrumentation guide", readOnlyHint=True))
async def get_instrumentation_guide(language: Literal["python", "typescript"]) -> str:
    """Get the guide for instrumenting an app with the Plexus SDK.

    Returns install + usage + onboarding steps (including how to obtain an
    API key via browser approval) for the given language. Use when adding
    Plexus telemetry to a codebase.
    """
    guide = _PYTHON if language == "python" else _TYPESCRIPT
    # str.replace, not str.format — the code samples are full of literal braces.
    return guide.replace("{app_url}", settings.app_url)
