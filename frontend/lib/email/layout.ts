/**
 * Shared branded layout for Plexus transactional emails.
 *
 * Every customer-facing email (onboarding drips, sign-in code, org invite)
 * renders through `renderEmail` so they share one shell: the Plexus logo, a
 * white 560px card on a light background, a styled CTA button, and a footer
 * with Docs / Dashboard / reply-to links. The shape mirrors the alert
 * notification card in lib/integrations/email.ts — same width, border, and
 * footer treatment — so the whole product speaks with one voice.
 *
 * Constraints (don't break these — they're what makes mail clients behave):
 *  - Inline styles only on structural/CTA elements. A small <style> block in
 *    <head> covers paragraph spacing and inline-link color for clients that
 *    honor it (Apple Mail, Gmail); clients that strip it still render legibly.
 *  - System fonts only. No web fonts, no external CSS.
 *  - Absolute asset host for the logo so it resolves with no app context.
 */

const BRAND = {
  ink: "#18181b", // zinc-900 — headings, primary button, brand
  body: "#3f3f46", // zinc-700 — body copy
  muted: "#71717a", // zinc-500 — footer, fine print
  faint: "#a1a1aa", // zinc-400 — signoff
  hairline: "#e4e4e7", // zinc-200 — borders/dividers
  pageBg: "#f4f4f5", // zinc-100 — page background behind the card
  cardBg: "#ffffff",
};

export function appUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL || "https://app.plexus.company";
}

const DOCS_URL = "https://docs.plexus.company";

export interface RenderEmailArgs {
  /** Inner HTML for the card body (paragraphs, lists, the CTA button). */
  bodyHtml: string;
  /**
   * Hidden inbox-preview text shown after the subject in most clients.
   * Keep it short and specific — it's the first thing they read.
   */
  preheader?: string;
}

/**
 * A primary call-to-action button. Use this for the one main action in an
 * email; inline `<a>` links are fine for secondary actions.
 */
export function emailButton(href: string, label: string): string {
  return `<a href="${href}" style="display:inline-block;padding:11px 20px;background:${BRAND.ink};color:#ffffff;text-decoration:none;border-radius:8px;font-size:14px;font-weight:600;line-height:1;">${label}</a>`;
}

/**
 * Wrap body HTML in the branded shell: logo header, card, and footer.
 */
export function renderEmail(args: RenderEmailArgs): string {
  const url = appUrl();
  const preheader = args.preheader
    ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;height:0;width:0;">${args.preheader}</div>`
    : "";

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <style>
    .plx-body p { margin: 0 0 14px; }
    .plx-body a { color: ${BRAND.ink}; font-weight: 600; }
    .plx-body code { font-family: 'SF Mono', Menlo, Consolas, monospace; font-size: 13px; background: ${BRAND.pageBg}; border: 1px solid ${BRAND.hairline}; border-radius: 4px; padding: 1px 5px; }
  </style>
</head>
<body style="margin:0;padding:0;background:${BRAND.pageBg};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  ${preheader}
  <div style="max-width:560px;margin:0 auto;padding:32px 16px;">
    <div style="background:${BRAND.cardBg};border:1px solid ${BRAND.hairline};border-radius:12px;overflow:hidden;">
      <div style="padding:24px 32px 0;">
        <img src="${url}/black.png" alt="Plexus" width="32" height="32" style="display:block;" />
      </div>
      <div class="plx-body" style="padding:20px 32px 28px;font-size:15px;line-height:1.6;color:${BRAND.body};">
        ${args.bodyHtml}
      </div>
    </div>
    <div style="padding:18px 32px 0;font-size:12px;line-height:1.6;color:${BRAND.muted};text-align:center;">
      <a href="${DOCS_URL}" style="color:${BRAND.muted};text-decoration:none;font-weight:500;">Docs</a>
      &nbsp;·&nbsp;
      <a href="${url}/" style="color:${BRAND.muted};text-decoration:none;font-weight:500;">Dashboard</a>
      &nbsp;·&nbsp;
      <span>Reply to this email to reach the founder</span>
      <div style="margin-top:10px;color:${BRAND.faint};">Plexus — telemetry for hardware fleets</div>
    </div>
  </div>
</body>
</html>`;
}

/** Greeting helper shared by templates: "Hi Ann —" or a neutral "Hi —". */
export function greeting(name?: string | null): string {
  return name ? `Hi ${name} —` : "Hi —";
}

export { DOCS_URL };
