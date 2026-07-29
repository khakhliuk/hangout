import { createClient } from "npm:@supabase/supabase-js@2";

const ADMIN_CHAT_ID = 6711795713;
const MAX_TEXT_LENGTH = 2000;
const RATE_LIMIT = 3;
const RATE_WINDOW_MS = 30 * 60_000;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

async function tg(botToken: string, method: string, payload: Record<string, unknown>) {
  const res = await fetch(`https://api.telegram.org/bot${botToken}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return await res.json();
}

const RATE_SCOPE = "feedback";

// Fixed-window counter kept in Postgres (not in-memory) since edge function
// instances aren't guaranteed to be the same process across requests. Shared
// `rate_limits` table across all functions, keyed by (scope, key) — key here
// is the profile_id, not an IP.
async function checkRateLimit(db: ReturnType<typeof createClient>, profileId: string): Promise<boolean> {
  const now = Date.now();
  const { data } = await db
    .from("rate_limits")
    .select("window_start, count")
    .eq("scope", RATE_SCOPE)
    .eq("key", profileId)
    .maybeSingle();

  if (!data || now - new Date(data.window_start).getTime() > RATE_WINDOW_MS) {
    await db
      .from("rate_limits")
      .upsert({ scope: RATE_SCOPE, key: profileId, window_start: new Date(now).toISOString(), count: 1 });
    return true;
  }
  if (data.count >= RATE_LIMIT) return false;
  await db.from("rate_limits").update({ count: data.count + 1 }).eq("scope", RATE_SCOPE).eq("key", profileId);
  return true;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const botToken = Deno.env.get("BOT_TOKEN")!;

  const authHeader = req.headers.get("Authorization") ?? "";
  const jwt = authHeader.replace(/^Bearer\s+/i, "");
  const anon = createClient(supabaseUrl, anonKey, { auth: { persistSession: false } });
  const { data: userRes, error: userErr } = await anon.auth.getUser(jwt);
  if (userErr || !userRes.user) {
    return json({ error: "unauthorized" }, 401);
  }

  const db = createClient(supabaseUrl, serviceRole);
  const allowed = await checkRateLimit(db, userRes.user.id);
  if (!allowed) {
    return json({ error: "too many requests" }, 429);
  }

  let text: string;
  try {
    const body = await req.json();
    text = String(body.text ?? "").trim();
  } catch {
    return json({ error: "invalid body" }, 400);
  }
  if (!text) return json({ error: "text required" }, 400);
  if (text.length > MAX_TEXT_LENGTH) return json({ error: "text too long" }, 400);

  const tgUserId = (userRes.user.app_metadata as { tg_user_id?: number } | null)?.tg_user_id ?? null;

  const { data: profile } = await db
    .from("profiles")
    .select("first_name, username")
    .eq("id", userRes.user.id)
    .maybeSingle();

  let spaceTitles = "—";
  if (tgUserId) {
    const { data: memberRows } = await db
      .from("members")
      .select("spaces(title)")
      .eq("tg_user_id", tgUserId);
    const titles = (memberRows ?? [])
      .map((m) => (m.spaces as { title: string } | null)?.title)
      .filter((t): t is string => !!t);
    if (titles.length > 0) spaceTitles = titles.join(", ");
  }

  const displayName = profile?.first_name || "Невідомо";
  const usernameLine = profile?.username ? ` (@${escapeHtml(profile.username)})` : "";

  const infoLines = [
    `👤 ${escapeHtml(displayName)}${usernameLine}`,
    `tg_user_id: <code>${tgUserId ?? "?"}</code>`,
    `profile_id: <code>${userRes.user.id}</code>`,
    `Спейси: ${escapeHtml(spaceTitles)}`,
  ].join("\n");

  const message = `📝 <b>Фідбек</b>\n\n${escapeHtml(text)}\n\n—\n${infoLines}`;

  const result = await tg(botToken, "sendMessage", {
    chat_id: ADMIN_CHAT_ID,
    text: message,
    parse_mode: "HTML",
  });
  if (!result.ok) {
    console.error("feedback sendMessage failed:", JSON.stringify(result));
    return json({ error: "delivery failed" }, 502);
  }

  return json({ ok: true });
});
