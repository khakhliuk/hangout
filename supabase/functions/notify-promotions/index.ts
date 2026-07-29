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

const RATE_LIMIT = 20;
const RATE_WINDOW_MS = 60_000;

function clientIp(req: Request): string {
  return (
    req.headers.get("cf-connecting-ip") ??
    req.headers.get("x-forwarded-for")?.split(",")[0].trim() ??
    "unknown"
  );
}

const RATE_SCOPE = "notify-promotions";

// See notify-event: verify_jwt=true is satisfied by the public anon key, not
// a check on who's calling — this caps how often any one IP can trigger a
// promotion sweep for an arbitrary event_id. Shared `rate_limits` table
// across all functions, keyed by (scope, key).
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

// See notify-event: unescaped "&"/"<"/">" in HTML parse_mode text makes
// Telegram silently reject the whole message.
function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

type MemberRef = { tg_user_id: number } | null;
type PromoRow = {
  id: string;
  member_id: string | null;
  guest_name: string | null;
  promoted: MemberRef;
  inviter: MemberRef;
};

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
      .select("space_id, title")
      .eq("id", event_id)
      .single();
    if (!event) return json({ error: "event not found" }, 404);

    // Atomically claim pending promotions: flip the flag and return the rows in one
    // statement so concurrent invocations can't grab the same rsvp and double-notify.
    const { data: rows } = await db
      .from("rsvps")
      .update({ promo_pending: false })
      .eq("event_id", event_id)
      .eq("promo_pending", true)
      .select("id, member_id, guest_name, promoted:members!member_id(tg_user_id), inviter:members!invited_by(tg_user_id)");

    const promos = (rows ?? []) as unknown as PromoRow[];
    if (promos.length === 0) return json({ ok: true, notified: 0 });

    const keyboard = {
      inline_keyboard: [[{ text: "Відкрити в Hangout", url: `${MINIAPP_LINK}?startapp=e_${event_id}` }]],
    };

    // Respect the recipient's toggle. Default is on, so only users who explicitly
    // turned it off are excluded. user_settings is keyed by profile_id, so resolve
    // tg_user_id -> profile_id first.
    const candidates = promos
      .map((p) => (p.member_id ? p.promoted?.tg_user_id : p.inviter?.tg_user_id))
      .filter((id): id is number => typeof id === "number");
    const disabled = new Set<number>();
    if (candidates.length > 0) {
      const { data: profileRows } = await db
        .from("profiles")
        .select("id, tg_user_id")
        .in("tg_user_id", candidates);
      const idByTg = new Map((profileRows ?? []).map((p) => [p.tg_user_id as number, p.id as string]));
      const profileIds = [...idByTg.values()];
      if (profileIds.length > 0) {
        const { data: offRows } = await db
          .from("user_settings")
          .select("profile_id")
          .in("profile_id", profileIds)
          .eq("notify_promotions", false);
        const offProfileIds = new Set((offRows ?? []).map((r) => r.profile_id as string));
        for (const [tgId, pid] of idByTg) if (offProfileIds.has(pid)) disabled.add(tgId);
      }
    }

    let notified = 0;
    for (const p of promos) {
      let target: number | null = null;
      let text = "";
      if (p.member_id && p.promoted) {
        target = p.promoted.tg_user_id;
        text = `🎉 Звільнилось місце — ти тепер у списку на «${escapeHtml(event.title)}»!`;
      } else if (p.guest_name && p.inviter) {
        target = p.inviter.tg_user_id;
        text = `🎉 Твій +1 (${escapeHtml(p.guest_name)}) піднявся з черги на «${escapeHtml(event.title)}»!`;
      }
      if (target && !disabled.has(target)) {
        const result = await tg("sendMessage", {
          chat_id: target,
          text,
          parse_mode: "HTML",
          reply_markup: keyboard,
        });
        if (result.ok) notified++;
      }
    }

    return json({ ok: true, notified });
  } catch (e) {
    console.error("notify-promotions error:", e);
    return json({ error: "failed" }, 500);
  }
});
