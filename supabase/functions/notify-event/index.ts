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

const RATE_LIMIT = 30;
const RATE_WINDOW_MS = 60_000;

function clientIp(req: Request): string {
  return (
    req.headers.get("cf-connecting-ip") ??
    req.headers.get("x-forwarded-for")?.split(",")[0].trim() ??
    "unknown"
  );
}

const RATE_SCOPE = "notify-event";

// verify_jwt=true only checks the request carries a valid project JWT, and
// the public anon key (shipped in the frontend bundle) satisfies that — it's
// not a check on who's calling. This caps how often any one IP can trigger a
// chat message edit/send for an arbitrary event_id. Shared `rate_limits`
// table across all functions, keyed by (scope, key).
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

const dateFmt = new Intl.DateTimeFormat("uk-UA", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

// User-controlled text (event titles, names, place names) goes straight into
// an HTML-parse_mode message — unescaped "&"/"<"/">" makes Telegram reject
// the whole message with zero visible error, silently dropping the notification.
function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

type SlotRow = { id: string; starts_at: string; slot_votes: { member_id: string }[] };
type OptionRow = { id: string; places: { name: string } | null; place_votes: { member_id: string }[] };
type RsvpRow = { member_id: string | null; guest_name: string | null; status: string };

function buildText(event: {
  title: string;
  category: string;
  max_people: number | null;
  cost_per_person: number | null;
  cancelled_at: string | null;
  confirmed_at: string | null;
  confirmed_slot_id: string | null;
  confirmed_place_id: string | null;
  event_slots: SlotRow[];
  event_place_options: OptionRow[];
  rsvps: RsvpRow[];
}, creatorName: string): string {
  const emoji = CATEGORIES[event.category] ?? "✨";

  if (event.cancelled_at) {
    return `❌ Скасовано: ${emoji} <b>${escapeHtml(event.title)}</b>`;
  }

  if (!event.confirmed_at) {
    let text = `🗳 <b>Пропозиція:</b> ${emoji} <b>${escapeHtml(event.title)}</b>\n`;
    text += `від ${escapeHtml(creatorName)} — голосуй за дату й місце\n\n`;

    if (event.event_slots.length > 0) {
      text += "📅 <b>Коли</b>\n";
      const sorted = [...event.event_slots].sort((a, b) => b.slot_votes.length - a.slot_votes.length);
      const showSlotVotes = sorted.length > 1;
      for (const slot of sorted) {
        text += `  ${dateFmt.format(new Date(slot.starts_at))}${showSlotVotes ? `  —  ${slot.slot_votes.length} ✔` : ""}\n`;
      }
      text += "\n";
    }

    if (event.event_place_options.length > 0) {
      text += "📍 <b>Де</b>\n";
      const sorted = [...event.event_place_options].sort((a, b) => b.place_votes.length - a.place_votes.length);
      const showPlaceVotes = sorted.length > 1;
      for (const opt of sorted) {
        text += `  ${escapeHtml(opt.places?.name ?? "Місце")}${showPlaceVotes ? `  —  ${opt.place_votes.length} ✔` : ""}\n`;
      }
    }

    return text.trimEnd();
  }

  const slot = event.event_slots.find((s) => s.id === event.confirmed_slot_id);
  const place = event.event_place_options.find((o) => o.id === event.confirmed_place_id);
  const going = event.rsvps.filter((r) => r.status === "going");
  const waitlisted = event.rsvps.filter((r) => r.status === "waitlisted");

  // A single date and at most one place never went through a vote — framing
  // it as "Вирішено" would imply a decision that never happened.
  const hadVoting = event.event_slots.length > 1 || event.event_place_options.length > 1;
  let text = hadVoting
    ? `✅ <b>Вирішено:</b> ${emoji} <b>${escapeHtml(event.title)}</b>\n`
    : `${emoji} <b>${escapeHtml(event.title)}</b>\n`;
  if (slot) text += `📅 ${dateFmt.format(new Date(slot.starts_at))}\n`;
  if (place) text += `📍 ${escapeHtml(place.places?.name ?? "Місце")}\n`;
  text += "\n";

  const goingCount = going.length;
  const maxLabel = event.max_people ? `/${event.max_people}` : "";
  text += `👥 <b>${goingCount}${maxLabel}</b> йдуть`;
  if (waitlisted.length > 0) text += ` · ${waitlisted.length} у черзі`;
  if (event.cost_per_person) text += `\n💰 ${event.cost_per_person} ₴/особа`;

  return text;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { event_id, action } = await req.json();
    if (!event_id) return json({ error: "event_id required" }, 400);

    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    if (!(await checkRateLimit(db, clientIp(req)))) {
      return json({ error: "too many requests" }, 429);
    }

    if (action === "delete") {
      const { data: evt } = await db
        .from("events")
        .select("space_id, bot_message_id")
        .eq("id", event_id)
        .single();
      if (evt?.bot_message_id) {
        const { data: sp } = await db.from("spaces").select("tg_chat_id").eq("id", evt.space_id).single();
        if (sp) {
          await tg("deleteMessage", { chat_id: sp.tg_chat_id, message_id: evt.bot_message_id });
          await db.from("events").update({ bot_message_id: null }).eq("id", event_id);
        }
      }
      return json({ ok: true, deleted: true });
    }

    const { data: event, error: eventErr } = await db
      .from("events")
      .select(`
        id, space_id, title, category, created_by, max_people, cost_per_person, bot_message_id, cancelled_at,
        confirmed_at, confirmed_slot_id, confirmed_place_id,
        event_slots!event_slots_event_id_fkey(id, starts_at, slot_votes(member_id)),
        event_place_options!event_place_options_event_id_fkey(id, places(name), place_votes(member_id)),
        rsvps(member_id, guest_name, status)
      `)
      .eq("id", event_id)
      .single();
    if (eventErr || !event) return json({ error: "event not found" }, 404);

    const { data: space } = await db
      .from("spaces")
      .select("tg_chat_id")
      .eq("id", event.space_id)
      .single();
    if (!space) return json({ error: "space not found" }, 404);

    const { data: creator } = await db
      .from("members")
      .select("profiles!tg_user_id(first_name)")
      .eq("id", event.created_by)
      .maybeSingle();

    const text = buildText(event, (creator?.profiles as { first_name: string } | null)?.first_name ?? "Хтось");
    const keyboard = {
      inline_keyboard: [[{ text: "Відкрити в Hangout", url: `${MINIAPP_LINK}?startapp=e_${event.id}` }]],
    };

    // On confirmation, post a fresh message instead of editing the old
    // "🗳 Пропозиція" one in place — an edit doesn't bump the message or
    // notify anyone, so the decision would go unnoticed. Best-effort delete
    // the old one so the chat isn't left with a stale duplicate.
    const forceNew = action === "confirmed";
    if (forceNew && event.bot_message_id) {
      await tg("deleteMessage", { chat_id: space.tg_chat_id, message_id: event.bot_message_id }).catch(() => {});
    }

    if (event.bot_message_id && !forceNew) {
      const result = await tg("editMessageText", {
        chat_id: space.tg_chat_id,
        message_id: event.bot_message_id,
        text,
        parse_mode: "HTML",
        reply_markup: keyboard,
      });
      if (result.ok) {
        return json({ ok: true, updated: true, message_id: event.bot_message_id });
      }
      const desc = String(result.description ?? "");
      if (desc.includes("not modified")) {
        return json({ ok: true, notModified: true, message_id: event.bot_message_id });
      }
      // Message is gone or no longer editable (deleted, too old, lost rights) —
      // drop the stale id and fall through to post a fresh one so updates recover.
      await db.from("events").update({ bot_message_id: null }).eq("id", event_id);
    }

    const result = await tg("sendMessage", {
      chat_id: space.tg_chat_id,
      text,
      parse_mode: "HTML",
      reply_markup: keyboard,
    });

    if (result.ok && result.result?.message_id) {
      await db.from("events").update({ bot_message_id: result.result.message_id }).eq("id", event_id);
    }

    return json({ ok: true, updated: false, message_id: result.result?.message_id, tg: result });
  } catch (e) {
    console.error("notify-event error:", e);
    return json({ error: "failed" }, 500);
  }
});
