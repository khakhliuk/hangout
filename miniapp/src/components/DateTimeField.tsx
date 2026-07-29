import { useMemo, useState } from 'react'

type Props = {
  onAdd: (iso: string) => void
}

const dayFmt = new Intl.DateTimeFormat('uk-UA', { weekday: 'short', day: 'numeric', month: 'short' })
const dayYearFmt = new Intl.DateTimeFormat('uk-UA', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })

function buildDays(count: number): { value: string; label: string }[] {
  const out: { value: string; label: string }[] = []
  const now = new Date()
  now.setHours(0, 0, 0, 0)
  for (let i = 0; i < count; i++) {
    const d = new Date(now)
    d.setDate(now.getDate() + i)
    const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    const fmt = d.getFullYear() === now.getFullYear() ? dayFmt : dayYearFmt
    const label = i === 0 ? 'Сьогодні' : i === 1 ? 'Завтра' : fmt.format(d)
    out.push({ value, label })
  }
  return out
}

function buildTimes(): string[] {
  const out: string[] = []
  for (let h = 0; h < 24; h++) {
    for (const m of [0, 30]) {
      out.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`)
    }
  }
  return out
}

const selectStyle: React.CSSProperties = {
  border: 'none',
  background: 'transparent',
  color: 'var(--tgui--text_color)',
  fontSize: 16,
  outline: 'none',
  appearance: 'none',
  WebkitAppearance: 'none',
  cursor: 'pointer',
}

export default function DateTimeField({ onAdd }: Props) {
  const [day, setDay] = useState('')
  const [time, setTime] = useState('')
  const days = useMemo(() => buildDays(365), [])
  const times = useMemo(() => buildTimes(), [])

  const commit = (d: string, t: string) => {
    if (!d || !t) return
    onAdd(new Date(`${d}T${t}`).toISOString())
    setDay('')
    setTime('')
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', padding: '10px 16px', gap: 12 }}>
      <span style={{ fontSize: 20 }}>📅</span>
      <select
        value={day}
        onChange={(e) => {
          setDay(e.target.value)
          commit(e.target.value, time)
        }}
        style={{ ...selectStyle, flex: 1, minWidth: 0, color: day ? 'var(--tgui--text_color)' : 'var(--tgui--hint_color)' }}
      >
        <option value="" disabled>
          Оберіть день
        </option>
        {days.map((d) => (
          <option key={d.value} value={d.value}>
            {d.label}
          </option>
        ))}
      </select>
      <select
        value={time}
        onChange={(e) => {
          setTime(e.target.value)
          commit(day, e.target.value)
        }}
        style={{ ...selectStyle, flexShrink: 0, color: time ? 'var(--tgui--text_color)' : 'var(--tgui--hint_color)' }}
      >
        <option value="" disabled>
          Час
        </option>
        {times.map((t) => (
          <option key={t} value={t}>
            {t}
          </option>
        ))}
      </select>
    </div>
  )
}
