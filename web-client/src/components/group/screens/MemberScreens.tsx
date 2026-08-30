// group/screens/MemberScreens.tsx
// Управление участниками: чёрный список (tweb removedUsers), ограниченные
// участники и экран гранулярных ограничений (tweb userPermissions).
// Списки — `shared/ui/PeerSelector` (порт tweb appSelectPeers), дамп
// `15-right-09-removed-users` (включая пустое состояние с уточкой UtyanSearch).
import { useMemo, useState } from 'react'
import { SettingsScreen, Section, Row } from '../../settings/kit'
import IconButton from '../../../shared/ui/IconButton'
import PeerSelector from '../../../shared/ui/PeerSelector'
import TgIcon from '../../TgIcon'
import { useT } from '../../../i18n'
import { type GroupEdit, type EditMember, PERMS } from '../../../core/hooks/useGroupEdit'
import { MemberPicker, memberToPeer } from './shared'
import { MemberHeaderSection } from './AdminScreens'

// ── Чёрный список (tweb removedUsers, уточка UtyanSearch при пустоте) ────────
export function RemovedUsersScreen({ g, onBack }: { g: GroupEdit; onBack: () => void }) {
  const t = useT()
  const [picking, setPicking] = useState(false)
  const bannable = useMemo(
    () => g.members.filter((m) => m.role === 'member'),
    [g.members],
  )
  const peers = useMemo(
    () => g.bans.map((b) => memberToPeer(b, {
      actions: (
        <IconButton size="small" color="var(--primary-color)" onClick={() => void g.unban(b.userId)} title={t('Unban')}>
          <TgIcon name="close" size={20} />
        </IconButton>
      ),
    })),
    [g, t],
  )

  return (
    <SettingsScreen
      title="Removed Users"
      onBack={onBack}
      zIndex={70}
      sub={picking ? (
        <MemberPicker
          title="Removed Users"
          members={bannable}
          onBack={() => setPicking(false)}
          onPick={(m) => {
            setPicking(false)
            void g.ban(m.userId)
          }}
        />
      ) : null}
    >
      <PeerSelector
        peers={peers}
        caption={t('RemovedUsers.Description')}
        empty={{ title: 'No Results', description: 'Try searching.' }}
      />

      {/* Кнопка-действие экрана — вендорная `.btn-circle.btn-corner`
          (tweb `btnAddMembers`), а не свой FAB. */}
      {g.canBan && (
        <button type="button" className="btn-circle btn-corner rp" onClick={() => setPicking(true)}>
          <TgIcon name="adduser" />
        </button>
      )}

    </SettingsScreen>
  )
}

// Сроки ограничения (tweb userPermissions «Duration»): undefined — бессрочно.
const RESTRICT_DURATIONS: { label: string; seconds: number | undefined }[] = [
  { label: 'Forever', seconds: undefined },
  { label: '1 hour', seconds: 3600 },
  { label: '1 day', seconds: 86400 },
  { label: '1 week', seconds: 604800 },
]

// экран гранулярных ограничений участника (tweb userPermissions «What can this
// member do?»): тумблеры — РАЗРЕШённые действия; запрет = снятый тумблер.
export function MemberRestrictScreen({
  member, initialDenied, onBack, onSave,
}: {
  member: EditMember
  initialDenied: number
  onBack: () => void
  onSave: (deniedRights: number, untilSeconds?: number) => void
}) {
  // allowed = биты, которые участнику РАЗРЕШены (инверсия denied в пределах ALL_PERMS)
  const [allowed, setAllowed] = useState((31 & ~initialDenied) >>> 0)
  const [durIdx, setDurIdx] = useState(0)

  return (
    <SettingsScreen
      title="Restrict Member"
      onBack={onBack}
      zIndex={80}
      headerRight={
        <IconButton onClick={() => onSave((31 & ~allowed) >>> 0, RESTRICT_DURATIONS[durIdx].seconds)} color="var(--primary-color)">
          <TgIcon name="check" />
        </IconButton>
      }
    >
      <MemberHeaderSection member={member} />
      {/* tweb userPermissions: те же тумблеры-ограничения, что в правах группы
          (дамп `15-right-16-user-admin-rights`) — снятый тумблер красный. */}
      <Section caption="What can this member do?">
        {PERMS.map((p) => (
          <Row
            key={p.bit}
            label={p.label}
            translate={false}
            toggle
            restriction
            checked={(allowed & p.bit) !== 0}
            onClick={() => setAllowed((a) => (a ^ p.bit) >>> 0)}
          />
        ))}
      </Section>
      <Section caption="Duration">
        {RESTRICT_DURATIONS.map((d, i) => (
          <Row key={d.label} label={d.label} selected={i === durIdx} onClick={() => setDurIdx(i)} />
        ))}
      </Section>
    </SettingsScreen>
  )
}

// ── Ограниченные участники (tweb список restricted, кнопка «снять ограничение») ──
export function RestrictedUsersScreen({ g, onBack }: { g: GroupEdit; onBack: () => void }) {
  const t = useT()
  const peers = useMemo(() => {
    const deniedLabels = (denied: number): string => {
      const off = PERMS.filter((p) => (denied & p.bit) !== 0).map((p) => t(p.label))
      return off.length ? off.join(', ') : t('BlockedEmpty')
    }
    return g.restricted.map((r) => memberToPeer(r, {
      subtitle: `${t('Group.RestrictedBadge')}: ${deniedLabels(r.deniedRights)}`,
      actions: (
        <IconButton size="small" color="var(--primary-color)" onClick={() => void g.unrestrict(r.userId)} title={t('Unban')}>
          <TgIcon name="close" size={20} />
        </IconButton>
      ),
    }))
  }, [g, t])

  return (
    <SettingsScreen title="Restricted Users" onBack={onBack} zIndex={70}>
      <PeerSelector
        peers={peers}
        caption={t('RestrictedUsers.Description')}
        empty={{ title: 'No Results' }}
      />
    </SettingsScreen>
  )
}
