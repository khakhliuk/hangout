import { useState } from 'react'
import {
  Badge,
  Button,
  Caption,
  Cell,
  Checkbox,
  FixedLayout,
  List,
  Section,
  Title,
} from '@telegram-apps/telegram-ui'
import Avatar from '../components/Avatar'
import DateTimeField from '../components/DateTimeField'
import MapPinIcon from '../components/MapPinIcon'
import OptionInput from '../components/OptionInput'
import RepeatIcon from '../components/RepeatIcon'
import {
  eventStatus,
  formatSlot,
  goingRsvps,
  myRsvp,
  waitlistedRsvps,
  winningPlace,
  winningSlot,
} from '../lib/event'
import { openIcsLink } from '../lib/calendar'
import { mapsLinkVisible, openExternal } from '../lib/links'
import { useBackButton } from '../lib/useBackButton'
import { isInTelegram } from '../telegram'
import { CATEGORIES, type EventItem, type PlaceOption, type PlaceSuggestion, type Rsvp } from '../lib/types'
import * as api from '../lib/api'

type Props = {
  event: EventItem
  meId: string
  nameOf: (id: string | null) => string
  avatarOf: (id: string | null) => string | null
  onBack: () => void
  onToggleSlot: (slotId: string) => void
  onTogglePlace: (optionId: string) => void
  onRsvp: (status: 'going' | 'declined') => void
  onAddGuest: () => void
  onRemoveGuest: (guestName: string) => void
  onAddSlot: (startsAt: string) => void
  onAddPlace: (name: string) => void
  onCancel: () => void
  onConfirm: () => void
  onRepeat?: () => void
}

const MAX_SLOTS = 3
const MAX_GUESTS_PER_MEMBER = 5

function VoteCount({ n, winner }: { n: number; winner?: boolean }) {
  const style =
    winner && n > 0
      ? { background: '#FFC107', color: '#1a1a1a' }
      : n === 0
        ? { background: 'var(--tgui--secondary_fill)', color: 'var(--tgui--hint_color)' }
        : undefined
  return (
    <Badge type="number" style={style}>
      {n}
    </Badge>
  )
}

function rsvpName(rsvp: Rsvp, nameOf: (id: string | null) => string) {
  return rsvp.guestName ?? nameOf(rsvp.memberId)
}

function voterSubtitle(votes: string[], addedBy: string, nameOf: (id: string | null) => string) {
  if (votes.length === 0) return `запропонував(-ла) ${nameOf(addedBy)}`
  return votes.map((id) => nameOf(id)).join(', ')
}

function RsvpRow({ name, avatarUrl, subtitle, onRemove, dim, highlight }: { name: string; avatarUrl?: string | null; subtitle?: string; onRemove?: () => void; dim?: boolean; highlight?: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px', opacity: dim ? 0.55 : 1 }}>
      <Avatar name={name} url={avatarUrl} highlight={highlight} />
      <div style={{ flex: 1 }}>
        <div>{name}</div>
        {subtitle && <div style={{ fontSize: 13, color: 'var(--tgui--hint_color)' }}>{subtitle}</div>}
      </div>
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          style={{ color: 'var(--tgui--destructive_text_color)', cursor: 'pointer', background: 'none', border: 'none', padding: '8px 12px', fontSize: 16, lineHeight: 1 }}
        >
          ✕
        </button>
      )}
    </div>
  )
}

function MapsLink({ option }: { option: PlaceOption }) {
  if (!option.mapsUrl || !mapsLinkVisible()) return null
  return (
    <span
      style={{ cursor: 'pointer', color: 'var(--tgui--link_color)', display: 'inline-flex' }}
      onClick={(e) => {
        e.preventDefault()
        e.stopPropagation()
        openExternal(option.mapsUrl!)
      }}
    >
      <MapPinIcon />
    </span>
  )
}

