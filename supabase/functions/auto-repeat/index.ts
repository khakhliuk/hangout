import { createClient } from "npm:@supabase/supabase-js@2";

// Triggered daily by a Supabase Cron Job (Dashboard → Integrations → Cron),
// not by end users — set up separately, not part of migrations. Creates the
// next occurrence once the current one's date has already passed: by then
// voting on the current one is moot anyway (it already happened), so there's
// no fairness concern about rushing people who are still deciding on it.
// `repeated_at` on the source event guards against creating duplicates on
// subsequent daily runs.

type SlotRow = { starts_at: string };
type OptionRow = { id: string; places: { id: string } | null };
type EventCandidate = {
  id: string;
  space_id: string;
  created_by: string;
  title: string;
  category: string;
  max_people: number | null;
  cost_per_person: number | null;
  recurrence: "weekly" | "monthly";
  confirmed_place_id: string | null;
  event_slots: SlotRow[];
  event_place_options: OptionRow[];
};

// Kept in sync with DISPLAY_TZ in notify-reminders / notify-event.
const DISPLAY_TZ = "Europe/Kyiv";

// How far ahead of UTC `tz` is at that particular instant, in ms. Derived by
// rendering the instant as wall-clock components in `tz` and re-reading them
// as if they were UTC — the gap between the two is the offset in effect then,
// which is what makes this DST-aware rather than a fixed +2/+3.
// Returns null if the runtime's ICU build rejects the named zone, so callers
// can fall back to plain UTC arithmetic instead of taking the whole run down.
function tzOffsetMs(instant: Date, tz: string): number | null {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
      hourCycle: "h23",
    }).formatToParts(instant);
    const part = (type: string) => Number(parts.find((p) => p.type === type)!.value);
    const asIfUtc = Date.UTC(
      part("year"), part("month") - 1, part("day"),
      part("hour"), part("minute"), part("second"),
    );
    return asIfUtc - instant.getTime();
  } catch (e) {
    console.error(`auto-repeat: timeZone "${tz}" unsupported, using UTC arithmetic:`, e);
    return null;
  }
}

// A repeat keeps the same *wall-clock* time, not the same UTC offset: an 18:00
// event stays 18:00 for the people attending it. Naive UTC arithmetic (+7 days
// on the raw instant) silently shifts it by an hour across a DST boundary,
// because 15:00Z is 18:00 Kyiv in summer but 17:00 Kyiv in winter. So do the
// arithmetic on the local calendar and convert back, re-reading the offset at
// the target date in case the shift crossed a transition.
function nextOccurrence(baseIso: string, recurrence: "weekly" | "monthly"): Date {
  const base = new Date(baseIso);
  const baseOffset = tzOffsetMs(base, DISPLAY_TZ) ?? 0;

  // Local wall-clock components, parked in a UTC-based Date purely so the
  // setUTC* helpers do plain calendar math on them with no zone of their own.
  const wall = new Date(base.getTime() + baseOffset);
  if (recurrence === "weekly") wall.setUTCDate(wall.getUTCDate() + 7);
  else wall.setUTCMonth(wall.getUTCMonth() + 1);

  const provisional = new Date(wall.getTime() - baseOffset);
  const targetOffset = tzOffsetMs(provisional, DISPLAY_TZ) ?? baseOffset;
  return targetOffset === baseOffset ? provisional : new Date(wall.getTime() - targetOffset);
}

const RATE_LIMIT = 5;
const RATE_WINDOW_MS = 10 * 60_000;

function clientIp(req: Request): string {
  return (
    req.headers.get("cf-connecting-ip") ??
    req.headers.get("x-forwarded-for")?.split(",")[0].trim() ??
    "unknown"
  );
}

