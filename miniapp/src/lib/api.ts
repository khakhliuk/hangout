import { getSupabase } from './supabase'
import { parsePlaceInput, resolvePlace, isMapsUrl } from './links'
import type { Category, EventItem, PlaceOption, PlaceSuggestion, Recurrence, ReminderMinutes, Rsvp, Slot, Space, SpaceSettings, UserSettings } from './types'

export type SpacesResult = {
  spaces: Space[]
  memberIds: Record<string, string>
  memberNames: Record<string, string>
  memberAvatars: Record<string, string | null>
}

type ProfileRef = { first_name: string; avatar_url: string | null } | null
type MemberRow = { id: string; tg_user_id: number; profiles: ProfileRef }
type SpaceRow = { id: string; title: string; admin_tg_user_id: number; members: MemberRow[] }

export async function joinSpace(spaceId: string): Promise<void> {
  const { error } = await getSupabase().rpc('join_space', { p_space_id: spaceId })
  if (error) throw new Error(`join_space: ${error.message}`)
}

export async function joinSpaceByEvent(eventId: string): Promise<string | null> {
  const { data, error } = await getSupabase().rpc('join_space_by_event', { p_event_id: eventId })
  if (error) throw new Error(`join_space_by_event: ${error.message}`)
  return (data as string | null) ?? null
}

export async function loadSpaces(myTgId: number): Promise<SpacesResult> {
  const { data, error } = await getSupabase()
    .from('spaces')
    .select('id, title, admin_tg_user_id, members(id, tg_user_id, profiles!tg_user_id(first_name, avatar_url))')
    .order('created_at', { ascending: true })
  if (error) throw error

  const spaces: Space[] = []
  const memberIds: Record<string, string> = {}
  const memberNames: Record<string, string> = {}
  const memberAvatars: Record<string, string | null> = {}
  for (const row of (data ?? []) as unknown as SpaceRow[]) {
    spaces.push({ id: row.id, title: row.title, memberCount: row.members.length, adminTgUserId: row.admin_tg_user_id })
    const me = row.members.find((m) => m.tg_user_id === myTgId)
    if (me) memberIds[row.id] = me.id
    for (const m of row.members) {
      memberNames[m.id] = m.profiles?.first_name ?? '?'
      memberAvatars[m.id] = m.profiles?.avatar_url ?? null
    }
  }
  return { spaces, memberIds, memberNames, memberAvatars }
}

type SlotRow = { id: string; starts_at: string; added_by: string; created_at: string; slot_votes: { member_id: string }[] }
type OptionRow = {
  id: string
  added_by: string
  created_at: string
  places: { name: string; maps_url: string | null } | null
  place_votes: { member_id: string }[]
}
type RsvpRow = { member_id: string | null; guest_name: string | null; invited_by: string | null; status: string }
type EventRow = {
  id: string
  space_id: string
  title: string
  category: string
  created_by: string
  max_people: number | null
  cost_per_person: number | null
  cancelled_at: string | null
  confirmed_at: string | null
  confirmed_slot_id: string | null
  confirmed_place_id: string | null
  recurrence: string | null
  event_slots: SlotRow[]
  event_place_options: OptionRow[]
  rsvps: RsvpRow[]
}

function mapSlot(row: SlotRow): Slot {
  return {
    id: row.id,
    startsAt: row.starts_at,
    addedBy: row.added_by,
    createdAt: row.created_at,
    votes: row.slot_votes.map((v) => v.member_id),
  }
}

function mapOption(row: OptionRow): PlaceOption {
  return {
    id: row.id,
    name: row.places?.name ?? 'Місце',
    mapsUrl: row.places?.maps_url ?? null,
    addedBy: row.added_by,
    createdAt: row.created_at,
    votes: row.place_votes.map((v) => v.member_id),
  }
}

function mapRsvp(row: RsvpRow): Rsvp {
  return {
    memberId: row.member_id,
    guestName: row.guest_name,
    invitedBy: row.invited_by,
    status: row.status as Rsvp['status'],
  }
}

