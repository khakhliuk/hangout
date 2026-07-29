import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as api from './api'
import * as ops from './eventOps'
import { eventStatus, goingRsvps } from './event'
import { parsePlaceInput } from './links'
import type { EventItem, Space, SpaceSettings, UserSettings } from './types'
import type { TgUser } from './auth'

export type NewEventDraft = api.NewEvent

type StartTarget = { kind: 's' | 'e'; id: string } | null

function parseStart(param: string | null): StartTarget {
  if (!param) return null
  const sep = param.indexOf('_')
  if (sep === -1) return { kind: 's', id: param }
  const kind = param.slice(0, sep)
  const id = param.slice(sep + 1)
  return kind === 'e' ? { kind: 'e', id } : { kind: 's', id }
}

export function useHangoutData(user: TgUser, startParam: string | null, openEventId?: string | null) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [spaces, setSpaces] = useState<Space[]>([])
  const [memberIds, setMemberIds] = useState<Record<string, string>>({})
  const [memberNames, setMemberNames] = useState<Record<string, string>>({})
  const [memberAvatars, setMemberAvatars] = useState<Record<string, string | null>>({})
  const [activeSpaceId, setActiveSpaceId] = useState<string | null>(null)
  const [events, setEvents] = useState<EventItem[]>([])
  const [eventsLoading, setEventsLoading] = useState(true)
  const [settings, setSettings] = useState<UserSettings>({ notifyNewEvents: false, notifyPromotions: true, reminderMinutes: null })
  const [spaceSettings, setSpaceSettings] = useState<SpaceSettings>({ allowNewMembers: true })
  const [initialEventId, setInitialEventId] = useState<string | null>(null)

  const meId = activeSpaceId ? memberIds[activeSpaceId] : undefined
  const eventsRef = useRef(events)
  eventsRef.current = events

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const target = parseStart(startParam)
        let result = await api.loadSpaces(user.id)
        let active: string | null = null

        if (target?.kind === 'e') {
          const spaceId = await api.joinSpaceByEvent(target.id)
          if (spaceId && !result.spaces.some((s) => s.id === spaceId)) {
            result = await api.loadSpaces(user.id)
          }
          active = spaceId ?? result.spaces[0]?.id ?? null
          if (spaceId) setInitialEventId(target.id)
        } else if (target?.kind === 's') {
          if (!result.spaces.some((s) => s.id === target.id)) {
            await api.joinSpace(target.id)
            result = await api.loadSpaces(user.id)
          }
          active = result.spaces.some((s) => s.id === target.id) ? target.id : (result.spaces[0]?.id ?? null)
        } else {
          active = result.spaces[0]?.id ?? null
        }

        if (cancelled) return
        setSpaces(result.spaces)
        setMemberIds(result.memberIds)
        setMemberNames(result.memberNames)
        setMemberAvatars(result.memberAvatars)
        setActiveSpaceId(active)
        setSettings(await api.loadSettings())
      } catch (e) {
        if (!cancelled) {
          const message = e instanceof Error ? e.message : ''
          if (message.includes('space_closed')) {
            setError('Цей простір зараз закритий для нових учасників')
          } else {
            console.error('initial load failed:', e)
            setError('Не вдалося завантажити дані. Спробуй перезапустити застосунок')
          }
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [user, startParam])

  useEffect(() => {
    if (activeSpaceId === null) {
      setEventsLoading(false)
      return
    }
    let cancelled = false
    setEventsLoading(true)
    api
      .loadEvents(activeSpaceId)
      .then((rows) => {
        if (!cancelled) setEvents(rows)
      })
      .catch(() => {
        if (!cancelled) setNotice('Не вдалося оновити івенти')
      })
      .finally(() => {
        if (!cancelled) setEventsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [activeSpaceId])

  useEffect(() => {
    if (activeSpaceId === null) return
    let cancelled = false
    api
      .loadSpaceSettings(activeSpaceId)
      .then((s) => {
        if (!cancelled) setSpaceSettings(s)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [activeSpaceId])

  const reload = useCallback(async () => {
    if (activeSpaceId === null) return
    try {
      setEvents(await api.loadEvents(activeSpaceId))
    } catch {
      setNotice('Не вдалося оновити івенти')
    }
  }, [activeSpaceId])

  const reloadAll = useCallback(async () => {
    try {
      const result = await api.loadSpaces(user.id)
      setSpaces(result.spaces)
      setMemberIds(result.memberIds)
      setMemberNames(result.memberNames)
      setMemberAvatars(result.memberAvatars)
      if (activeSpaceId) setEvents(await api.loadEvents(activeSpaceId))
    } catch {
      setNotice('Не вдалося оновити дані')
    }
  }, [user, activeSpaceId])

  const leaveSpace = useCallback(
    async (spaceId: string): Promise<boolean> => {
      const memberId = memberIds[spaceId]
      if (!memberId) return false
      try {
        await api.leaveSpace(memberId, spaceId)
        const result = await api.loadSpaces(user.id)
        setSpaces(result.spaces)
        setMemberIds(result.memberIds)
        setMemberNames(result.memberNames)
        setMemberAvatars(result.memberAvatars)
        setActiveSpaceId((prev) => (prev === spaceId ? (result.spaces[0]?.id ?? null) : prev))
        return true
      } catch {
        setNotice('Не вдалося вийти зі спейсу')
        return false
      }
    },
    [user, memberIds],
  )

  const patch = useCallback((eventId: string, fn: (e: EventItem) => EventItem) => {
    setEvents((prev) => prev.map((e) => (e.id === eventId ? fn(e) : e)))
  }, [])

  const pendingRef = useRef(new Set<string>())

  const run = useCallback(
    async (eventId: string, optimistic: (e: EventItem) => EventItem, remote: () => Promise<void>, sync = false, key?: string) => {
      const lockKey = key ?? eventId
      if (pendingRef.current.has(lockKey)) return
      pendingRef.current.add(lockKey)
      const before = eventsRef.current.find((e) => e.id === eventId)
      patch(eventId, optimistic)
      try {
        await remote()
        if (sync) await reload()
      } catch {
        if (before) patch(eventId, () => before)
        setNotice('Не вдалося зберегти, спробуй ще')
      } finally {
        pendingRef.current.delete(lockKey)
      }
    },
    [patch, reload],
  )

  const toggleSlot = useCallback(
    (eventId: string, slotId: string) => {
      if (!meId) return
      const e = eventsRef.current.find((x) => x.id === eventId)
      const on = !e?.slots.find((s) => s.id === slotId)?.votes.includes(meId)
      run(eventId, (ev) => ops.toggleSlotVote(ev, slotId, meId), () => api.setSlotVote(slotId, meId, on, eventId), false, `slot:${slotId}`)
    },
    [meId, run],
  )

  const togglePlace = useCallback(
    (eventId: string, optionId: string) => {
      if (!meId) return
      const e = eventsRef.current.find((x) => x.id === eventId)
      const on = !e?.placeOptions.find((o) => o.id === optionId)?.votes.includes(meId)
      run(eventId, (ev) => ops.togglePlaceVote(ev, optionId, meId), () => api.setPlaceVote(optionId, meId, on, eventId), false, `place:${optionId}`)
    },
    [meId, run],
  )

  const rsvp = useCallback(
    (eventId: string, status: 'going' | 'declined') => {
      if (!meId) return
      const e = eventsRef.current.find((x) => x.id === eventId)
      if (!e) return
      const going = goingRsvps(e).length
      run(
        eventId,
        (ev) => ops.applyRsvp(ev, meId, status),
        () => (status === 'going' ? api.setGoing(e, meId, going) : api.setDeclined(eventId, meId)),
        true,
        `rsvp:${eventId}`,
      )
    },
    [meId, run],
  )

  const addGuest = useCallback(
    (eventId: string) => {
      if (!meId) return
      const e = eventsRef.current.find((x) => x.id === eventId)
      if (!e) return
      const name = ops.guestName(e)
      const going = goingRsvps(e).length
      run(eventId, (ev) => ops.applyAddGuest(ev, meId, name), () => api.addGuest(e, meId, name, going), true)
    },
    [meId, run],
  )

  const removeGuest = useCallback(
    (eventId: string, name: string) => {
      if (!meId) return
      run(eventId, (ev) => ops.applyRemoveGuest(ev, meId, name), () => api.removeGuest(eventId, meId, name), true)
    },
    [meId, run],
  )

  const addSlot = useCallback(
    (eventId: string, startsAt: string) => {
      if (!meId) return
      run(eventId, (ev) => ops.applyAddSlot(ev, meId, startsAt), () => api.addSlot(eventId, meId, startsAt), true)
    },
    [meId, run],
  )

  const addPlace = useCallback(
    (eventId: string, value: string) => {
      if (!meId) return
      const place = parsePlaceInput(value)
      run(eventId, (ev) => ops.applyAddPlace(ev, meId, place), () => api.addPlace(eventId, meId, value), true)
    },
    [meId, run],
  )

  const cancel = useCallback(
    (eventId: string) => {
      run(eventId, (ev) => ({ ...ev, cancelledAt: new Date().toISOString() }), () => api.cancelEvent(eventId))
    },
    [run],
  )

  const confirmingRef = useRef(new Set<string>())
  const confirm = useCallback(
    async (eventId: string) => {
      if (confirmingRef.current.has(eventId)) return
      confirmingRef.current.add(eventId)
      try {
        await api.confirmEvent(eventId)
        await reload()
      } catch {
        setNotice('Не вдалося завершити голосування, спробуй ще')
      } finally {
        confirmingRef.current.delete(eventId)
      }
    },
    [reload],
  )

  const createEvent = useCallback(
    async (draft: NewEventDraft): Promise<string | null> => {
      if (!activeSpaceId || !meId) return null
      try {
        const id = await api.createEvent(activeSpaceId, meId, draft)
        await reload()
        return id
      } catch {
        setNotice('Не вдалося створити івент')
        return null
      }
    },
    [activeSpaceId, meId, reload],
  )

  const updateSettings = useCallback(
    (partial: Partial<UserSettings>) => {
      const next = { ...settings, ...partial }
      setSettings(next)
      api.saveSettings(next).catch(() => setNotice('Не вдалося зберегти налаштування'))
    },
    [settings],
  )

  const sendFeedback = useCallback(async (text: string): Promise<boolean> => {
    try {
      await api.sendFeedback(text)
      setNotice('Дякуємо за фідбек!')
      return true
    } catch (e) {
      setNotice(
        e instanceof Error && e.message === 'rate_limited'
          ? 'Забагато повідомлень, спробуй трохи пізніше'
          : 'Не вдалося надіслати, спробуй пізніше',
      )
      return false
    }
  }, [])

  const updateSpaceSettings = useCallback(
    (partial: Partial<SpaceSettings>) => {
      if (!activeSpaceId) return
      const next = { ...spaceSettings, ...partial }
      setSpaceSettings(next)
      api.saveSpaceSettings(activeSpaceId, next).catch(() => {
        setSpaceSettings(spaceSettings)
        setNotice('Не вдалося зберегти налаштування спейсу')
      })
    },
    [activeSpaceId, spaceSettings],
  )

  useEffect(() => {
    if (!openEventId || !activeSpaceId) return
    const event = eventsRef.current.find((e) => e.id === openEventId)
    const status = event ? eventStatus(event) : null
    if (!event || (status !== 'proposed' && status !== 'confirmed')) return

    let cancelled = false
    const poll = () => {
      api.loadEvents(activeSpaceId).then((rows) => {
        if (!cancelled) setEvents(rows)
      }).catch(() => {})
    }
    const id = setInterval(poll, 3000)

    // Desktop browsers (and embedded webviews) throttle setInterval hard while
    // the tab/window is backgrounded, so relying on the timer alone leaves the
    // screen stale for minutes. Force a refetch the moment it's foregrounded.
    const onVisible = () => {
      if (document.visibilityState === 'visible') poll()
    }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', poll)

    return () => {
      cancelled = true
      clearInterval(id)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', poll)
    }
  }, [openEventId, activeSpaceId])

  const spaceEvents = useMemo(
    () => (activeSpaceId ? events.filter((e) => e.spaceId === activeSpaceId) : []),
    [events, activeSpaceId],
  )

  return {
    loading,
    eventsLoading,
    error,
    notice,
    clearNotice: useCallback(() => setNotice(null), []),
    spaces,
    activeSpaceId,
    setActiveSpaceId,
    events: spaceEvents,
    meId: meId ?? '',
    nameOf: useCallback((id: string | null) => (id ? memberNames[id] ?? '?' : '?'), [memberNames]),
    avatarOf: useCallback((id: string | null) => (id ? memberAvatars[id] ?? null : null), [memberAvatars]),
    settings,
    updateSettings,
    sendFeedback,
    spaceSettings,
    updateSpaceSettings,
    leaveSpace,
    toggleSlot,
    togglePlace,
    rsvp,
    addGuest,
    removeGuest,
    addSlot,
    addPlace,
    cancel,
    confirm,
    createEvent,
    reloadAll,
    initialEventId,
  }
}
