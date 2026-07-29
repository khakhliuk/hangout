// Serves a generated .ics file from query params so it can be opened via
// Telegram's openLink (which requires a real https:// URL — data: URIs and
// client-side Blob downloads are both unreliable inside the Mini App
// webview, see miniapp/src/lib/calendar.ts). Stateless: no DB access besides
// a per-IP rate limit counter, the caller already has all the fields from
// the event it's currently viewing.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Any real line break in the input must become the escaped literal "\n"
// (backslash + n), never a raw CR/LF byte — otherwise it terminates the
// current property line early and lets the caller smuggle extra lines
// (e.g. another property, or a second VEVENT) into the generated file.
function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\r|\n/g, "\\n");
}

const MAX_FIELD_LENGTH = 200;
const RATE_LIMIT = 20;
const RATE_WINDOW_MS = 60_000;

function formatIcsDate(iso: string): string {
  return new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

const DEFAULT_DURATION_HOURS = 2;

function clientIp(req: Request): string {
  return (
    req.headers.get("cf-connecting-ip") ??
    req.headers.get("x-forwarded-for")?.split(",")[0].trim() ??
    "unknown"
  );
}

const RATE_SCOPE = "ics";

// Fixed-window counter kept in Postgres (not in-memory) since edge function
// instances aren't guaranteed to be the same process across requests. Shared
// `rate_limits` table across all functions, keyed by (scope, key).
async function checkRateLimit(db: ReturnType<typeof createClient>, ip: string): Promise<boolean> {
  const now = Date.now();
  const { data } = await db
    .from("rate_limits")
    .select("window_start, count")
    .eq("scope", RATE_SCOPE)
    .eq("key", ip)
    .maybeSingle();

  if (!data || now - new Date(data.window_start).getTime() > RATE_WINDOW_MS) {
    await db
      .from("rate_limits")
      .upsert({ scope: RATE_SCOPE, key: ip, window_start: new Date(now).toISOString(), count: 1 });
    return true;
  }
  if (data.count >= RATE_LIMIT) return false;
  await db.from("rate_limits").update({ count: data.count + 1 }).eq("scope", RATE_SCOPE).eq("key", ip);
  return true;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const ip = clientIp(req);
  const allowed = await checkRateLimit(db, ip);
  if (!allowed) {
    return new Response("too many requests", { status: 429, headers: corsHeaders });
  }

  const url = new URL(req.url);
  const title = url.searchParams.get("title");
  const startsAt = url.searchParams.get("starts_at");
  const location = url.searchParams.get("location");
  const rawUid = url.searchParams.get("uid");
  const uid = rawUid && /^[a-zA-Z0-9-]{1,100}$/.test(rawUid) ? rawUid : crypto.randomUUID();

  if (!title || !startsAt || Number.isNaN(new Date(startsAt).getTime())) {
    return new Response("title and starts_at required", { status: 400, headers: corsHeaders });
  }
  if (title.length > MAX_FIELD_LENGTH || (location && location.length > MAX_FIELD_LENGTH)) {
    return new Response("title/location too long", { status: 400, headers: corsHeaders });
  }

  const start = new Date(startsAt);
  const end = new Date(start.getTime() + DEFAULT_DURATION_HOURS * 60 * 60 * 1000);

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Hangout//UA",
    "BEGIN:VEVENT",
    `UID:${uid}@hangout`,
    `DTSTAMP:${formatIcsDate(new Date().toISOString())}`,
    `DTSTART:${formatIcsDate(start.toISOString())}`,
    `DTEND:${formatIcsDate(end.toISOString())}`,
    `SUMMARY:${escapeIcsText(title)}`,
  ];
  if (location) lines.push(`LOCATION:${escapeIcsText(location)}`);
  lines.push("END:VEVENT", "END:VCALENDAR");

  return new Response(lines.join("\r\n"), {
    headers: {
      ...corsHeaders,
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'attachment; filename="event.ics"',
    },
  });
});