function mapEvent(row: EventRow): EventItem {
  return {
    id: row.id,
    spaceId: row.space_id,
    title: row.title,
    category: row.category as Category,
    createdBy: row.created_by,
    maxPeople: row.max_people,
    costPerPerson: row.cost_per_person,
    cancelledAt: row.cancelled_at,
    confirmedAt: row.confirmed_at,
    confirmedSlotId: row.confirmed_slot_id,
    confirmedPlaceId: row.confirmed_place_id,
    recurrence: row.recurrence as Recurrence | null,
    slots: row.event_slots.map(mapSlot),
    placeOptions: row.event_place_options.map(mapOption),
    rsvps: row.rsvps.map(mapRsvp),
  }
}

const EVENT_SELECT = `
  id, space_id, title, category, created_by, max_people, cost_per_person, cancelled_at, recurrence,
  confirmed_at, confirmed_slot_id, confirmed_place_id,
  event_slots!event_slots_event_id_fkey(id, starts_at, added_by, created_at, slot_votes(member_id)),
  event_place_options!event_place_options_event_id_fkey(id, added_by, created_at, places(name, maps_url), place_votes(member_id)),
  rsvps(member_id, guest_name, invited_by, status)
`

function oneMonthAgoIso(): string {
  const cutoff = new Date()
  cutoff.setMonth(cutoff.getMonth() - 1)
  return cutoff.toISOString()
}

export async function loadEvents(spaceId: string): Promise<EventItem[]> {
  const { data, error } = await getSupabase()
    .from('events')
    .select(EVENT_SELECT)
    .eq('space_id', spaceId)
    .gte('created_at', oneMonthAgoIso())
    .order('created_at', { ascending: false })
  if (error) throw error
  return ((data ?? []) as unknown as EventRow[]).map(mapEvent)
}

// Same projection as loadEvents but for a single row, so watching one open
// event doesn't re-download a month of the whole space every few seconds.
// Returns null when the row is gone or no longer visible under RLS, which the
// caller treats as "nothing to merge" rather than an error.
export async function loadEvent(eventId: string): Promise<EventItem | null> {
  const { data, error } = await getSupabase()
    .from('events')
    .select(EVENT_SELECT)
    .eq('id', eventId)
    .maybeSingle()
  if (error) throw error
  return data ? mapEvent(data as unknown as EventRow) : null
}

type PlaceSuggestionPlace = {
  id: string
  name: string
  maps_url: string | null
  address: string | null
  photo_url: string | null
}
type PlaceSuggestionRow = { places: PlaceSuggestionPlace | PlaceSuggestionPlace[] | null }

export async function loadPlaceSuggestions(memberId: string, category: Category): Promise<PlaceSuggestion[]> {
  const { data, error } = await getSupabase()
    .from('event_place_options')
    .select('created_at, places(id, name, maps_url, address, photo_url), events!event_place_options_event_id_fkey!inner(category)')
    .eq('added_by', memberId)
    .eq('events.category', category)
    .order('created_at', { ascending: false })
    .limit(50)
  if (error) throw error

  const seen = new Set<string>()
  const suggestions: PlaceSuggestion[] = []
  for (const row of (data ?? []) as unknown as PlaceSuggestionRow[]) {
    const place = Array.isArray(row.places) ? row.places[0] : row.places
    if (!place) continue
    const key = place.name.trim().toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    suggestions.push({
      id: place.id,
      name: place.name,
      mapsUrl: place.maps_url,
      address: place.address,
      photoUrl: place.photo_url,
      source: 'own',
    })
    if (suggestions.length >= 8) break
  }
  return suggestions
}

export async function setSlotVote(slotId: string, memberId: string, on: boolean, eventId?: string): Promise<void> {
  const db = getSupabase()
  const { error } = on
    ? await db
        .from('slot_votes')
        .upsert({ slot_id: slotId, member_id: memberId }, { onConflict: 'slot_id,member_id', ignoreDuplicates: true })
    : await db.from('slot_votes').delete().eq('slot_id', slotId).eq('member_id', memberId)
  if (error) throw error
  if (eventId) notifyEvent(eventId)
}

export async function setPlaceVote(optionId: string, memberId: string, on: boolean, eventId?: string): Promise<void> {
  const db = getSupabase()
  const { error } = on
    ? await db
        .from('place_votes')
        .upsert({ option_id: optionId, member_id: memberId }, { onConflict: 'option_id,member_id', ignoreDuplicates: true })
    : await db.from('place_votes').delete().eq('option_id', optionId).eq('member_id', memberId)
  if (error) throw error
  if (eventId) notifyEvent(eventId)
}

