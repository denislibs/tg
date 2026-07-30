// group/screens/MemberScreens.tsx
// Управление участниками: чёрный список (tweb removedUsers), ограниченные
// участники и экран гранулярных ограничений (tweb userPermissions).
import { useMemo, useState } from 'react'
import { AnimatePresence } from 'framer-motion'
import { SettingsScreen, Section, Row } from '../../settings/kit'
import Text from '../../../shared/ui/Text'
import IconButton from '../../../shared/ui/IconButton'
import InputSearch from '../../../shared/ui/InputSearch'
import TgIcon from '../../TgIcon'
import LottieSticker from '../../LottieSticker'
import { useT } from '../../../i18n'
import { type GroupEdit, type EditMember, PERMS } from '../../../core/hooks/useGroupEdit'
import UserAvatar from '../../UserAvatar'
import { MemberPicker } from './shared'
import s from '../GroupEditFlow.module.scss'

// ── Чёрный список (tweb removedUsers, уточка UtyanSearch при пустоте) ────────
export function RemovedUsersScreen({ g, onBack }: { g: GroupEdit; onBack: () => void }) {
  const t = useT()
  const [q, setQ] = useState('')
  const [picking, setPicking] = useState(false)
  const list = useMemo(
    () => g.bans.filter((b) => b.name.toLowerCase().includes(q.trim().toLowerCase())),
    [g.bans, q],
  )
  const bannable = useMemo(
    () => g.members.filter((m) => m.role === 'member'),
    [g.members],
  )

  return (
    <SettingsScreen title="Removed Users" onBack={onBack} zIndex={70}>
      <div className={s.search}><InputSearch value={q} onChange={setQ} placeholder={t('Search')} /></div>
      <Text size={13.5} color="var(--tg-textSecondary)" className={s.bansCaption}>
        {t('Users removed by group admins cannot rejoin via invite links.')}
      </Text>
      {list.length === 0 ? (
        <div className={s.duck}>
          <LottieSticker name="UtyanSearch" size={120} />
          <Text size={17} weight={600} color="var(--tg-textPrimary)">{t('No Results')}</Text>
          <Text size={14.5} color="var(--tg-textSecondary)">{t('Try searching.')}</Text>
        </div>
      ) : (
        <Section>
          {list.map((b) => (
            <div key={b.userId} className={s.memberRow}>
              <UserAvatar id={b.userId} name={b.name} avatarUrl={b.avatarUrl} />
              <div className={s.memberBody}>
                <Text noWrap size={16} color="var(--tg-textPrimary)">{b.name}</Text>
              </div>
              <IconButton size="small" color="var(--tg-accent)" onClick={() => void g.unban(b.userId)} title={t('Unban')}>
                <TgIcon name="close" size={20} />
              </IconButton>
            </div>
          ))}
        </Section>
      )}

      {g.canBan && (
        <div className={s.fab} onClick={() => setPicking(true)}>
          <TgIcon name="adduser" />
        </div>
      )}

      <AnimatePresence>
        {picking && (
          <MemberPicker
            title="Removed Users"
            members={bannable}
            onBack={() => setPicking(false)}
            onPick={(m) => {
              setPicking(false)
              void g.ban(m.userId)
            }}
          />
        )}
      </AnimatePresence>
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
        <IconButton onClick={() => onSave((31 & ~allowed) >>> 0, RESTRICT_DURATIONS[durIdx].seconds)} color="var(--tg-accent)">
          <TgIcon name="check" />
        </IconButton>
      }
    >
      <Section>
        <div className={s.memberRow}>
          <UserAvatar id={member.userId} name={member.name} avatarUrl={member.avatarUrl} />
          <div className={s.memberBody}>
            <Text noWrap size={16} color="var(--tg-textPrimary)">{member.name}</Text>
          </div>
        </div>
      </Section>
      <Section caption="What can this member do?">
        {PERMS.map((p) => (
          <Row
            key={p.bit}
            label={p.label}
            translate={false}
            toggle
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
  const [q, setQ] = useState('')
  const list = useMemo(
    () => g.restricted.filter((r) => r.name.toLowerCase().includes(q.trim().toLowerCase())),
    [g.restricted, q],
  )
  const deniedLabels = (denied: number): string => {
    const off = PERMS.filter((p) => (denied & p.bit) !== 0).map((p) => t(p.label))
    return off.length ? off.join(', ') : t('None')
  }

  return (
    <SettingsScreen title="Restricted Users" onBack={onBack} zIndex={70}>
      <div className={s.search}><InputSearch value={q} onChange={setQ} placeholder={t('Search')} /></div>
      <Text size={13.5} color="var(--tg-textSecondary)" className={s.bansCaption}>
        {t('These members have limited rights in this group.')}
      </Text>
      {list.length === 0 ? (
        <div className={s.duck}>
          <LottieSticker name="UtyanSearch" size={120} />
          <Text size={17} weight={600} color="var(--tg-textPrimary)">{t('No Results')}</Text>
        </div>
      ) : (
        <Section>
          {list.map((r) => (
            <div key={r.userId} className={s.memberRow}>
              <UserAvatar id={r.userId} name={r.name} avatarUrl={r.avatarUrl} />
              <div className={s.memberBody}>
                <Text noWrap size={16} color="var(--tg-textPrimary)">{r.name}</Text>
                <Text noWrap size={14} color="var(--tg-textSecondary)">{t('Restricted')}: {deniedLabels(r.deniedRights)}</Text>
              </div>
              <IconButton size="small" color="var(--tg-accent)" onClick={() => void g.unrestrict(r.userId)} title={t('Unban')}>
                <TgIcon name="close" size={20} />
              </IconButton>
            </div>
          ))}
        </Section>
      )}
    </SettingsScreen>
  )
}
