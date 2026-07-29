import { useRef, useState, type ReactNode } from 'react'
import { Button, Input } from '@telegram-apps/telegram-ui'

export type OptionSuggestion = { key: string; label: string; value: string; address?: string | null; photoUrl?: string | null }

function Thumb({ photoUrl }: { photoUrl?: string | null }) {
  const [failed, setFailed] = useState(false)
  if (photoUrl && !failed) {
    return (
      <img
        src={photoUrl}
        onError={() => setFailed(true)}
        style={{ width: 40, height: 40, borderRadius: 11, objectFit: 'cover', flexShrink: 0 }}
      />
    )
  }
  return (
    <span
      style={{
        width: 40,
        height: 40,
        flexShrink: 0,
        borderRadius: 11,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 18,
        background: 'var(--tgui--secondary_fill)',
      }}
    >
      📍
    </span>
  )
}

type Props = {
  type: 'datetime-local' | 'text'
  placeholder?: string
  before?: ReactNode
  onAdd: (value: string) => void
  onCancel?: () => void
  suggestions?: OptionSuggestion[]
  onFocusInput?: () => void
}

export default function OptionInput({ type, placeholder, before, onAdd, onCancel, suggestions, onFocusInput }: Props) {
  const [value, setValue] = useState('')
  const [open, setOpen] = useState(false)
  const blurTimeout = useRef<ReturnType<typeof setTimeout>>()

  const add = () => {
    const trimmed = value.trim()
    if (!trimmed) return
    onAdd(trimmed)
    setValue('')
  }

  const select = (suggestion: OptionSuggestion) => {
    clearTimeout(blurTimeout.current)
    setValue(suggestion.value)
    setOpen(false)
  }

  return (
    <div style={{ position: 'relative' }}>
      <style>{`
        @keyframes optionBoxIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
        .option-suggestion-row { transition: background 0.12s ease; }
        .option-suggestion-row:active { background: var(--tgui--secondary_bg_color); }
      `}</style>
      {open && suggestions && suggestions.length > 0 && (
        <div
          style={{
            position: 'absolute',
            bottom: '100%',
            left: 0,
            right: 0,
            marginBottom: 2,
            borderTopLeftRadius: 14,
            borderTopRightRadius: 14,
            boxShadow: '0 0 0 2px var(--tgui--outline)',
            background: 'var(--tgui--card_bg_color)',
            overflow: 'hidden',
            animation: 'optionBoxIn 0.16s ease-out',
          }}
        >
          <div style={{ maxHeight: 320, overflowY: 'auto' }}>
            <div
              style={{
                padding: '10px 14px 6px',
                fontSize: 12,
                fontWeight: 700,
                color: 'var(--tgui--link_color)',
              }}
            >
              Останні додані
            </div>
            {suggestions.map((s, i) => (
              <div
                key={s.key}
                className="option-suggestion-row"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => select(s)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '9px 14px',
                  cursor: 'pointer',
                  borderTop: i > 0 ? '1px solid var(--tgui--secondary_fill)' : undefined,
                }}
              >
                <Thumb photoUrl={s.photoUrl} />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {s.label}
                  </div>
                  {s.address && (
                    <div
                      style={{
                        marginTop: 1,
                        fontSize: 12,
                        color: 'var(--tgui--hint_color)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {s.address}
                    </div>
                  )}
                </div>
                <span style={{ color: 'var(--tgui--link_color)', fontSize: 15, flexShrink: 0, opacity: 0.7 }}>›</span>
              </div>
            ))}
          </div>
        </div>
      )}
      <Input
        type={type}
        placeholder={placeholder}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onFocus={() => {
          setOpen(true)
          onFocusInput?.()
        }}
        onBlur={() => {
          blurTimeout.current = setTimeout(() => setOpen(false), 150)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setOpen(false)
        }}
        before={before}
        after={
          <div style={{ display: 'flex', alignItems: 'center', gap: 2, flexShrink: 0, margin: '-8px 0' }}>
            <Button size="s" mode="plain" disabled={!value.trim()} onClick={add} style={{ whiteSpace: 'nowrap' }}>
              Додати
            </Button>
            {onCancel && (
              <Button size="s" mode="plain" onClick={onCancel} aria-label="Скасувати">
                ✕
              </Button>
            )}
          </div>
        }
      />
    </div>
  )
}
