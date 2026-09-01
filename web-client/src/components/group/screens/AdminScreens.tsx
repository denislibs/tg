// group/screens/AdminScreens.tsx
// Администраторы (tweb chatAdministrators + EditAdmin): список админов, добавление
// через пикер и экран прав админа. Список — `shared/ui/PeerSelector`
// (порт tweb appSelectPeers), дамп `15-right-06-administrators`.
import { useMemo, useState } from 'react'
import { SettingsScreen, Section, Row } from '../../settings/kit'
import IconButton from '../../../shared/ui/IconButton'
import PeerSelector, { PeerRow } from '../../../shared/ui/PeerSelector'
import TgIcon from '../../TgIcon'
import { useT } from '../../../i18n'
import type { GroupEdit, EditMember } from '../../../core/hooks/useGroupEdit'
import { RIGHTS } from '../../../core/hooks/useGroupInfo'
import { MemberPicker, memberToPeer } from './shared'

export function AdminsScreen({ g, onBack }: { g: GroupEdit; onBack: () => void }) {
  const t = useT()
  const [editing, setEditing] = useState<EditMember | null>(null)
  const [picking, setPicking] = useState(false)
  const candidates = useMemo(() => g.members.filter((m) => m.role === 'member'), [g.members])
  const peers = useMemo(
    () => g.admins.map((m) => memberToPeer(m, {
      subtitle: t(m.role === 'creator' ? 'ChannelCreator' : 'ChatAdmin'),
      disabled: !g.canManageAdmins || m.role === 'creator',
    })),
    [g.admins, g.canManageAdmins, t],
  )

  return (
    <SettingsScreen
      title="Administrators"
      onBack={onBack}
      zIndex={70}
      sub={picking ? (
        <MemberPicker
          title="ChannelAddAdmin"
          members={candidates}
          onBack={() => setPicking(false)}
          onPick={(m) => {
            setPicking(false)
            setEditing(m)
          }}
        />
      ) : editing ? (
        <AdminRightsScreen
          member={editing}
          onBack={() => setEditing(null)}
          onSave={(bits) => {
            void g.promote(editing.userId, bits).then(() => setEditing(null))
          }}
          onDismiss={editing.role === 'admin' ? () => void g.demote(editing.userId).then(() => setEditing(null)) : undefined}
        />
      ) : null}
    >
      {g.canManageAdmins && (
        <Section>
          <Row icon={<TgIcon name="adduser" size={22} color="var(--primary-color)" />} label="ChannelAddAdmin" accent onClick={() => setPicking(true)} />
        </Section>
      )}
      <PeerSelector
        peers={peers}
        onPick={(p) => {
          const m = g.admins.find((x) => x.userId === p.id)
          if (m) setEditing(m)
        }}
        empty={{ title: 'SearchEmptyViewTitle' }}
      />
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
      title="EditAdmin"
      onBack={onBack}
      zIndex={80}
      headerRight={
        <IconButton onClick={() => onSave(bits)} color="var(--primary-color)">
          <TgIcon name="check" />
        </IconButton>
      }
    >
      <MemberHeaderSection member={member} />
      <Section caption="EditAdminWhatCanDo">
        {RIGHTS.map((r) => (
          <Row
            key={r.bit}
            label={r.label}
            translate={false}
            toggle
            restriction
            checked={(bits & r.bit) !== 0}
            onClick={() => setBits((b) => b ^ r.bit)}
          />
        ))}
      </Section>
      {onDismiss && (
        <Section>
          <Row icon={<TgIcon name="deleteuser" size={22} color="#ff595a" />} label="Channel.Admin.Dismiss" danger onClick={onDismiss} />
        </Section>
      )}
    </SettingsScreen>
  )
}

/**
 * Шапка экрана прав: тот же ряд `chatlist-chat`, что и в списке участников —
 * в tweb это буквально `ul.chatlist.chatlist-new > a.row…chatlist-chat.chatlist-chat-abitbigger`
 * внутри обычной секции (дамп `15-right-16-user-admin-rights`), а не отдельная
 * вёрстка. Поэтому и строка та же — `PeerRow` из `shared/ui/PeerSelector`.
 */
export function MemberHeaderSection({ member }: { member: EditMember }) {
  return (
    <Section>
      <div className="chatlist-container">
        <ul className="chatlist chatlist-new">
          <PeerRow peer={memberToPeer(member)} />
        </ul>
      </div>
    </Section>
  )
}