const RATE_SCOPE = "auto-repeat";

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
  // This function is meant to run only from the daily Supabase Cron Job,
  // never from the internet at large — deployed with --no-verify-jwt because
  // the cron integration's net.http_post sends no auth headers at all. The
  // shared secret (set via `supabase secrets set CRON_SECRET=...`, matched
  // against a header configured on the cron job itself) is what actually
  // keeps this cron-only, on top of the per-IP rate limit below.
  const cronSecret = Deno.env.get("CRON_SECRET");
  if (cronSecret && req.headers.get("x-cron-secret") !== cronSecret) {
    return new Response("forbidden", { status: 403 });
  }

  const debug = new URL(req.url).searchParams.get("debug") === "1";
  const debugInfo: unknown[] = [];
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const db = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const allowed = await checkRateLimit(db, clientIp(req));
  if (!allowed) {
    return new Response("too many requests", { status: 429 });
  }

  const { data: candidates, error } = await db
    .from("events")
    .select(`
      id, space_id, created_by, title, category, max_people, cost_per_person, recurrence, confirmed_place_id,
      event_slots!event_slots_event_id_fkey(starts_at),
      event_place_options!event_place_options_event_id_fkey(id, places(id))
    `)
    .not("recurrence", "is", null)
    .is("cancelled_at", null)
    .is("repeated_at", null);

  if (error) {
    console.error("auto-repeat: failed to load candidates:", error.message);
    return new Response("error", { status: 500 });
  }

  let created = 0;
  for (const event of (candidates ?? []) as unknown as EventCandidate[]) {
    const slots = event.event_slots ?? [];
    if (slots.length === 0) continue;

    const earliest = slots.map((s) => s.starts_at).sort()[0];
    const eligible = new Date(earliest).getTime() <= Date.now();
    const nextDate = nextOccurrence(earliest, event.recurrence);
    if (debug) {
      debugInfo.push({
        id: event.id,
        title: event.title,
        recurrence: event.recurrence,
        earliestSlot: earliest,
        nextDate: nextDate.toISOString(),
        now: new Date().toISOString(),
        eligible,
      });
    }
    if (!eligible) continue;

    const { data: newEvent, error: insertErr } = await db
      .from("events")
      .insert({
        space_id: event.space_id,
        created_by: event.created_by,
        title: event.title,
        category: event.category,
        max_people: event.max_people,
        cost_per_person: event.cost_per_person,
        recurrence: event.recurrence,
      })
      .select("id")
      .single();
    if (insertErr || !newEvent) {
      console.error(`auto-repeat: failed to create event for ${event.id}:`, insertErr?.message);
      continue;
    }

    const { data: slotRow, error: slotErr } = await db
      .from("event_slots")
      .insert({ event_id: newEvent.id, starts_at: nextDate.toISOString(), added_by: event.created_by })
      .select("id")
      .single();
    if (!slotErr && slotRow) {
      await db.from("slot_votes").insert({ slot_id: slotRow.id, member_id: event.created_by });
    }

    // Carry over only the place that actually won last time, not every
    // candidate that was on the ballot — a repeat should continue what was
    // decided, not restart the vote. If the source event was never confirmed
    // (its date passed before anyone finished voting), fall back to whichever
    // option is currently leading by votes.
    let winningPlaceId: string | null = null;
    const confirmedOption = event.event_place_options.find((o) => o.id === event.confirmed_place_id);
    if (confirmedOption) {
      winningPlaceId = confirmedOption.places?.id ?? null;
    } else if (event.event_place_options.length > 0) {
      const { data: winRow } = await db
        .from("event_winning_places")
        .select("place_id")
        .eq("event_id", event.id)
        .maybeSingle();
      winningPlaceId = (winRow?.place_id as string | undefined) ?? null;
    }

    let newOptionId: string | null = null;
    if (winningPlaceId) {
      const { data: optionRow, error: optionErr } = await db
        .from("event_place_options")
        .insert({ event_id: newEvent.id, place_id: winningPlaceId, added_by: event.created_by })
        .select("id")
        .single();
      if (!optionErr && optionRow) {
        await db.from("place_votes").insert({ option_id: optionRow.id, member_id: event.created_by });
        newOptionId = optionRow.id;
      }
    }

    // With a single date and at most one place, there's nothing left to
    // decide — skip straight to confirmed. Unlike a manual createEvent(),
    // still don't auto-RSVP the creator as "going" — this event was spawned
    // automatically, so whether they're actually attending this particular
    // occurrence is their own call to make.
    if (slotRow) {
      await db
        .from("events")
        .update({ confirmed_at: new Date().toISOString(), confirmed_slot_id: slotRow.id, confirmed_place_id: newOptionId })
        .eq("id", newEvent.id);
    }

    await db.from("events").update({ repeated_at: new Date().toISOString() }).eq("id", event.id);

    // Same two calls a manual createEvent() makes: post/update the shared
    // chat card, then DM anyone who opted into "new event" notifications.
    await fetch(`${supabaseUrl}/functions/v1/notify-event`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${anonKey}`, apikey: anonKey },
      body: JSON.stringify({ event_id: newEvent.id }),
    }).catch((e) => console.error("auto-repeat: notify-event failed:", e));

    fetch(`${supabaseUrl}/functions/v1/notify-new-event`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${anonKey}`, apikey: anonKey },
      body: JSON.stringify({ event_id: newEvent.id }),
    }).catch((e) => console.error("auto-repeat: notify-new-event failed:", e));

    created++;
  }

  return new Response(JSON.stringify({ ok: true, created, ...(debug ? { candidates: debugInfo, totalCandidates: (candidates ?? []).length } : {}) }), {
    headers: { "Content-Type": "application/json" },
  });
});
