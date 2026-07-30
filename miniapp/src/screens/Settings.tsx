import { useState } from 'react'
import { Button, Cell, List, Section, Switch, Textarea } from '@telegram-apps/telegram-ui'
import { useBackButton } from '../lib/useBackButton'
import { confirmDestructive } from '../lib/confirm'
import { shareSpaceInvite } from '../lib/links'
import type { ReminderMinutes, SpaceSettings, UserSettings } from '../lib/types'

const REMINDER_OPTIONS: { value: ReminderMinutes; label: string }[] = [
  { value: 60, label: 'За годину' },
  { value: 180, label: 'За 3 години' },
  { value: 1440, label: 'За день' },
]

type Props = {
  settings: UserSettings
  onChange: (patch: Partial<UserSettings>) => void
  onBack: () => void
  isAdmin?: boolean
  spaceId?: string
  spaceTitle?: string
  onManageMembers?: () => void
  spaceSettings?: SpaceSettings
  onChangeSpaceSettings?: (patch: Partial<SpaceSettings>) => void
  onSendFeedback?: (text: string) => Promise<boolean>
  onLeaveSpace?: () => Promise<boolean>
}

export default function Settings({
  settings,
  onChange,
  onBack,
  isAdmin,
  spaceId,
  spaceTitle,
  onManageMembers,
  spaceSettings,
  onChangeSpaceSettings,
  onSendFeedback,
  onLeaveSpace,
}: Props) {
  useBackButton(onBack)

  const [feedbackText, setFeedbackText] = useState('')
  const [sendingFeedback, setSendingFeedback] = useState(false)
  const [leaving, setLeaving] = useState(false)

  const handleLeave = async () => {
    if (!onLeaveSpace || leaving) return
    const ok = await confirmDestructive(
      `Вийти зі спейсу «${spaceTitle ?? ''}»? Щоб повернутись, знадобиться нове запрошення.`,
      'Вийти',
    )
    if (!ok) return
    setLeaving(true)
    const left = await onLeaveSpace()
    setLeaving(false)
    if (left) onBack()
  }

  const submitFeedback = async () => {
    const trimmed = feedbackText.trim()
    if (!trimmed || !onSendFeedback || sendingFeedback) return
    setSendingFeedback(true)
    const ok = await onSendFeedback(trimmed)
    setSendingFeedback(false)
    if (ok) setFeedbackText('')
  }

  const reminderEnabled = settings.reminderMinutes !== null

  return (
    <>
      <List>
        <Section header="Сповіщення" footer="Бот пише в приватний чат — переконайся, що ти його не заблокував">
          <Cell
            Component="label"
            multiline
            subtitle="коли у спейсі зʼявляється новий івент"
            after={
              <Switch
                checked={settings.notifyNewEvents}
                onChange={(e) => onChange({ notifyNewEvents: e.target.checked })}
              />
            }
          >
            Нові івенти
          </Cell>
          <Cell
            Component="label"
            multiline
            subtitle="коли звільняється місце і тебе піднімає з черги"
            after={
              <Switch
                checked={settings.notifyPromotions}
                onChange={(e) => onChange({ notifyPromotions: e.target.checked })}
              />
            }
          >
            Вихід з черги
          </Cell>
          <Cell
            Component="label"
            multiline
            subtitle="нагадати про івент, на який ти йдеш"
            after={
              <Switch
                checked={reminderEnabled}
                onChange={(e) => onChange({ reminderMinutes: e.target.checked ? 60 : null })}
              />
            }
          >
            Нагадування
          </Cell>
          {reminderEnabled && (
            <div style={{ display: 'flex', gap: 8, padding: '8px 16px 8px' }}>
              {REMINDER_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => onChange({ reminderMinutes: opt.value })}
                  style={{
                    flex: 1,
                    padding: '8px 0',
                    borderRadius: 10,
                    border: 'none',
                    cursor: 'pointer',
                    fontSize: 14,
                    fontWeight: 500,
                    textAlign: 'center',
                    background: settings.reminderMinutes === opt.value
                      ? 'var(--tgui--button_color, #007aff)'
                      : 'var(--tgui--secondary_bg_color, rgba(0,0,0,0.05))',
                    color: settings.reminderMinutes === opt.value
                      ? 'var(--tgui--button_text_color, #fff)'
                      : 'var(--tgui--text_color, #000)',
                  }}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          )}
        </Section>
        {(isAdmin || spaceSettings?.allowNewMembers || onManageMembers) && (
          <Section header={`Спейс · ${spaceTitle ?? ''}`}>
            {onManageMembers && <Cell onClick={onManageMembers}>Учасники</Cell>}
            {isAdmin && spaceSettings && onChangeSpaceSettings && (
              <Cell
                Component="label"
                multiline
                subtitle="якщо вимкнути — лінки-запрошення перестануть додавати нових людей"
                after={
                  <Switch
                    checked={spaceSettings.allowNewMembers}
                    onChange={(e) => onChangeSpaceSettings({ allowNewMembers: e.target.checked })}
                  />
                }
              >
                Дозволити нових учасників
              </Cell>
            )}
            {spaceSettings?.allowNewMembers && spaceId && (
              <Cell
                style={{ color: 'var(--tgui--link_color)' }}
                onClick={() => shareSpaceInvite(spaceId, spaceTitle ?? 'Hangout')}
              >
                Надіслати запрошення
              </Cell>
            )}
            {onLeaveSpace && (
              <Cell style={{ color: 'var(--tgui--destructive_text_color)' }} onClick={handleLeave}>
                {leaving ? 'Виходжу…' : 'Вийти зі спейсу'}
              </Cell>
            )}
          </Section>
        )}
        {onSendFeedback && (
          <Section header="Фідбек" footer="Питання, пропозиція чи баг — напиши, побачимо">
            <Textarea
              placeholder="Що сталось або що можна покращити?"
              value={feedbackText}
              onChange={(e) => setFeedbackText(e.target.value)}
              rows={4}
            />
            <div style={{ padding: '8px 16px 12px' }}>
              <Button
                size="m"
                stretched
                disabled={!feedbackText.trim() || sendingFeedback}
                onClick={submitFeedback}
              >
                {sendingFeedback ? 'Надсилаю…' : 'Надіслати'}
              </Button>
            </div>
          </Section>
        )}
      </List>
    </>
  )
}
