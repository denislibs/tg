// group/screens/MembersScreen.tsx
// Участники / Подписчики (tweb chatMembers): список, добавление через пикер,
// restrict/kick/ban (для группы) или удаление (для канала).
// Список — `shared/ui/PeerSelector` (порт tweb appSelectPeers): дампы
// `15-right-14-group-members` / `15-right-07-subscribers`.
import { useMemo, useState } from 'react'
import { SettingsScreen, Section, Row } from '../../settings/kit'
import IconButton from '../../../shared/ui/IconButton'
import PeerSelector from '../../../shared/ui/PeerSelector'
import TgIcon from '../../TgIcon'
import { useT } from '../../../i18n'
import type { GroupEdit, EditMember } from '../../../core/hooks/useGroupEdit'
import { useGroupCandidates } from '../../../core/hooks/useGroupCandidates'
import { MemberPicker, memberToPeer } from './shared'
import { MemberRestrictScreen } from './MemberScreens'

export function MembersScreen({ g, isChannel, onBack }: { g: GroupEdit; isChannel: boolean; onBack: () => void }) {
  const t = useT()
  const candidates = useGroupCandidates()
  const [picking, setPicking] = useState(false)
  const [restricting, setRestricting] = useState<EditMember | null>(null)
  const memberIds = useMemo(() => new Set(g.members.map((m) => m.userId)), [g.members])
  const addable = useMemo(
    () => candidates.filter((c) => !memberIds.has(c.id)).map((c) => ({ userId: c.id, name: c.name, avatarUrl: c.avatarUrl, role: 'member', rights: 0 })),
    [candidates, memberIds],
  )

  const peers = useMemo(() => g.members.map((m) => memberToPeer(m, {
    subtitle: t(m.role === 'creator' ? 'Owner' : m.role === 'admin' ? 'Admin' : 'Member'),
    actions: g.canBan && m.role !== 'creator' ? (
      <>
        {/* restrict/ban — только в группе; у канала подписчиков лишь удаляют */}
        {!isChannel && m.role !== 'admin' && (
          <IconButton size="small" color="var(--secondary-text-color)" onClick={() => setRestricting(m)} title={t('Restrict')}>
            <TgIcon name="permissions" size={20} />
          </IconButton>
        )}
        <IconButton size="small" color="var(--secondary-text-color)" onClick={() => void g.kick(m.userId)} title={t('Remove')}>
          <TgIcon name="close" size={20} />
        </IconButton>
        {!isChannel && (
          <IconButton size="small" color="#ff595a" onClick={() => void g.ban(m.userId)} title={t('Ban and remove from group')}>
            <TgIcon name="deleteuser" size={20} />
          </IconButton>
        )}
      </>
    ) : undefined,
  })), [g, isChannel, t])

  return (
    <SettingsScreen
      title={isChannel ? 'Subscribers' : 'Members'}
      onBack={onBack}
      zIndex={70}
      sub={picking ? (
        <MemberPicker
          title={isChannel ? 'Add Subscribers' : 'Add Members'}
          members={addable}
          onBack={() => setPicking(false)}
          onPick={(m) => {
            setPicking(false)
            void g.addMember(m.userId)
          }}
        />
      ) : restricting ? (
        <MemberRestrictScreen
          member={restricting}
          initialDenied={g.restricted.find((r) => r.userId === restricting.userId)?.deniedRights ?? 0}
          onBack={() => setRestricting(null)}
          onSave={(denied, untilSeconds) => {
            void g.restrict(restricting.userId, denied, untilSeconds).then(() => setRestricting(null))
          }}
        />
      ) : null}
    >
      <Section>
        <Row icon={<TgIcon name="adduser" size={22} color="var(--primary-color)" />} label={isChannel ? 'Add Subscribers' : 'Add Members'} accent onClick={() => setPicking(true)} />
      </Section>
      <PeerSelector peers={peers} empty={{ title: 'No Results' }} />
    </SettingsScreen>
  )
}
