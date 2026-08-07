// group/screens/MembersScreen.tsx
// Участники / Подписчики (tweb chatMembers): список, добавление через пикер,
// restrict/kick/ban (для группы) или удаление (для канала).
import { useMemo, useState } from 'react'
import { AnimatePresence } from 'framer-motion'
import { SettingsScreen, Section, Row } from '../../settings/kit'
import Text from '../../../shared/ui/Text'
import IconButton from '../../../shared/ui/IconButton'
import InputSearch from '../../../shared/ui/InputSearch'
import TgIcon from '../../TgIcon'
import { useT } from '../../../i18n'
import type { GroupEdit, EditMember } from '../../../core/hooks/useGroupEdit'
import { useGroupCandidates } from '../../../core/hooks/useGroupCandidates'
import UserAvatar from '../../UserAvatar'
import { MemberPicker } from './shared'
import { MemberRestrictScreen } from './MemberScreens'
import s from '../GroupEditFlow.module.scss'

export function MembersScreen({ g, isChannel, onBack }: { g: GroupEdit; isChannel: boolean; onBack: () => void }) {
  const t = useT()
  const candidates = useGroupCandidates()
  const [q, setQ] = useState('')
  const [picking, setPicking] = useState(false)
  const [restricting, setRestricting] = useState<EditMember | null>(null)
  const list = useMemo(
    () => g.members.filter((m) => m.name.toLowerCase().includes(q.trim().toLowerCase())),
    [g.members, q],
  )
  const memberIds = useMemo(() => new Set(g.members.map((m) => m.userId)), [g.members])
  const addable = useMemo(
    () => candidates.filter((c) => !memberIds.has(c.id)).map((c) => ({ userId: c.id, name: c.name, avatarUrl: c.avatarUrl, role: 'member', rights: 0 })),
    [candidates, memberIds],
  )

  return (
    <SettingsScreen title={isChannel ? 'Subscribers' : 'Members'} onBack={onBack} zIndex={70}>
      <div className={s.search}><InputSearch value={q} onChange={setQ} placeholder={t('Search')} /></div>
      <Section>
        <Row icon={<TgIcon name="adduser" size={22} color="var(--primary-color)" />} label={isChannel ? 'Add Subscribers' : 'Add Members'} accent onClick={() => setPicking(true)} />
        {list.map((m) => (
          <div key={m.userId} className={s.memberRow}>
            <UserAvatar id={m.userId} name={m.name} avatarUrl={m.avatarUrl} />
            <div className={s.memberBody}>
              <Text noWrap size={16} color="var(--primary-text-color)">{m.name}</Text>
              <Text noWrap size={14} color="var(--secondary-text-color)">
                {t(m.role === 'creator' ? 'Owner' : m.role === 'admin' ? 'Admin' : 'Member')}
              </Text>
            </div>
            {g.canBan && m.role !== 'creator' && (
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
            )}
          </div>
        ))}
      </Section>

      <AnimatePresence>
        {picking && (
          <MemberPicker
            title={isChannel ? 'Add Subscribers' : 'Add Members'}
            members={addable}
            onBack={() => setPicking(false)}
            onPick={(m) => {
              setPicking(false)
              void g.addMember(m.userId)
            }}
          />
        )}
        {restricting && (
          <MemberRestrictScreen
            member={restricting}
            initialDenied={g.restricted.find((r) => r.userId === restricting.userId)?.deniedRights ?? 0}
            onBack={() => setRestricting(null)}
            onSave={(denied, untilSeconds) => {
              void g.restrict(restricting.userId, denied, untilSeconds).then(() => setRestricting(null))
            }}
          />
        )}
      </AnimatePresence>
    </SettingsScreen>
  )
}
