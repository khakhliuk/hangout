import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const BOT_TOKEN = Deno.env.get("BOT_TOKEN")!;
const MINIAPP_LINK = Deno.env.get("MINIAPP_LINK") ?? "https://t.me/hangoutappbot/app";

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

const RATE_LIMIT = 10;
const RATE_WINDOW_MS = 60_000;

function clientIp(req: Request): string {
  return (
    req.headers.get("cf-connecting-ip") ??
    req.headers.get("x-forwarded-for")?.split(",")[0].trim() ??
    "unknown"
  );
}

const RATE_SCOPE = "notify-new-event";

// See notify-event: verify_jwt=true is satisfied by the public anon key, not
// a check on who's calling — this caps how often any one IP can trigger a
// round of DMs for an arbitrary event_id. Shared `rate_limits` table across
// all functions, keyed by (scope, key).
async function checkRateLimit(db: ReturnType<typeof createClient>, ip: string): Promise<boolean> {
  const now = Date.now();
  const { data } = await db
    .from("rate_limits")
    .select("window_start, count")
    .eq("scope", RATE_SCOPE)
    .eq("key", ip)
    .maybeSingle();

  if (!data || now - new Date(data.window_start).getTime() > RATE_WINDOW_MS) {
    await db.from("rate_limits").upsert({ scope: RATE_SCOPE, key: ip, window_start: new Date(now).toISOString(), count: 1 });
    return true;
  }
  if (data.count >= RATE_LIMIT) return false;
  await db.from("rate_limits").update({ count: data.count + 1 }).eq("scope", RATE_SCOPE).eq("key", ip);
  return true;
}

async function tg(method: string, payload: Record<string, unknown>) {
  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return await res.json();
}

const CATEGORIES: Record<string, string> = {
  food: "🍜", drinks: "🍻", games: "🎲", culture: "🎭", sport: "⚽",
  nature: "🌲", home: "🏠", party: "🎉", trip: "🚗", other: "✨",
};

// See notify-event: unescaped "&"/"<"/">" in HTML parse_mode text makes
// Telegram silently reject the whole message.
function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { event_id } = await req.json();
    if (!event_id) return json({ error: "event_id required" }, 400);

    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    if (!(await checkRateLimit(db, clientIp(req)))) {
      return json({ error: "too many requests" }, 429);
    }

    const { data: event } = await db
      .from("events")
      .select("space_id, title, category, created_by, spaces(title)")
      .eq("id", event_id)
      .single();
    if (!event) return json({ error: "event not found" }, 404);

    const { data: creator } = await db
      .from("members")
      .select("profiles!tg_user_id(first_name)")
      .eq("id", event.created_by)
      .maybeSingle();

    // Everyone in the space except the creator.
    const { data: members } = await db
      .from("members")
      .select("tg_user_id")
      .eq("space_id", event.space_id)
      .neq("id", event.created_by);

    const ids = (members ?? []).map((m) => m.tg_user_id as number);
    if (ids.length === 0) return json({ ok: true, notified: 0 });

    // Opt-in only: default is off, so notify just those who explicitly enabled it.
    // user_settings is keyed by profile_id, so resolve tg_user_id -> profile_id first.
    const { data: profileRows } = await db
      .from("profiles")
      .select("id, tg_user_id")
      .in("tg_user_id", ids);
    const idByTg = new Map((profileRows ?? []).map((p) => [p.tg_user_id as number, p.id as string]));
    const profileIds = [...idByTg.values()];

    const enabled = new Set<number>();
    if (profileIds.length > 0) {
      const { data: onRows } = await db
        .from("user_settings")
        .select("profile_id")
        .in("profile_id", profileIds)
        .eq("notify_new_events", true);
      const onProfileIds = new Set((onRows ?? []).map((r) => r.profile_id as string));
      for (const [tgId, pid] of idByTg) if (onProfileIds.has(pid)) enabled.add(tgId);
    }
    if (enabled.size === 0) return json({ ok: true, notified: 0 });

    const emoji = CATEGORIES[event.category] ?? "✨";
    const spaceTitle = (event.spaces as { title: string } | null)?.title ?? "спейсі";
    const creatorName = (creator?.profiles as { first_name: string } | null)?.first_name ?? "когось";
    const text = `${emoji} Новий івент у «${escapeHtml(spaceTitle)}»: <b>${escapeHtml(event.title)}</b>\nвід ${escapeHtml(creatorName)}`;
    const keyboard = {
      inline_keyboard: [[{ text: "Відкрити в Hangout", url: `${MINIAPP_LINK}?startapp=e_${event_id}` }]],
    };

    let notified = 0;
    for (const id of enabled) {
      const result = await tg("sendMessage", {
        chat_id: id,
        text,
        parse_mode: "HTML",
        reply_markup: keyboard,
      });
      if (result.ok) notified++;
    }

    return json({ ok: true, notified });
  } catch (e) {
    console.error("notify-new-event error:", e);
    return json({ error: "failed" }, 500);
  }
});
