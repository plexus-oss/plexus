/**
 * POST /api/contact
 *
 * "Talk to sales" inbound from the in-app upgrade modal. Mirrors the
 * marketing site's /api/contact handler — sends a single email to
 * CONTACT_TO via Resend. No persistence; this is just a notification.
 */

import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, getClientIp } from "@/lib/rate-limiter";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  // Anonymous email-send spam vector — strict per-IP limit
  const rate = checkRateLimit(`contact:${getClientIp(req)}`, 5, 60 * 60 * 1000);
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "RATE_LIMITED", message: "Too many requests. Try again later." },
      { status: 429, headers: { "Retry-After": String(rate.retryAfter ?? 60) } },
    );
  }

  let body: { name?: string; company?: string; message?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }

  const name = (body.name ?? "").trim();
  const company = (body.company ?? "").trim();
  const message = (body.message ?? "").trim();

  if (!name || !company || !message) {
    return NextResponse.json({ error: "missing fields" }, { status: 400 });
  }
  if (name.length > 200 || company.length > 200 || message.length > 5000) {
    return NextResponse.json({ error: "too long" }, { status: 400 });
  }

  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.log("[contact] RESEND_API_KEY not set — logging submission", {
      name,
      company,
      message,
    });
    return NextResponse.json({ ok: true });
  }

  const from = process.env.RESEND_FROM ?? "Plexus <noreply@plexus.company>";
  const to = process.env.CONTACT_TO ?? "info@plexus.company";

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [to],
        subject: `plexus inbound — ${name} @ ${company}`,
        text: `name: ${name}\ncompany: ${company}\n\n${message}`,
      }),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      console.error("[contact] resend error", res.status, errText);
      return NextResponse.json({ error: "send failed" }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[contact] resend exception", err);
    return NextResponse.json({ error: "send failed" }, { status: 500 });
  }
}
