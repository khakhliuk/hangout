import { useEffect, useState } from 'react'
import { Button, Caption, Cell, Chip, FixedLayout, Input, List, Section, Switch, Title } from '@telegram-apps/telegram-ui'
import DateTimeField from '../components/DateTimeField'
import MapPinIcon from '../components/MapPinIcon'
import OptionInput from '../components/OptionInput'
import RepeatIcon from '../components/RepeatIcon'
import * as api from '../lib/api'
import { mapsLinkVisible, openExternal, parsePlaceInput, resolvePlace } from '../lib/links'
import { useBackButton } from '../lib/useBackButton'
import { isInTelegram } from '../telegram'
import type { NewEventDraft } from '../lib/useHangoutData'
import { CATEGORIES, type Category, type PlaceSuggestion, type Recurrence } from '../lib/types'

export type RepeatDraft = {
  title: string
  category: Category
  maxPeople: number | null
  costPerPerson: number | null
  recurrence: Recurrence | null
  places: { name: string; mapsUrl: string | null }[]
}

type Props = {
  memberId: string
  onBack: () => void
  onSubmit: (draft: NewEventDraft) => void
  initial?: RepeatDraft
}

const MAX_SLOTS = 3
const MAX_PLACES = 5
const MAX_TITLE = 30

const slotFmt = new Intl.DateTimeFormat('uk-UA', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
})

const CATEGORY_KEYS = Object.keys(CATEGORIES) as Category[]

const RECURRENCE_OPTIONS: { key: Recurrence; label: string }[] = [
  { key: 'weekly', label: 'Щотижня' },
  { key: 'monthly', label: 'Щомісяця' },
]

function RemoveButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label="Прибрати"
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); onClick() }}
      onPointerDown={(e) => e.stopPropagation()}
      style={{
        color: 'var(--tgui--destructive_text_color)',
        cursor: 'pointer',
        padding: '8px 12px',
        background: 'none',
        border: 'none',
        fontSize: 16,
        lineHeight: 1,
      }}
    >
      ✕
    </button>
  )
}