async function findOrCreatePlace(value: string): Promise<string> {
  const db = getSupabase()
  const parsed = parsePlaceInput(value)

  if (isMapsUrl(value)) {
    const resolved = await resolvePlace(value)
    if (resolved?.cached && resolved.id) return resolved.id
    if (resolved?.google_place_id) {
      const { data: existing } = await db
        .from('places')
        .select('id')
        .eq('google_place_id', resolved.google_place_id)
        .maybeSingle()
      if (existing) return existing.id
    }
    const row: Record<string, unknown> = {
      name: resolved?.name ?? parsed.name,
      maps_url: resolved?.maps_url ?? parsed.mapsUrl ?? value,
      google_place_id: resolved?.google_place_id ?? null,
      lat: resolved?.lat ?? null,
      lng: resolved?.lng ?? null,
      address: resolved?.address ?? null,
      photo_url: resolved?.photo_url ?? null,
    }
    const { data: place, error } = await db.from('places').insert(row).select('id').single()
    if (error) throw error
    return place.id
  }

  const trimmedName = parsed.name.trim()
  const { data: existing } = await db.from('places').select('id').ilike('name', trimmedName).limit(1).maybeSingle()
  if (existing) return existing.id

  const { data: place, error } = await db
    .from('places')
    .insert({ name: trimmedName, maps_url: null })
    .select('id')
    .single()
  if (error) throw error
  return place.id
}

async function insertPlaceOption(eventId: string, memberId: string, value: string): Promise<void> {
  const db = getSupabase()
  const placeId = await findOrCreatePlace(value)
  const { data: option, error: optionErr } = await db
    .from('event_place_options')
    .insert({ event_id: eventId, place_id: placeId, added_by: memberId })
    .select('id')
    .single()
  if (optionErr) throw optionErr
  const { error: voteErr } = await db.from('place_votes').insert({ option_id: option.id, member_id: memberId })
  if (voteErr) throw voteErr
}

export async function addSlot(eventId: string, memberId: string, startsAt: string): Promise<void> {
  const db = getSupabase()
  const { data: slot, error } = await db
    .from('event_slots')
    .insert({ event_id: eventId, starts_at: startsAt, added_by: memberId })
    .select('id')
    .single()
  if (error) throw error
  const { error: voteErr } = await db.from('slot_votes').insert({ slot_id: slot.id, member_id: memberId })
  if (voteErr) throw voteErr
  notifyEvent(eventId)
}

// Bulk counterpart to addSlot, for createEvent. Inserting the dates one at a
// time chained 2N round trips (each vote waits on its own slot id, each slot
// waits on the previous one) even though the dates are independent of each
// other — this collapses that to two, regardless of how many were picked.
//
// The order PostgREST returns inserted rows in isn't guaranteed, which is fine
// here: every vote belongs to the same member, so only the ids matter and not
// which date each one came from. Pairing them back up would need starts_at in
// the projection and an explicit match.
//
// It also makes the step atomic. The loop could leave the first date committed
// and the event half-built if a later one failed; a single statement either
// writes them all or none.
//
// No notifyEvent here — createEvent fires it once at the end, after finalize.
async function insertSlots(eventId: string, memberId: string, startsAt: string[]): Promise<void> {
  if (startsAt.length === 0) return
  const db = getSupabase()
  const { data: slots, error } = await db
    .from('event_slots')
    .insert(startsAt.map((s) => ({ event_id: eventId, starts_at: s, added_by: memberId })))
    .select('id')
  if (error) throw error
  const { error: voteErr } = await db
    .from('slot_votes')
    .insert((slots ?? []).map((s) => ({ slot_id: s.id, member_id: memberId })))
  if (voteErr) throw voteErr
}

export async function addPlace(eventId: string, memberId: string, value: string): Promise<void> {
  await insertPlaceOption(eventId, memberId, value)
  notifyEvent(eventId)
}

export async function setGoing(event: EventItem, memberId: string, goingCount: number): Promise<void> {
  const db = getSupabase()
  const full = event.maxPeople !== null && goingCount >= event.maxPeople
  const status = full ? 'waitlisted' : 'going'
  const { error } = await db
    .from('rsvps')
    .upsert({ event_id: event.id, member_id: memberId, status }, { onConflict: 'event_id,member_id' })
  if (error) throw error
  notifyEvent(event.id)
}

