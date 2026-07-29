import { useCallback, useEffect, useState } from 'react'
import { backButton } from '@telegram-apps/sdk-react'
import { Button, Placeholder, Snackbar, Spinner } from '@telegram-apps/telegram-ui'
import SpaceHeader from '../components/SpaceHeader'
import SpacePicker from '../components/SpacePicker'
import EventList from './EventList'
import EventScreen from './EventScreen'
import CreateEvent, { type RepeatDraft } from './CreateEvent'
import Settings from './Settings'
import SpaceMembers from './SpaceMembers'
import HowItWorks from './HowItWorks'
import { openAddBotLink } from '../lib/links'
import { useSettingsButton } from '../lib/useSettingsButton'
import { useHangoutData } from '../lib/useHangoutData'
import type { TgUser } from '../lib/auth'

type Props = {
  user: TgUser
  startParam: string | null
}

export default function Main({ user, startParam }: Props) {
  const [openEventId, setOpenEventId] = useState<string | null>(null)
  const data = useHangoutData(user, startParam, openEventId)
  const [creating, setCreating] = useState(false)
  const [repeatDraft, setRepeatDraft] = useState<RepeatDraft | undefined>()
  const [pickerOpen, setPickerOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [membersOpen, setMembersOpen] = useState(false)
  const [howItWorksOpen, setHowItWorksOpen] = useState(false)

  useEffect(() => {
    if (data.initialEventId) setOpenEventId(data.initialEventId)
  }, [data.initialEventId])

  const openSettings = useCallback(() => setSettingsOpen(true), [])
  const closeSettings = useCallback(() => setSettingsOpen(false), [])
  useSettingsButton(openSettings)

  const openEvent = data.events.find((e) => e.id === openEventId)
  const isHome = !openEvent && !creating && !settingsOpen && !membersOpen && !howItWorksOpen

  // Sub-screens' useBackButton hides the native back button on unmount, but
  // that cleanup can miss firing across a screen lock / resume or a reload
  // that lands straight back on the home list — re-sync it defensively
  // whenever we're actually on the home screen, including on tab refocus.
  useEffect(() => {
    if (!isHome) return
    const hide = () => {
      if (backButton.mount.isAvailable()) backButton.mount()
      if (backButton.hide.isAvailable()) backButton.hide()
    }
    hide()
    document.addEventListener('visibilitychange', hide)
    return () => document.removeEventListener('visibilitychange', hide)
  }, [isHome])

  const toast = data.notice ? (
    <Snackbar onClose={data.clearNotice} duration={2500}>
      {data.notice}
    </Snackbar>
  ) : null

  const activeSpace = data.spaces.find((s) => s.id === data.activeSpaceId)
  const isAdmin = activeSpace ? user.id === activeSpace.adminTgUserId : false

  if (howItWorksOpen) {
    return <HowItWorks onBack={() => setHowItWorksOpen(false)} />
  }

  if (membersOpen && activeSpace) {
    return (
      <SpaceMembers
        spaceId={activeSpace.id}
        spaceTitle={activeSpace.title}
        adminTgUserId={activeSpace.adminTgUserId}
        myTgUserId={user.id}
        onBack={() => setMembersOpen(false)}
        onChanged={data.reloadAll}
      />
    )
  }

  if (settingsOpen) {
    return (
      <Settings
        settings={data.settings}
        onChange={data.updateSettings}
        onBack={closeSettings}
        isAdmin={isAdmin}
        spaceId={activeSpace?.id}
        spaceTitle={activeSpace?.title}
        onManageMembers={() => setMembersOpen(true)}
        spaceSettings={data.spaceSettings}
        onChangeSpaceSettings={data.updateSpaceSettings}
        onSendFeedback={data.sendFeedback}
        onLeaveSpace={activeSpace ? () => data.leaveSpace(activeSpace.id) : undefined}
      />
    )
  }

  if (data.loading) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: 'var(--tg-viewport-stable-height, 100vh)',
        }}
      >
        <Spinner size="l" />
      </div>
    )
  }

  if (data.error) {
    return (
      <Placeholder header="Щось пішло не так" description={data.error}>
        <div style={{ marginTop: 24 }}>
          <Button size="m" onClick={() => window.location.reload()}>
            Перезавантажити
          </Button>
        </div>
      </Placeholder>
    )
  }

  if (data.spaces.length === 0 || data.activeSpaceId === null) {
    return (
      <>
        <Placeholder
          header="Тут поки порожньо"
          description="Спейс — це твоя компанія. Додай бота в груповий чат з друзями, і спейс створиться сам"
        >
          <span style={{ fontSize: 56 }}>🤝</span>
        </Placeholder>
        <div style={{ textAlign: 'center', marginBottom: 14 }}>
          <span
            role="button"
            onClick={() => setHowItWorksOpen(true)}
            style={{ color: 'var(--tgui--link_color)', fontSize: 16, fontWeight: 500, cursor: 'pointer' }}
          >
            Як це працює?
          </span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'center', padding: '0 16px' }}>
          <Button size="l" onClick={openAddBotLink}>
            Додати бота в чат
          </Button>
        </div>
      </>
    )
  }

  if (creating) {
    return (
      <CreateEvent
        memberId={data.meId}
        onBack={() => { setCreating(false); setRepeatDraft(undefined) }}
        onSubmit={async (draft) => {
          const id = await data.createEvent(draft)
          setCreating(false)
          setRepeatDraft(undefined)
          if (id) setOpenEventId(id)
        }}
        initial={repeatDraft}
      />
    )
  }

  if (openEvent) {
    return (
      <>
        <EventScreen
          event={openEvent}
          meId={data.meId}
          nameOf={data.nameOf}
          avatarOf={data.avatarOf}
          onBack={() => setOpenEventId(null)}
          onToggleSlot={(slotId) => data.toggleSlot(openEvent.id, slotId)}
          onTogglePlace={(optionId) => data.togglePlace(openEvent.id, optionId)}
          onRsvp={(status) => data.rsvp(openEvent.id, status)}
          onAddGuest={() => data.addGuest(openEvent.id)}
          onRemoveGuest={(guestName) => data.removeGuest(openEvent.id, guestName)}
          onAddSlot={(startsAt) => data.addSlot(openEvent.id, startsAt)}
          onAddPlace={(value) => data.addPlace(openEvent.id, value)}
          onCancel={() => {
            data.cancel(openEvent.id)
            setOpenEventId(null)
          }}
          onConfirm={() => data.confirm(openEvent.id)}
          onRepeat={() => {
            setRepeatDraft({
              title: openEvent.title,
              category: openEvent.category,
              maxPeople: openEvent.maxPeople,
              costPerPerson: openEvent.costPerPerson,
              recurrence: openEvent.recurrence,
              places: openEvent.placeOptions.map((o) => ({ name: o.name, mapsUrl: o.mapsUrl })),
            })
            setOpenEventId(null)
            setCreating(true)
          }}
        />
        {toast}
      </>
    )
  }

  return (
    <>
      <SpaceHeader space={activeSpace!} onClick={() => setPickerOpen(true)} />
      {data.eventsLoading ? (
        <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 48 }}>
          <Spinner size="l" />
        </div>
      ) : (
        <EventList
          events={data.events}
          onOpen={setOpenEventId}
          onCreate={() => setCreating(true)}
          onHowItWorks={() => setHowItWorksOpen(true)}
        />
      )}
      {pickerOpen && (
        <SpacePicker
          open={pickerOpen}
          spaces={data.spaces}
          activeId={data.activeSpaceId}
          onSelect={data.setActiveSpaceId}
          onOpenChange={setPickerOpen}
        />
      )}
      {toast}
    </>
  )
}