export default function CreateEvent({ memberId, onBack, onSubmit, initial }: Props) {
  useBackButton(onBack)

  const [title, setTitle] = useState(initial?.title ?? '')
  const [category, setCategory] = useState<Category | null>(initial?.category ?? null)
  const [placeSuggestions, setPlaceSuggestions] = useState<PlaceSuggestion[] | null>(null)
  const [slots, setSlots] = useState<string[]>([])
  const [places, setPlaces] = useState<{ name: string; mapsUrl: string | null; resolving?: boolean }[]>(
    initial?.places ?? [],
  )
  const [recurrence, setRecurrence] = useState<Recurrence | null>(initial?.recurrence ?? null)
  const [maxPeople, setMaxPeople] = useState(initial?.maxPeople != null ? String(initial.maxPeople) : '')
  const [cost, setCost] = useState(initial?.costPerPerson != null ? String(initial.costPerPerson) : '')
  const [typing, setTyping] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    setPlaceSuggestions(null)
  }, [category])

  const isTextField = (el: EventTarget | null) =>
    el instanceof HTMLElement && el.matches('input:not([type=checkbox]):not([type=radio]), textarea')

  const max = maxPeople === '' ? null : Number(maxPeople)
  const valid =
    title.trim().length > 0 &&
    title.trim().length <= MAX_TITLE &&
    category !== null &&
    slots.length > 0 &&
    (max === null || (Number.isInteger(max) && max > 0))

  const addSlot = (value: string) => {
    const iso = new Date(value).toISOString()
    setSlots((prev) =>
      prev.length >= MAX_SLOTS || prev.includes(iso) ? prev : [...prev, iso].sort(),
    )
  }

  const addPlace = async (value: string) => {
    const place = parsePlaceInput(value)
    if (places.some((p) => (place.mapsUrl ? p.mapsUrl === place.mapsUrl : p.name === place.name))) return
    if (place.mapsUrl) {
      setPlaces((prev) => [...prev, { ...place, resolving: true }])
      const resolved = await resolvePlace(place.mapsUrl)
      setPlaces((prev) =>
        prev.map((p) =>
          p.mapsUrl === place.mapsUrl ? { ...p, name: resolved?.name ?? place.name, resolving: false } : p,
        ),
      )
    } else {
      setPlaces((prev) => [...prev, place])
    }
  }

  const submit = () => {
    if (!valid || submitting) return
    setSubmitting(true)
    onSubmit({
      title: title.trim(),
      category: category!,
      maxPeople: max,
      costPerPerson: cost === '' ? null : Number(cost),
      recurrence,
      slots,
      places: places.map(({ name, mapsUrl }) => ({ name, mapsUrl })),
    })
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

      <div style={{ textAlign: 'center', padding: '20px 16px 8px' }}>
        <div style={{ fontSize: 56, lineHeight: 1.1 }}>{category ? CATEGORIES[category].emoji : '🗓️'}</div>
        <Title level="2" weight="2" style={{ marginTop: 8 }}>
          Новий івент
        </Title>
        <Caption level="1" style={{ display: 'block', marginTop: 4, color: 'var(--tgui--hint_color)' }}>
          Запропонуй, а компанія проголосує
        </Caption>
      </div>

      <List style={{ paddingBottom: 104 }}>
        <Section header="Назва" footer={`${title.length}/${MAX_TITLE}`}>
          <Input
            placeholder="Наприклад, пʼятнична вечеря"
            value={title}
            maxLength={MAX_TITLE}
            onChange={(e) => setTitle(e.target.value.slice(0, MAX_TITLE))}
          />
        </Section>

        <Section header="Категорія">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, padding: '10px 16px 14px' }}>
            {CATEGORY_KEYS.map((key) => {
              const selected = category === key
              return (
                <Chip
                  key={key}
                  Component="button"
                  mode={selected ? 'elevated' : 'mono'}
                  before={<span style={{ fontSize: 18 }}>{CATEGORIES[key].emoji}</span>}
                  onClick={() => setCategory(key)}
                  style={
                    selected
                      ? { background: 'var(--tgui--button_color)', color: 'var(--tgui--button_text_color)' }
                      : undefined
                  }
                >
                  {CATEGORIES[key].label}
                </Chip>
              )
            })}
          </div>
        </Section>

        <Section
          header="Коли"
          footer={
            slots.length > 1
              ? 'Кілька варіантів — компанія проголосує за зручний'
              : `Можна додати до ${MAX_SLOTS} варіантів`
          }
        >
          {slots.map((iso) => (
            <div key={iso} style={{ display: 'flex', alignItems: 'center', padding: '10px 16px', gap: 12 }}>
              <span style={{ fontSize: 20 }}>📅</span>
              <span style={{ flex: 1 }}>{slotFmt.format(new Date(iso))}</span>
              <RemoveButton onClick={() => setSlots((prev) => prev.filter((s) => s !== iso))} />
            </div>
          ))}
          {slots.length < MAX_SLOTS && <DateTimeField onAdd={addSlot} />}
        </Section>

        <Section header="Де" footer="Встав лінку з Google Maps або напиши своє — «У Макса вдома», до 5 варіантів">
          {places.map((place) => (
            <div key={place.mapsUrl ?? place.name} style={{ display: 'flex', alignItems: 'center', padding: '10px 16px', gap: 12 }}>
              <span style={{ fontSize: 20 }}>📍</span>
              <span style={{ flex: 1, color: place.resolving ? 'var(--tgui--hint_color)' : undefined }}>
                {place.resolving ? 'Завантажую…' : place.name}
              </span>
              {place.mapsUrl && !place.resolving && mapsLinkVisible() && (
                <span
                  role="button"
                  aria-label="Відкрити на карті"
                  onClick={() => openExternal(place.mapsUrl!)}
                  style={{ cursor: 'pointer', color: 'var(--tgui--link_color)', display: 'inline-flex' }}
                >
                  <MapPinIcon />
                </span>
              )}
              {!place.resolving && (
                <RemoveButton onClick={() => setPlaces((prev) => prev.filter((p) => p !== place))} />
              )}
            </div>
          ))}
          {places.length < MAX_PLACES && (
            <OptionInput
              type="text"
              placeholder="Назва або maps-лінка"
              onAdd={addPlace}
              onFocusInput={() => {
                if (category && placeSuggestions === null) {
                  api.loadPlaceSuggestions(memberId, category).then(setPlaceSuggestions)
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
          )}
        </Section>

        <Section
          header="Максимум людей"
          footer="Якщо є ліміт — усі понад нього потраплять у чергу. Без ліміту - просто рахуємо"
        >
          <Input
            type="number"
            inputMode="numeric"
            placeholder="без обмежень"
            value={maxPeople}
            onChange={(e) => setMaxPeople(e.target.value)}
          />
        </Section>

        <Section header="Кошт, ₴ на особу">
          <Input
            type="number"
            inputMode="numeric"
            placeholder="опційно"
            value={cost}
            onChange={(e) => setCost(e.target.value)}
          />
        </Section>

        <Section footer="Автоматично створюватиме новий івент наперед, коли настане час">
          <Cell
            Component="label"
            before={<RepeatIcon />}
            after={
              <Switch
                checked={recurrence !== null}
                onChange={(e) => setRecurrence(e.target.checked ? 'weekly' : null)}
              />
            }
          >
            Повторювати
          </Cell>
          {recurrence !== null && (
            <div style={{ display: 'flex', gap: 8, padding: '10px 16px 14px' }}>
              {RECURRENCE_OPTIONS.map(({ key, label }) => {
                const selected = recurrence === key
                return (
                  <Chip
                    key={key}
                    Component="button"
                    mode={selected ? 'elevated' : 'mono'}
                    onClick={() => setRecurrence(key)}
                    style={{
                      flex: 1,
                      justifyContent: 'center',
                      ...(selected
                        ? { background: 'var(--tgui--button_color)', color: 'var(--tgui--button_text_color)' }
                        : undefined),
                    }}
                  >
                    {label}
                  </Chip>
                )
              })}
            </div>
          )}
        </Section>
      </List>

      {!typing && (
        <FixedLayout
          vertical="bottom"
          style={{
            padding: '12px 16px calc(12px + var(--tg-viewport-safe-area-inset-bottom, 0px))',
            background: 'var(--tgui--secondary_bg_color)',
          }}
        >
          <Button size="l" stretched disabled={!valid || submitting} loading={submitting} onClick={submit}>
            {slots.length > 1 || places.length > 1 ? 'Створити голосування' : 'Створити івент'}
          </Button>
        </FixedLayout>
      )}
    </div>
  )
}
