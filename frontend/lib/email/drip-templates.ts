/**
 * Email drip templates — tier_1 onboarding sequence.
 *
 * Each template is a pure function from props → { subject, html } so
 * they can be unit-tested without touching Resend. Every template renders
 * through the shared branded shell in ./layout (Plexus logo, white card,
 * styled CTA button, Docs/Dashboard footer) so the whole sequence looks
 * like it comes from one product. Keep the copy short and the body to one
 * primary CTA — the shell does the brand work.
 *
 * The orchestrator in drip.ts decides which template to fire and is
 * responsible for idempotency. Don't duplicate that here.
 */

import { DOCS_URL, emailButton, greeting, renderEmail } from "./layout";

export interface BaseDripProps {
  orgName: string;
  recipientFirstName?: string | null;
  appUrl: string;
}

export interface CardNudgeProps extends BaseDripProps {
  creditsUsedUsd: number;
  pct: number;
}

export interface DripContent {
  subject: string;
  html: string;
}

/**
 * D+0 — Welcome. Fired once on org creation. The flagship email: sets the
 * relationship, points to the 3-line snippet, links the docs, and offers a
 * direct line to the founder. Read it twice before tweaking.
 */
export function welcomeEmail(props: BaseDripProps): DripContent {
  const body = `
    <p style="font-size:20px;font-weight:600;color:#18181b;margin:0 0 14px;">Welcome to Plexus, ${props.orgName}</p>
    <p>You're in. Add a card to start ingesting — from there you're <strong>usage-priced from the first data point</strong>, so you only ever pay for what you actually use.</p>
    <p>Three lines of code stand between you and your first live dashboard:</p>
    <p style="margin:18px 0 22px;">${emailButton(`${props.appUrl}/?onboarding=1`, "Run the snippet →")}</p>
    <p>No device handy? Pick <strong>"Try with sample data"</strong> on the same screen and watch a dashboard build itself.</p>
    <p style="margin-top:20px;padding-top:18px;border-top:1px solid #e4e4e7;font-size:14px;color:#71717a;">
      Handy links: <a href="${DOCS_URL}">Read the docs</a> &nbsp;·&nbsp;
      <a href="${props.appUrl}/?onboarding=1">Send your first metric</a>
    </p>
    <p style="font-size:14px;color:#71717a;">If anything is sticky, just reply — it lands directly in the founder's inbox. Plexus is small enough that we still answer support ourselves.</p>
    <p style="color:#a1a1aa;">— Plexus</p>
  `;
  return {
    subject: `Welcome to Plexus, ${props.orgName}`,
    html: renderEmail({
      bodyHtml: body,
      preheader:
        "You're in — add a card and send your first metric. Usage-priced from the first point.",
    }),
  };
}

/**
 * D+1 — Stuck without data. Fired if it's been ~24h and the org has
 * never ingested anything. Single CTA, plus the founder line.
 */
export function noDataD1Email(props: BaseDripProps): DripContent {
  const body = `
    <p>${greeting(props.recipientFirstName)}</p>
    <p>Noticed you signed up for Plexus yesterday but haven't sent any
       data yet. Most folks who get stuck here are missing one of three
       things — happy to debug live.</p>
    <p>Fastest path to a dashboard: open the console, pick
       <strong>Try with sample data</strong>, and watch the dashboard
       build itself.</p>
    <p style="margin:18px 0 22px;">${emailButton(`${props.appUrl}/?onboarding=1`, "Open the console →")}</p>
    <p>Prefer to wire up a real device? The <a href="${DOCS_URL}">quickstart docs</a> get you there in a few minutes.</p>
    <p style="font-size:14px;color:#71717a;">Or just hit reply — goes straight to the founder, fast answer.</p>
    <p style="color:#a1a1aa;">— Plexus</p>
  `;
  return {
    subject: `${props.orgName} — stuck on the first metric?`,
    html: renderEmail({
      bodyHtml: body,
      preheader:
        "One of three things is usually the blocker — here's the fastest path.",
    }),
  };
}

/**
 * D+0 first data — Celebration. Fired when first data lands. Reminds
 * them what just happened and points them at sharing.
 */
