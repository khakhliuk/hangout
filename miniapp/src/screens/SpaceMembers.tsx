import { useEffect, useState } from 'react'
import { Cell, List, Section, Spinner } from '@telegram-apps/telegram-ui'
import Avatar from '../components/Avatar'
import { useBackButton } from '../lib/useBackButton'
import { isInTelegram } from '../telegram'
import { loadMembers, removeMember } from '../lib/api'
import type { SpaceMember } from '../lib/api'

type Props = {
  spaceId: string
  spaceTitle: string
  adminTgUserId: number
  myTgUserId: number
  onBack: () => void
  onChanged?: () => void
}

export default function SpaceMembers({ spaceId, spaceTitle, adminTgUserId, myTgUserId, onBack, onChanged }: Props) {
  const handleBack = () => {
    if (changed && onChanged) onChanged()
    onBack()
  }
  useBackButton(handleBack)

  const [members, setMembers] = useState<SpaceMember[]>([])
  const [loading, setLoading] = useState(true)
  const [removing, setRemoving] = useState<string | null>(null)
  const [changed, setChanged] = useState(false)

  useEffect(() => {
    loadMembers(spaceId)
      .then(setMembers)
      .finally(() => setLoading(false))
  }, [spaceId])

  const isAdmin = myTgUserId === adminTgUserId

  const handleRemove = async (member: SpaceMember) => {
    if (removing) return
    setRemoving(member.id)
    try {
      await removeMember(member.id, spaceId)
      setMembers((prev) => prev.filter((m) => m.id !== member.id))
      setChanged(true)
    } finally {
      setRemoving(null)
    }
  }

  return (
    <>
      {!isInTelegram() && (
        <Cell style={{ color: 'var(--tgui--link_color)' }} onClick={handleBack}>
          ‹ Назад
        </Cell>
      )}
      <List>
        <Section header={`Учасники · ${spaceTitle}`}>
          {loading ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: 24 }}>
              <Spinner size="m" />
            </div>
          ) : (
            members.map((member) => {
              const isMe = member.tgUserId === myTgUserId
              const isMemberAdmin = member.tgUserId === adminTgUserId
              const canRemove = isAdmin && !isMe && !isMemberAdmin
              return (
                <div key={member.id} style={{ display: 'flex', alignItems: 'center', padding: '10px 16px', gap: 12 }}>
                  <Avatar name={member.firstName} url={member.avatarUrl} highlight={isMe} />
                  <div style={{ flex: 1 }}>
                    <div>{member.firstName}{isMe ? ' (ти)' : ''}</div>
                    {isMemberAdmin && <div style={{ fontSize: 13, color: 'var(--tgui--hint_color)' }}>адмін</div>}
                  </div>
                  {canRemove && (
                    <button
                      type="button"
                      disabled={removing === member.id}
                      onClick={() => handleRemove(member)}
                      style={{
                        color: 'var(--tgui--destructive_text_color)',
                        cursor: 'pointer',
                        background: 'none',
                        border: 'none',
                        padding: '8px 12px',
                        fontSize: 16,
                        lineHeight: 1,
                        opacity: removing === member.id ? 0.4 : 1,
                      }}
                    >
                      ✕
                    </button>
                  )}
                </div>
              )
            })
          )}
        </Section>
      </List>
    </>
  )
}
