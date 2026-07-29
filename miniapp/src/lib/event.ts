import type { EventItem, PlaceOption, Rsvp, Slot } from './types'

export type EventStatus = 'proposed' | 'confirmed' | 'ongoing' | 'happened' | 'cancelled'

const ONGOING_GRACE_MS = 60 * 60 * 1000

function rank(createdBy: string) {
  return (a: Slot | PlaceOption, b: Slot | PlaceOption) => {
    return b.votes.length - a.votes.length ||
      Number(b.addedBy === createdBy) - Number(a.addedBy === createdBy) ||
      a.createdAt.localeCompare(b.createdAt)
  }
}

export function winningSlot(event: EventItem): Slot | null {
  if (event.confirmedAt) return event.slots.find((s) => s.id === event.confirmedSlotId) ?? null
  if (!event.slots.length) return null
  return [...event.slots].sort(rank(event.createdBy))[0]
}

export function winningPlace(event: EventItem): PlaceOption | null {
  if (event.confirmedAt) return event.placeOptions.find((o) => o.id === event.confirmedPlaceId) ?? null
  if (!event.placeOptions.length) return null
  return [...event.placeOptions].sort(rank(event.createdBy))[0]
}

export function eventStatus(event: EventItem): EventStatus {
  if (event.cancelledAt) return 'cancelled'
  if (!event.confirmedAt) return 'proposed'
  const winner = winningSlot(event)
  if (!winner) return 'confirmed'
  const startMs = new Date(winner.startsAt).getTime()
  const now = Date.now()
  if (now < startMs) return 'confirmed'
  if (now < startMs + ONGOING_GRACE_MS) return 'ongoing'
  return 'happened'
}

export function goingRsvps(event: EventItem): Rsvp[] {
  return event.rsvps.filter((r) => r.status === 'going')
}

export function waitlistedRsvps(event: EventItem): Rsvp[] {
  return event.rsvps.filter((r) => r.status === 'waitlisted')
}

export function myRsvp(event: EventItem, meId: string): Rsvp | null {
  return event.rsvps.find((r) => r.memberId === meId) ?? null
}

const dateFmt = new Intl.DateTimeFormat('uk-UA', { weekday: 'short', day: 'numeric', month: 'short' })
const timeFmt = new Intl.DateTimeFormat('uk-UA', { hour: '2-digit', minute: '2-digit' })

export function formatSlot(iso: string) {
  const date = new Date(iso)
  return `${dateFmt.format(date)}, ${timeFmt.format(date)}`
}