export function firstDataEmail(props: BaseDripProps): DripContent {
  const body = `
    <p style="font-size:20px;font-weight:600;color:#18181b;margin:0 0 14px;">Your first metric just landed</p>
    <p>First row from <strong>${props.orgName}</strong> is in. We built
       you a starter dashboard from the metrics it saw.</p>
    <p style="margin:18px 0 22px;">${emailButton(`${props.appUrl}/`, "Open your dashboard →")}</p>
    <p>Two things people do next:</p>
    <p>·  <strong>Share it</strong> — every dashboard has a view-only
       share link. Drop one in your team's Slack and let them see what
       you see.<br/>
       ·  <strong>Set an alert</strong> — pick a metric, pick a threshold,
       get pinged when it breaches.</p>
    <p style="color:#a1a1aa;">— Plexus</p>
  `;
  return {
    subject: `Your first metric just landed`,
    html: renderEmail({
      bodyHtml: body,
      preheader: "We built you a starter dashboard from the metrics we saw.",
    }),
  };
}

/**
 * D+3 — Next steps. Fired ~3 days after first data lands. Concrete
 * suggestions, no fluff.
 */
export function nextStepsD3Email(props: BaseDripProps): DripContent {
  const body = `
    <p>${greeting(props.recipientFirstName)}</p>
    <p>${props.orgName} has been ingesting for a few days now. Three
       moves that pay off:</p>
    <p>·  <strong>Build a custom dashboard.</strong> The starter is
       fine; a hand-built one is better. <a href="${props.appUrl}/dashboards">New dashboard →</a><br/>
       ·  <strong>Run an RCA.</strong> Pick a metric that spiked, ask
       Plexus to explain why.<br/>
       ·  <strong>Invite a teammate.</strong> Invite up to 5 teammates.</p>
    <p style="font-size:14px;color:#71717a;">What's missing? Hit reply.</p>
    <p style="color:#a1a1aa;">— Plexus</p>
  `;
  return {
    subject: `${props.orgName} on Plexus — what to try next`,
    html: renderEmail({
      bodyHtml: body,
      preheader: "Custom dashboards, RCA, and inviting your team.",
    }),
  };
}

/**
 * D+7 — How's it going. One-question email; reply lands in the founder's
 * inbox. No CTA button — the ask IS the CTA.
 */
export function feedbackD7Email(props: BaseDripProps): DripContent {
  const body = `
    <p>${greeting(props.recipientFirstName)}</p>
    <p>You've had Plexus for a week. Honest question: what's working,
       and what's annoying?</p>
    <p>Reply with one line. We read every one and ship fixes weekly.</p>
    <p style="color:#a1a1aa;">— Plexus</p>
  `;
  return {
    subject: `Quick one — how's Plexus going?`,
    html: renderEmail({
      bodyHtml: body,
      preheader: "One line back — what's working, what's annoying?",
    }),
  };
}

/**
 * Card nudge — fires once per calendar month per org that's sending
 * data without a card on file. Tone: "you're winning, drop a card so
 * we don't pause you." Plexus is usage-priced from the first point, so
 * a cardless org's keys get soft-disabled until a card is added.
 */
export function cardNudgeEmail(props: CardNudgeProps): DripContent {
  const usageFormatted = props.creditsUsedUsd.toFixed(2);
  const body = `
    <p>${greeting(props.recipientFirstName)}</p>
    <p><strong>${props.orgName}</strong> has run up <strong>$${usageFormatted}</strong> in usage so far this month — and there's no card on file yet.</p>
    <p>Add a card now and your data keeps flowing without interruption. Usage pricing:
       <code>$0.10 / million metrics</code>,
       <code>$0.10 / million logs</code>,
       <code>$0.25 / video hour</code>.</p>
    <p style="margin:18px 0 22px;">${emailButton(`${props.appUrl}/settings?tab=billing`, "Add a card →")}</p>
    <p style="color:#a1a1aa;">— Plexus</p>
  `;
  return {
    subject: `${props.orgName} | your Plexus usage this month`,
    html: renderEmail({
      bodyHtml: body,
      preheader: "Add a card so your data keeps flowing without interruption.",
    }),
  };
}
