/**
 * The paste-into-your-coding-agent setup prompt. Canonical copy also ships
 * on the marketing homepage (marketing/lib/content.ts `instrument`) — keep
 * the two in sync when the flow changes. The full agent-facing reference
 * lives at https://plexus.company/agent.md.
 */

/** Lead-in paragraph shown above the prompt wherever it's surfaced. */
export const AGENT_SETUP_LEAD =
  "Paste this into Claude Code, Cursor, or any coding agent open in your app's repo. It installs the SDK, proposes what to track, and requests an API key you approve in one click — your dashboard appears when the first data lands.";

export const AGENT_SETUP_PROMPT = `Set up Plexus telemetry in this project.

1. Fetch https://plexus.company/agent.md and follow it as your reference.
2. Python projects: pip install plexus-python. Any other language: no SDK — POST JSON to the gateway /ingest endpoint over plain HTTP (x-api-key header).
3. Read the codebase and propose 5-10 metrics/events worth tracking — latency and errors on external calls, throughput, lifecycle, key domain events. Show me the list (file:line, metric, why) and wait for my approval.
4. Request an API key: POST https://app.plexus.company/api/auth/claim with {"name":"<project-name>"}. Give me the verification_url to open in my browser, then poll GET https://app.plexus.company/api/auth/claim/<device_code> every 5s until approved.
5. Save the key as PLEXUS_API_KEY in the gitignored env file and add an empty entry to .env.example. Never hardcode or commit it.
6. Instrument the approved list with px.send()/px.event() under source id "<kebab-project-name>". Never block the hot path or throw from telemetry.
7. Run it so at least one real point ships, then give me my dashboard link: https://app.plexus.company/dashboards?quick=<source-id>.`;
