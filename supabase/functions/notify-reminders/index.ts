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

async function tg(method: string, payload: Record<string, unknown>) {
  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return await res.json();
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const CATEGORIES: Record<string, string> = {
  food: "🍜", drinks: "🍻", games: "🎲", culture: "🎭", sport: "⚽",
  nature: "🌲", home: "🏠", party: "🎉", trip: "🚗", other: "✨",
};

function formatTime(iso: string): string {
  const d = new Date(iso);
  const day = d.getUTCDate().toString().padStart(2, "0");
  const month = (d.getUTCMonth() + 1).toString().padStart(2, "0");
  const hours = d.getUTCHours().toString().padStart(2, "0");
  const minutes = d.getUTCMinutes().toString().padStart(2, "0");
  return `${day}.${month} о ${hours}:${minutes}`;
}

const REMINDER_WINDOWS = [60, 180, 1440];

const RATE_LIMIT = 5;
const RATE_WINDOW_MS = 10 * 60_000;

function clientIp(req: Request): string {
  return (
    req.headers.get("cf-connecting-ip") ??
    req.headers.get("x-forwarded-for")?.split(",")[0].trim() ??
    "unknown"
  );
}

const RATE_SCOPE = "notify-reminders";

// Shared `rate_limits` table across all functions, keyed by (scope, key).
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

  // This function is meant to run only from the Supabase Cron Job every 10
  // minutes, never from the internet at large — deployed with
  // --no-verify-jwt because the cron integration's net.http_post sends no
  // auth headers at all. The shared secret (set via `supabase secrets set
  // CRON_SECRET=...`, matched against a header configured on the cron job
  // itself) is what actually keeps this cron-only, on top of the per-IP rate
  // limit below.
  const cronSecret = Deno.env.get("CRON_SECRET");
  if (cronSecret && req.headers.get("x-cron-secret") !== cronSecret) {
    return new Response("forbidden", { status: 403 });
  }

  try {
    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const allowed = await checkRateLimit(db, clientIp(req));
    if (!allowed) {
      return new Response("too many requests", { status: 429 });
    }

    const now = new Date();
    let totalSent = 0;

    for (const minutes of REMINDER_WINDOWS) {
      const windowStart = new Date(now.getTime() + (minutes - 5) * 60_000);
      const windowEnd = new Date(now.getTime() + (minutes + 5) * 60_000);

      const { data: dueSlots } = await db
        .from("event_slots")
        .select("id, event_id, starts_at")
        .gte("starts_at", windowStart.toISOString())
        .lte("starts_at", windowEnd.toISOString());
      if (!dueSlots?.length) continue;

      const { data: events } = await db
        .from("events")
        .select("id, space_id, title, category, cancelled_at, confirmed_slot_id")
        .in("id", [...new Set(dueSlots.map((s) => s.event_id as string))])
        .not("confirmed_at", "is", null)
        .is("cancelled_at", null);

      const slotById = new Map(dueSlots.map((s) => [s.id as string, s]));
      const eventsInWindow = (events ?? []).filter((e) => e.confirmed_slot_id && slotById.has(e.confirmed_slot_id as string));
      if (!eventsInWindow.length) continue;

      const eventIds = eventsInWindow.map((e) => e.id as string);
      const eventMap = new Map(eventsInWindow.map((e) => [e.id as string, e]));
      const slotByEvent = new Map(
        eventsInWindow.map((e) => [e.id as string, slotById.get(e.confirmed_slot_id as string)!]),
      );

      const { data: goingRsvps } = await db
        .from("rsvps")
        .select("event_id, member_id")
        .in("event_id", eventIds)
        .eq("status", "going")
        .not("member_id", "is", null);
      if (!goingRsvps?.length) continue;

      const memberIds = [...new Set(goingRsvps.map((r) => r.member_id as string))];

      const { data: memberRows } = await db
        .from("members")
        .select("id, tg_user_id")
        .in("id", memberIds);
      if (!memberRows?.length) continue;

      const tgByMember = new Map(memberRows.map((m) => [m.id as string, m.tg_user_id as number]));
      const tgUserIds = [...new Set(tgByMember.values())];

      const { data: profileRows } = await db
        .from("profiles")
        .select("id, tg_user_id")
        .in("tg_user_id", tgUserIds);
      const profileByTg = new Map((profileRows ?? []).map((p) => [p.tg_user_id as number, p.id as string]));

      const profileIds = [...profileByTg.values()];
      const { data: settingsRows } = await db
        .from("user_settings")
        .select("profile_id")
        .in("profile_id", profileIds)
        .eq("reminder_minutes", minutes);
      const enabledProfiles = new Set((settingsRows ?? []).map((r) => r.profile_id as string));
      if (enabledProfiles.size === 0) continue;

      for (const rsvp of goingRsvps) {
        const eventId = rsvp.event_id as string;
        const memberId = rsvp.member_id as string;
        const event = eventMap.get(eventId);
        const slot = slotByEvent.get(eventId);
        if (!event || !slot) continue;

        const tgUserId = tgByMember.get(memberId);
        if (!tgUserId) continue;

        const profileId = profileByTg.get(tgUserId);
        if (!profileId || !enabledProfiles.has(profileId)) continue;

        const { data: alreadySent } = await db
          .from("event_reminders_sent")
          .select("event_id")
          .eq("event_id", eventId)
          .eq("profile_id", profileId)
          .eq("minutes", minutes)
          .maybeSingle();
        if (alreadySent) continue;

        const { error: insertErr } = await db
          .from("event_reminders_sent")
          .insert({ event_id: eventId, profile_id: profileId, minutes });
        if (insertErr) continue;

        const emoji = CATEGORIES[event.category] ?? "✨";
        const label = minutes >= 1440 ? "завтра" : `через ${minutes === 60 ? "годину" : "3 години"}`;
        const text = `⏰ Нагадування: ${emoji} <b>${escapeHtml(event.title)}</b> — ${label}, ${formatTime(slot.starts_at)}`;
        const keyboard = {
          inline_keyboard: [[{ text: "Відкрити в Hangout", url: `${MINIAPP_LINK}?startapp=e_${eventId}` }]],
        };

        const result = await tg("sendMessage", {
          chat_id: tgUserId,
          text,
          parse_mode: "HTML",
          reply_markup: keyboard,
        });
        if (result.ok) totalSent++;
      }
    }

    return json({ ok: true, sent: totalSent });
  } catch (e) {
    console.error("notify-reminders error:", e);
    return json({ error: "failed" }, 500);
  }
});
