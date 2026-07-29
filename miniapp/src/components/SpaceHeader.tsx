import { Avatar, Cell } from '@telegram-apps/telegram-ui'
import type { Space } from '../lib/types'

export default function SpaceHeader({ space, onClick }: { space: Space; onClick: () => void }) {
  return (
    <div style={{ background: 'var(--tgui--bg_color)' }}>
      <Cell
        before={<Avatar size={48} acronym={space.title[0]} />}
        subtitle={`${space.memberCount} учасників`}
        after={<span style={{ color: 'var(--tgui--hint_color)', fontSize: 20 }}>›</span>}
        onClick={onClick}
      >
        {space.title}
      </Cell>
    </div>
  )
}
