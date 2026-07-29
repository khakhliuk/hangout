import { goingRsvps } from './event'
import type { EventItem } from './types'

const toggle = (votes: string[], meId: string) =>
  votes.includes(meId) ? votes.filter((v) => v !== meId) : [...votes, meId]

export function toggleSlotVote(e: EventItem, slotId: string, meId: string): EventItem {
  return { ...e, slots: e.slots.map((s) => (s.id === slotId ? { ...s, votes: toggle(s.votes, meId) } : s)) }
}

export function togglePlaceVote(e: EventItem, optionId: string, meId: string): EventItem {
  return {
    ...e,
    placeOptions: e.placeOptions.map((o) => (o.id === optionId ? { ...o, votes: toggle(o.votes, meId) } : o)),
  }
}

export function promoteWaitlist(e: EventItem): EventItem {
  let free = e.maxPeople === null ? Infinity : e.maxPeople - goingRsvps(e).length
  if (free <= 0) return e
  return {
    ...e,
    rsvps: e.rsvps.map((r) => {
      if (r.status !== 'waitlisted' || free <= 0) return r
      free -= 1
      return { ...r, status: 'going' as const }
    }),
  }
}

export function applyRsvp(e: EventItem, meId: string, status: 'going' | 'declined'): EventItem {
  if (status === 'declined') {
    return promoteWaitlist({ ...e, rsvps: e.rsvps.filter((r) => r.memberId !== meId) })
  }
  const full = e.maxPeople !== null && goingRsvps(e).length >= e.maxPeople
  const next = full ? ('waitlisted' as const) : ('going' as const)
  const rest = e.rsvps.filter((r) => r.memberId !== meId)
  return { ...e, rsvps: [...rest, { memberId: meId, guestName: null, invitedBy: null, status: next }] }
}

export function applyAddGuest(e: EventItem, meId: string, guestName: string): EventItem {
  const full = e.maxPeople !== null && goingRsvps(e).length >= e.maxPeople
  return {
    ...e,
    rsvps: [
      ...e.rsvps,
      { memberId: null, guestName, invitedBy: meId, status: full ? 'waitlisted' : 'going' },
    ],
  }
}

export function applyRemoveGuest(e: EventItem, meId: string, guestName: string): EventItem {
  return promoteWaitlist({
    ...e,
    rsvps: e.rsvps.filter((r) => !(r.guestName === guestName && r.invitedBy === meId)),
  })
}

export function guestName(e: EventItem): string {
  return `Гість ${e.rsvps.filter((r) => r.guestName).length + 1}`
}

export function applyAddSlot(e: EventItem, meId: string, startsAt: string): EventItem {
  if (e.slots.some((s) => s.startsAt === startsAt)) return e
  return {
    ...e,
    slots: [
      ...e.slots,
      { id: `s${Date.now()}`, startsAt, addedBy: meId, createdAt: new Date().toISOString(), votes: [meId] },
    ],
  }
}

export function applyAddPlace(e: EventItem, meId: string, place: { name: string; mapsUrl: string | null }): EventItem {
  const exists = e.placeOptions.some((o) => (place.mapsUrl ? o.mapsUrl === place.mapsUrl : o.name === place.name))
  if (exists) return e
  return {
    ...e,
    placeOptions: [
      ...e.placeOptions,
      {
        id: `p${Date.now()}`,
        name: place.name,
        mapsUrl: place.mapsUrl,
        addedBy: meId,
        createdAt: new Date().toISOString(),
        votes: [meId],
      },
    ],
  }
}