export default function EventScreen({
  event,
  meId,
  nameOf,
  avatarOf,
  onBack,
  onToggleSlot,
  onTogglePlace,
  onRsvp,
  onAddGuest,
  onRemoveGuest,
  onAddSlot,
  onAddPlace,
  onCancel,
  onConfirm,
  onRepeat,
}: Props) {
  useBackButton(onBack)

  const [addingDate, setAddingDate] = useState(false)
  const [addingPlace, setAddingPlace] = useState(false)
  const [placeSuggestions, setPlaceSuggestions] = useState<PlaceSuggestion[] | null>(null)
  const [typing, setTyping] = useState(false)
  const [confirming, setConfirming] = useState(false)

  const isTextField = (el: EventTarget | null) =>
    el instanceof HTMLElement && el.matches('input:not([type=checkbox]):not([type=radio]), textarea')

  const status = eventStatus(event)
  const isProposed = status === 'proposed'
  const isCancelled = status === 'cancelled'
  const isHappened = status === 'happened'
  const canRsvp = status === 'confirmed' || status === 'ongoing'
  const canManage = !isCancelled && !isHappened
  const slotWinner = winningSlot(event)
  const placeWinner = winningPlace(event)
  const myGuestCount = event.rsvps.filter((r) => r.guestName && r.invitedBy === meId).length
  const going = goingRsvps(event)
  const waitlisted = waitlistedRsvps(event)
  const mine = myRsvp(event, meId)
  const dateVoting = isProposed && event.slots.length > 1
  const placeVoting = isProposed && event.placeOptions.length > 1
  const category = CATEGORIES[event.category]

  const meta = [category.label]
  if (event.costPerPerson) meta.push(`${event.costPerPerson}₴/особу`)
  if (isCancelled) meta.push('скасовано')
  if (isHappened) meta.push('відбувся')
  if (status === 'ongoing') meta.push('🟢 зараз')
  if (isProposed) meta.push('🗳 голосування')

  const confirm = async () => {
    if (confirming) return
    setConfirming(true)
    await onConfirm()
    setConfirming(false)
  }

  return (
    <div
      onFocusCapture={(e) => {
        if ('ontouchstart' in window && isTextField(e.target)) setTyping(true)
      }}
      onBlurCapture={() => {
        if ('ontouchstart' in window) setTimeout(() => setTyping(isTextField(document.activeElement)), 100)
      }}
    >
      {!isInTelegram() && (
        <Cell style={{ color: 'var(--tgui--link_color)' }} onClick={onBack}>
          ‹ Назад
        </Cell>
      )}
      <div style={{ textAlign: 'center', padding: '20px 16px 4px' }}>
        <div style={{ fontSize: 56, lineHeight: 1.2 }}>{category.emoji}</div>
        <Title level="2" weight="2" style={{ marginTop: 6 }}>
          {event.title}
        </Title>
        <Caption style={{ display: 'block', marginTop: 4, color: 'var(--tgui--hint_color)' }}>
          {meta.join(' · ')}
        </Caption>
      </div>
      <List style={{ paddingBottom: canRsvp || (isProposed && event.createdBy === meId) ? 104 : 24 }}>
        <Section
          header={
            <div style={{ position: 'relative' }}>
              <Section.Header>Коли</Section.Header>
              {event.recurrence && (
                <span
                  className="recurrence-badge"
                  style={{
                    position: 'absolute',
                    right: 16,
                    top: '50%',
                    transform: 'translateY(-50%)',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 5,
                    fontSize: 13,
                    fontWeight: 600,
                    padding: '5px 10px',
                    borderRadius: 999,
                  }}
                >
                  <RepeatIcon size={14} /> {event.recurrence === 'weekly' ? 'Щотижня' : 'Щомісяця'}
                </span>
              )}
            </div>
          }
          footer={dateVoting ? 'Можна відмітити кілька зручних варіантів' : undefined}
        >
          {isProposed
            ? event.slots.map((slot) =>
                dateVoting ? (
                  <Cell
                    key={slot.id}
                    Component="label"
                    className={slot.id === slotWinner?.id ? 'vote-winner' : undefined}
                    before={<Checkbox checked={slot.votes.includes(meId)} onChange={() => onToggleSlot(slot.id)} />}
                    after={<VoteCount n={slot.votes.length} winner={slot.id === slotWinner?.id} />}
                    subtitle={voterSubtitle(slot.votes, slot.addedBy, nameOf)}
                  >
                    {formatSlot(slot.startsAt)}
                  </Cell>
                ) : (
                  <Cell key={slot.id} before={<span style={{ fontSize: 22 }}>📅</span>}>
                    {formatSlot(slot.startsAt)}
                  </Cell>
                ),
              )
            : slotWinner && (
                <Cell before={<span style={{ fontSize: 22 }}>📅</span>}>{formatSlot(slotWinner.startsAt)}</Cell>
              )}
          {isProposed &&
            event.slots.length < MAX_SLOTS &&
            (addingDate ? (
              <DateTimeField
                onAdd={(iso) => {
                  onAddSlot(iso)
                  setAddingDate(false)
                }}
              />
            ) : (
              <Cell style={{ color: 'var(--tgui--link_color)' }} onClick={() => setAddingDate(true)}>
                Запропонувати свою дату
              </Cell>
            ))}
        </Section>
        <Section header="Де">
          {isProposed && event.placeOptions.length === 0 && (
            <Cell subtitle="Кинь maps-лінку — і місце зʼявиться тут">Місце ще не обрано</Cell>
          )}
          {isProposed
            ? event.placeOptions.map((option) =>
                placeVoting ? (
                  <Cell
                    key={option.id}
                    Component="label"
                    className={option.id === placeWinner?.id ? 'vote-winner' : undefined}
                    before={<Checkbox checked={option.votes.includes(meId)} onChange={() => onTogglePlace(option.id)} />}
                    after={
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 16 }}>
                        <MapsLink option={option} />
                        <VoteCount n={option.votes.length} winner={option.id === placeWinner?.id} />
                      </span>
                    }
                    subtitle={voterSubtitle(option.votes, option.addedBy, nameOf)}
                  >
                    {option.name}
                  </Cell>
                ) : (
                  <Cell
                    key={option.id}
                    before={<span style={{ fontSize: 22 }}>📍</span>}
                    after={<MapsLink option={option} />}
                  >
                    {option.name}
                  </Cell>
                ),
              )
            : placeWinner ? (
                <Cell before={<span style={{ fontSize: 22 }}>📍</span>} after={<MapsLink option={placeWinner} />}>
                  {placeWinner.name}
                </Cell>
              ) : (
                <Cell subtitle="Кинь maps-лінку — і місце зʼявиться тут">Місце ще не обрано</Cell>
              )}
          {isProposed && event.placeOptions.length < 5 &&
            (addingPlace ? (
              <OptionInput
                type="text"
                placeholder="Назва або maps-лінка"
                onAdd={(name) => {
                  onAddPlace(name)
                  setAddingPlace(false)
                }}
                onCancel={() => setAddingPlace(false)}
                onFocusInput={() => {
                  if (placeSuggestions === null) {
                    api.loadPlaceSuggestions(meId, event.category).then(setPlaceSuggestions)
                  }
                }}
                suggestions={placeSuggestions?.map((p) => ({
                  key: p.id,
                  label: p.name,
                  value: p.mapsUrl ?? p.name,
                  address: p.address,
                  photoUrl: p.photoUrl,
                }))}
              />
            ) : (
              <Cell style={{ color: 'var(--tgui--link_color)' }} onClick={() => setAddingPlace(true)}>
                Запропонувати місце
              </Cell>
            ))}
        </Section>
        {event.confirmedAt && (
          <Section
            header={`Хто йде · ${going.length}${event.maxPeople ? `/${event.maxPeople}` : ''}`}
          >
            {going.map((rsvp, i) => (
              <RsvpRow
                key={i}
                name={rsvpName(rsvp, nameOf)}
                avatarUrl={rsvp.memberId ? avatarOf(rsvp.memberId) : null}
                subtitle={rsvp.guestName ? `+1: ${nameOf(rsvp.invitedBy)}` : undefined}
                highlight={rsvp.memberId === meId || rsvp.invitedBy === meId}
                onRemove={canRsvp && rsvp.guestName && rsvp.invitedBy === meId ? () => onRemoveGuest(rsvp.guestName!) : undefined}
              />
            ))}
            {waitlisted.length > 0 && (
              <div
                style={{
                  padding: '10px 16px 4px',
                  marginTop: 4,
                  fontSize: 12,
                  fontWeight: 600,
                  color: 'var(--tgui--hint_color)',
                  borderTop: '1px solid var(--tgui--secondary_fill)',
                }}
              >
                У черзі · {waitlisted.length}
              </div>
            )}
            {waitlisted.map((rsvp, i) => (
              <RsvpRow
                key={`w${i}`}
                name={rsvpName(rsvp, nameOf)}
                avatarUrl={rsvp.memberId ? avatarOf(rsvp.memberId) : null}
                subtitle={rsvp.guestName ? `+1: ${nameOf(rsvp.invitedBy)}` : undefined}
                dim
                highlight={rsvp.memberId === meId || rsvp.invitedBy === meId}
                onRemove={canRsvp && rsvp.guestName && rsvp.invitedBy === meId ? () => onRemoveGuest(rsvp.guestName!) : undefined}
              />
            ))}
          </Section>
        )}
        {canRsvp && slotWinner && (
          <Section>
            <Cell
              style={{ color: 'var(--tgui--link_color)' }}
              onClick={() => {
                const link = openIcsLink({
                  uid: event.id,
                  title: event.title,
                  startsAt: slotWinner.startsAt,
                  location: placeWinner?.name,
                })
                openExternal(link)
              }}
            >
              Додати в календар
            </Cell>
          </Section>
        )}
        {canManage && event.createdBy === meId && (
          <Section>
            <Cell style={{ color: 'var(--tgui--destructive_text_color)' }} onClick={onCancel}>
              Скасувати івент
            </Cell>
          </Section>
        )}
        {(isHappened || isCancelled) && onRepeat && (
          <Section>
            <Cell style={{ color: 'var(--tgui--link_color)' }} onClick={onRepeat}>
              Повторити івент
            </Cell>
          </Section>
        )}
      </List>
      {!typing && isProposed && event.createdBy === meId && (
        <FixedLayout
          vertical="bottom"
          style={{
            padding: '12px 16px calc(12px + var(--tg-viewport-safe-area-inset-bottom, 0px))',
            background: 'var(--tgui--secondary_bg_color)',
          }}
        >
          <Button size="l" stretched loading={confirming} onClick={confirm}>
            Завершити голосування
          </Button>
        </FixedLayout>
      )}
      {!typing && canRsvp && (
        <FixedLayout
          vertical="bottom"
          style={{
            padding: '12px 16px calc(12px + var(--tg-viewport-safe-area-inset-bottom, 0px))',
            background: 'var(--tgui--secondary_bg_color)',
          }}
        >
          <div style={{ display: 'flex', gap: 8 }}>
            {mine?.status === 'going' || mine?.status === 'waitlisted' ? (
              <Button
                size="l"
                stretched
                mode="outline"
                style={
                  mine.status === 'going'
                    ? {
                        color: 'var(--tgui--destructive_text_color)',
                        boxShadow: '0 0 0 1px var(--tgui--destructive_text_color)',
                      }
                    : undefined
                }
                onClick={() => onRsvp('declined')}
              >
                {mine.status === 'going' ? 'Пас, не йду' : 'Вийти з черги'}
              </Button>
            ) : (
              <Button size="l" stretched onClick={() => onRsvp('going')}>
                Я в ділі
              </Button>
            )}
            <Button
              size="l"
              mode="bezeled"
              disabled={myGuestCount >= MAX_GUESTS_PER_MEMBER}
              onClick={onAddGuest}
            >
              +1
            </Button>
          </div>
        </FixedLayout>
      )}
    </div>
  )
}
