import { Avatar, Cell, List, Modal, Section } from '@telegram-apps/telegram-ui'
import { openAddBotLink } from '../lib/links'
import type { Space } from '../lib/types'

type Props = {
  open: boolean
  spaces: Space[]
  activeId: string
  onSelect: (id: string) => void
  onOpenChange: (open: boolean) => void
}

export default function SpacePicker({ open, spaces, activeId, onSelect, onOpenChange }: Props) {
  return (
    <Modal open={open} onOpenChange={onOpenChange} header={<Modal.Header>Спейси</Modal.Header>}>
      <List style={{ paddingBottom: 'calc(16px + var(--tg-viewport-safe-area-inset-bottom, 0px))' }}>
        <Section footer="Спейс створюється автоматично, коли додаєш бота в груповий чат">
          {spaces.map((space) => (
            <Cell
              key={space.id}
              before={<Avatar size={40} acronym={space.title[0]} />}
              subtitle={`${space.memberCount} учасників`}
              after={
                space.id === activeId ? (
                  <span style={{ color: 'var(--tgui--link_color)', fontSize: 18 }}>✓</span>
                ) : undefined
              }
              onClick={() => {
                onSelect(space.id)
                onOpenChange(false)
              }}
            >
              {space.title}
            </Cell>
          ))}
          <Cell style={{ color: 'var(--tgui--link_color)' }} onClick={openAddBotLink}>
            Додати бота в чат
          </Cell>
        </Section>
      </List>
    </Modal>
  )
}