export async function confirmEvent(eventId: string): Promise<void> {
  const { error } = await getSupabase().rpc('confirm_event', { p_event_id: eventId })
  if (error) throw error
  notifyConfirmed(eventId)
}

export async function setDeclined(eventId: string, memberId: string): Promise<void> {
  const db = getSupabase()
  const { error } = await db.from('rsvps').delete().eq('event_id', eventId).eq('member_id', memberId)
  if (error) throw error
  const { data: slots } = await db.from('event_slots').select('id').eq('event_id', eventId)
  if (slots?.length) {
    await db.from('slot_votes').delete().in('slot_id', slots.map((s) => s.id)).eq('member_id', memberId)
  }
  const { data: options } = await db.from('event_place_options').select('id').eq('event_id', eventId)
  if (options?.length) {
    await db.from('place_votes').delete().in('option_id', options.map((o) => o.id)).eq('member_id', memberId)
  }
  notifyPromotions(eventId)
  notifyEvent(eventId)
}

export async function addGuest(event: EventItem, memberId: string, guestName: string, goingCount: number): Promise<void> {
  const full = event.maxPeople !== null && goingCount >= event.maxPeople
  const { error } = await getSupabase().from('rsvps').insert({
    event_id: event.id,
    member_id: null,
    guest_name: guestName,
    invited_by: memberId,
    status: full ? 'waitlisted' : 'going',
  })
  if (error) throw error
  notifyEvent(event.id)
}

export async function removeGuest(eventId: string, memberId: string, guestName: string): Promise<void> {
  const { error } = await getSupabase()
    .from('rsvps')
    .delete()
    .eq('event_id', eventId)
    .eq('invited_by', memberId)
    .eq('guest_name', guestName)
  if (error) throw error
  notifyPromotions(eventId)
  notifyEvent(eventId)
}

export async function cancelEvent(eventId: string): Promise<void> {
  const { error } = await getSupabase()
    .from('events')
    .update({ cancelled_at: new Date().toISOString() })
    .eq('id', eventId)
  if (error) throw error
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY
  fetch(`${supabaseUrl}/functions/v1/notify-event`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${anonKey}`, apikey: anonKey },
    body: JSON.stringify({ event_id: eventId, action: 'delete' }),
  }).catch(() => {})
}

export type NewEvent = {
  title: string
  category: Category
  maxPeople: number | null
  costPerPerson: number | null
  recurrence: Recurrence | null
  slots: string[]
  places: { name: string; mapsUrl: string | null }[]
}

export async function createEvent(spaceId: string, memberId: string, draft: NewEvent): Promise<string> {
  const db = getSupabase()
  const { data: event, error } = await db
    .from('events')
    .insert({
      space_id: spaceId,
      created_by: memberId,
      title: draft.title,
      category: draft.category,
      max_people: draft.maxPeople,
      cost_per_person: draft.costPerPerson,
      recurrence: draft.recurrence,
    })
    .select('id')
    .single()
  if (error) throw error

  await insertSlots(event.id, memberId, draft.slots)
  for (const place of draft.places) {
    await insertPlaceOption(event.id, memberId, place.mapsUrl ?? place.name)
  }
  const { error: finalizeErr } = await db.rpc('finalize_event_creation', { p_event_id: event.id })
  if (finalizeErr) throw finalizeErr
  notifyEvent(event.id, true)
  notifyNewEvent(event.id)
  return event.id
}

export function notifyNewEvent(eventId: string): void {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY
  fetch(`${supabaseUrl}/functions/v1/notify-new-event`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${anonKey}`,
      apikey: anonKey,
    },
    body: JSON.stringify({ event_id: eventId }),
  }).catch(() => {})
}

export function notifyPromotions(eventId: string): void {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY
  fetch(`${supabaseUrl}/functions/v1/notify-promotions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${anonKey}`,
      apikey: anonKey,
    },
    body: JSON.stringify({ event_id: eventId }),
  }).catch(() => {})
}

const notifyTimers = new Map<string, ReturnType<typeof setTimeout>>()

