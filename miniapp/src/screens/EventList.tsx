import { useState } from 'react'
import { Badge, Button, Cell, FixedLayout, List, Placeholder, Section } from '@telegram-apps/telegram-ui'
import PersonIcon from '../components/PersonIcon'
import VoteIcon from '../components/VoteIcon'
import { eventStatus, formatSlot, goingRsvps, winningPlace, winningSlot, type EventStatus } from '../lib/event'
import { CATEGORIES, type EventItem } from '../lib/types'

type Props = {
  events: EventItem[]
  onOpen: (id: string) => void
  onCreate: () => void
  onHowItWorks: () => void
}

function description(event: EventItem, status: EventStatus) {
  if (status === 'cancelled') return 'Скасовано'
  const slot = winningSlot(event)
  const place = winningPlace(event)
  const parts: string[] = []
  if (slot && status !== 'proposed') {
    parts.push(formatSlot(slot.startsAt))
  }
  if (place) {
    parts.push(place.name + (event.placeOptions.length > 1 && status === 'proposed' ? ` +${event.placeOptions.length - 1}` : ''))
  }
  return parts.join(' · ')
}

function EventCell({ event, onOpen }: { event: EventItem; onOpen: (id: string) => void }) {
  const status = eventStatus(event)
  const going = goingRsvps(event).length
  const full = event.maxPeople !== null && going >= event.maxPeople
  const showGoingBadge = status === 'confirmed' || status === 'ongoing'
  const dim = status === 'happened' || status === 'cancelled'
  return (
    <Cell
      before={<span style={{ fontSize: 28, lineHeight: 1 }}>{CATEGORIES[event.category].emoji}</span>}
      subtitle={description(event, status)}
      after={
        showGoingBadge ? (
          <Badge
            type="number"
            style={full ? { background: 'var(--tgui--secondary_fill)', color: 'var(--tgui--hint_color)' } : undefined}
          >
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, lineHeight: 1 }}>
              <span style={{ lineHeight: 1 }}>{event.maxPeople ? `${going}/${event.maxPeople}` : `${going}`}</span>
              <PersonIcon size={15} />
            </span>
          </Badge>
        ) : status === 'proposed' ? (
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              fontSize: 13,
              fontWeight: 600,
              padding: '5px 10px',
              borderRadius: 999,
              background: 'rgba(255, 193, 7, 0.16)',
              color: '#b8860b',
              whiteSpace: 'nowrap',
            }}
          >
            <VoteIcon size={12} /> Голосуємо
          </span>
        ) : undefined
      }
      style={dim ? { opacity: 0.55 } : undefined}
      onClick={() => onOpen(event.id)}
    >
      {event.title}
    </Cell>
  )
}

function earliestSlotMs(event: EventItem): number {
  const times = event.slots.map((s) => new Date(s.startsAt).getTime())
  return times.length ? Math.min(...times) : Infinity
}

function bySlotTime(a: EventItem, b: EventItem) {
  return earliestSlotMs(a) - earliestSlotMs(b)
}

export default function EventList({ events, onOpen, onCreate, onHowItWorks }: Props) {
  const [showPast, setShowPast] = useState(false)

  const withStatus = events.map((e) => ({ event: e, status: eventStatus(e) }))
  const ongoing = withStatus.filter((x) => x.status === 'ongoing').map((x) => x.event).sort(bySlotTime)
  const upcoming = withStatus
    .filter((x) => x.status === 'proposed' || x.status === 'confirmed')
    .map((x) => x.event)
    .sort(bySlotTime)
  const past = withStatus.filter((x) => x.status === 'happened' || x.status === 'cancelled').map((x) => x.event)

  const nothingActive = ongoing.length === 0 && upcoming.length === 0

  return (
    <>
      {nothingActive && (
        <Placeholder
          header="Поки жодного запланованого"
          description="Тапни «Новий івент» унизу — запропонуй дату, місце і збери своїх"
        >
          <span style={{ fontSize: 56 }}>🗓️</span>
        </Placeholder>
      )}
      <List style={{ paddingBottom: 128 }}>
          {ongoing.length > 0 && (
            <Section header="Зараз">
              {ongoing.map((event) => (
                <EventCell key={event.id} event={event} onOpen={onOpen} />
              ))}
            </Section>
          )}
          {upcoming.length > 0 && (
            <Section header="Наступні">
              {upcoming.map((event) => (
                <EventCell key={event.id} event={event} onOpen={onOpen} />
              ))}
            </Section>
          )}
          {past.length > 0 && (
            <Section>
              <Cell
                style={{ color: 'var(--tgui--hint_color)' }}
                after={
                  <span
                    style={{
                      color: 'var(--tgui--hint_color)',
                      display: 'inline-block',
                      transition: 'transform 0.2s',
                      transform: showPast ? 'rotate(90deg)' : undefined,
                    }}
                  >
                    ›
                  </span>
                }
                onClick={() => setShowPast((v) => !v)}
              >
                Попередні івенти · {past.length}
              </Cell>
              {showPast && past.map((event) => <EventCell key={event.id} event={event} onOpen={onOpen} />)}
            </Section>
          )}
        </List>
      <FixedLayout
        vertical="bottom"
        style={{
          padding: '12px 16px calc(12px + var(--tg-viewport-safe-area-inset-bottom, 0px))',
          background: 'var(--tgui--secondary_bg_color)',
        }}
      >
        <div style={{ textAlign: 'center', marginBottom: 14 }}>
          <span
            role="button"
            onClick={onHowItWorks}
            style={{ color: 'var(--tgui--link_color)', fontSize: 16, fontWeight: 500, cursor: 'pointer' }}
          >
            Як це працює?
          </span>
        </div>
        <Button size="l" stretched onClick={onCreate}>
          Новий івент
        </Button>
      </FixedLayout>
    </>
  )
}
