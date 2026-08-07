// group/screens/AdminScreens.tsx
// Администраторы (tweb chatAdministrators + EditAdmin): список админов, добавление
// через пикер и экран прав админа.
import { useMemo, useState } from 'react'
import { AnimatePresence } from 'framer-motion'
import { SettingsScreen, Section, Row } from '../../settings/kit'
import Text from '../../../shared/ui/Text'
import IconButton from '../../../shared/ui/IconButton'
import InputSearch from '../../../shared/ui/InputSearch'
import TgIcon from '../../TgIcon'
import { useT } from '../../../i18n'
import type { GroupEdit, EditMember } from '../../../core/hooks/useGroupEdit'
import { RIGHTS } from '../../../core/hooks/useGroupInfo'
import UserAvatar from '../../UserAvatar'
import { MemberPicker } from './shared'
import s from '../GroupEditFlow.module.scss'

export function AdminsScreen({ g, onBack }: { g: GroupEdit; onBack: () => void }) {
  const t = useT()
  const [q, setQ] = useState('')
  const [editing, setEditing] = useState<EditMember | null>(null)
  const [picking, setPicking] = useState(false)
  const list = useMemo(
    () => g.admins.filter((m) => m.name.toLowerCase().includes(q.trim().toLowerCase())),
    [g.admins, q],
  )
  const candidates = useMemo(() => g.members.filter((m) => m.role === 'member'), [g.members])

  return (
    <SettingsScreen title="Administrators" onBack={onBack} zIndex={70}>
      <div className={s.search}><InputSearch value={q} onChange={setQ} placeholder={t('Search')} /></div>
      <Section>
        {g.canManageAdmins && (
          <Row icon={<TgIcon name="adduser" size={22} color="var(--primary-color)" />} label="Add Admin" accent onClick={() => setPicking(true)} />
        )}
        {list.map((m) => (
          <div key={m.userId} className={s.memberRow} onClick={() => g.canManageAdmins && m.role !== 'creator' && setEditing(m)}>
            <UserAvatar id={m.userId} name={m.name} avatarUrl={m.avatarUrl} />
            <div className={s.memberBody}>
              <Text noWrap size={16} color="var(--primary-text-color)">{m.name}</Text>
              <Text noWrap size={14} color="var(--secondary-text-color)">
                {t(m.role === 'creator' ? 'Owner' : 'Admin')}
              </Text>
            </div>
          </div>
        ))}
      </Section>

      <AnimatePresence>
        {picking && (
          <MemberPicker
            title="Add Admin"
            members={candidates}
            onBack={() => setPicking(false)}
            onPick={(m) => {
              setPicking(false)
              setEditing(m)
            }}
          />
        )}
        {editing && (
          <AdminRightsScreen
            member={editing}
            onBack={() => setEditing(null)}
            onSave={(bits) => {
              void g.promote(editing.userId, bits).then(() => setEditing(null))
            }}
            onDismiss={editing.role === 'admin' ? () => void g.demote(editing.userId).then(() => setEditing(null)) : undefined}
          />
        )}
      </AnimatePresence>
    </SettingsScreen>
  )
}

// экран прав админа (tweb EditAdmin «What can this admin do?»)
function AdminRightsScreen({
  member, onBack, onSave, onDismiss,
}: {
  member: EditMember
  onBack: () => void
  onSave: (bits: number) => void
  onDismiss?: () => void
}) {
  const [bits, setBits] = useState(255) // все права по умолчанию

  return (
    <SettingsScreen
      title="Admin Rights"
      onBack={onBack}
      zIndex={80}
      headerRight={
        <IconButton onClick={() => onSave(bits)} color="var(--primary-color)">
          <TgIcon name="check" />
        </IconButton>
      }
    >
      <Section>
        <div className={s.memberRow}>
          <UserAvatar id={member.userId} name={member.name} avatarUrl={member.avatarUrl} />
          <div className={s.memberBody}>
            <Text noWrap size={16} color="var(--primary-text-color)">{member.name}</Text>
          </div>
        </div>
      </Section>
      <Section caption="What can this admin do?">
        {RIGHTS.map((r) => (
          <Row
            key={r.bit}
            label={r.label}
            translate={false}
            toggle
            checked={(bits & r.bit) !== 0}
            onClick={() => setBits((b) => b ^ r.bit)}
          />
        ))}
      </Section>
      {onDismiss && (
        <Section>
          <Row icon={<TgIcon name="deleteuser" size={22} color="#ff595a" />} label="Dismiss Admin" danger onClick={onDismiss} />
        </Section>
      )}
    </SettingsScreen>
  )
}