// Posts a fresh chat message instead of editing the "🗳 Пропозиція" one in
// place — an edit doesn't bump the message or notify anyone, so the decision
// would go unnoticed. Cancels any pending debounced edit for this event first
// so a stale vote-triggered edit can't fire afterwards and fight over the
// (now replaced) bot_message_id.
export function notifyConfirmed(eventId: string): void {
  const existing = notifyTimers.get(eventId)
  if (existing) {
    clearTimeout(existing)
    notifyTimers.delete(eventId)
  }
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY
  fetch(`${supabaseUrl}/functions/v1/notify-event`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${anonKey}`, apikey: anonKey },
    body: JSON.stringify({ event_id: eventId, action: 'confirmed' }),
  }).catch(() => {})
}

export function notifyEvent(eventId: string, immediate = false): void {
  const delay = immediate ? 0 : 2000
  const existing = notifyTimers.get(eventId)
  if (existing) clearTimeout(existing)
  notifyTimers.set(
    eventId,
    setTimeout(() => {
      notifyTimers.delete(eventId)
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
      const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY
      fetch(`${supabaseUrl}/functions/v1/notify-event`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${anonKey}`,
          apikey: anonKey,
        },
        body: JSON.stringify({ event_id: eventId }),
      }).catch(() => {})
    }, delay),
  )
}

export type SpaceMember = { id: string; firstName: string; tgUserId: number; avatarUrl: string | null }

export async function loadMembers(spaceId: string): Promise<SpaceMember[]> {
  const { data, error } = await getSupabase()
    .from('members')
    .select('id, tg_user_id, profiles!tg_user_id(first_name, avatar_url)')
    .eq('space_id', spaceId)
    .order('joined_at', { ascending: true })
  if (error) throw error
  return ((data ?? []) as unknown as MemberRow[]).map((m) => ({
    id: m.id,
    firstName: m.profiles?.first_name ?? '?',
    tgUserId: m.tg_user_id,
    avatarUrl: m.profiles?.avatar_url ?? null,
  }))
}

export async function removeMember(memberId: string, spaceId: string): Promise<void> {
  const db = getSupabase()
  const { data: events } = await db
    .from('events')
    .select('id')
    .eq('space_id', spaceId)
    .is('cancelled_at', null)
  const { error } = await db.from('members').delete().eq('id', memberId)
  if (error) throw error
  for (const e of events ?? []) {
    notifyPromotions(e.id)
    notifyEvent(e.id)
  }
}

export async function leaveSpace(memberId: string, spaceId: string): Promise<void> {
  const db = getSupabase()
  const { data: events } = await db
    .from('events')
    .select('id')
    .eq('space_id', spaceId)
    .is('cancelled_at', null)
  const { error } = await db.from('members').delete().eq('id', memberId)
  if (error) throw error
  for (const e of events ?? []) {
    notifyPromotions(e.id)
    notifyEvent(e.id)
  }
}

export async function loadSettings(): Promise<UserSettings> {
  const { data, error } = await getSupabase().rpc('get_user_settings')
  if (error) throw error
  const row = (Array.isArray(data) ? data[0] : data) as
    | { notify_new_events: boolean; notify_promotions: boolean; reminder_minutes: number | null }
    | undefined
  return {
    notifyNewEvents: row?.notify_new_events ?? false,
    notifyPromotions: row?.notify_promotions ?? true,
    reminderMinutes: (row?.reminder_minutes as ReminderMinutes | null) ?? null,
  }
}

export async function saveSettings(settings: UserSettings): Promise<void> {
  const { error } = await getSupabase().rpc('save_user_settings', {
    p_notify_new_events: settings.notifyNewEvents,
    p_notify_promotions: settings.notifyPromotions,
    p_reminder_minutes: settings.reminderMinutes,
  })
  if (error) throw error
}

export async function sendFeedback(text: string): Promise<void> {
  const { error } = await getSupabase().functions.invoke('feedback', { body: { text } })
  if (error) {
    const status = (error as { context?: { status?: number } }).context?.status
    if (status === 429) throw new Error('rate_limited')
    throw error
  }
}

export async function loadSpaceSettings(spaceId: string): Promise<SpaceSettings> {
  const { data, error } = await getSupabase()
    .from('space_settings')
    .select('allow_new_members')
    .eq('space_id', spaceId)
    .maybeSingle()
  if (error) throw error
  return { allowNewMembers: data?.allow_new_members ?? true }
}

export async function saveSpaceSettings(spaceId: string, settings: SpaceSettings): Promise<void> {
  const { error } = await getSupabase()
    .from('space_settings')
    .update({ allow_new_members: settings.allowNewMembers })
    .eq('space_id', spaceId)
  if (error) throw error
}
