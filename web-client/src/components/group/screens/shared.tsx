// group/screens/shared.tsx
// Общие для экранов редактирования группы/канала примитивы: список эмодзи-реакций,
// инициал для аватара-плейсхолдера и универсальный пикер участника
// (добавить админа/участника/в чёрный список — tweb).
import { useMemo, useState } from 'react'
import { SettingsScreen, Section } from '../../settings/kit'
import Text from '../../../shared/ui/Text'
import InputSearch from '../../../shared/ui/InputSearch'
import UserAvatar from '../../UserAvatar'
import { useT } from '../../../i18n'
import type { EditMember } from '../../../core/hooks/useGroupEdit'
import s from '../GroupEditFlow.module.scss'

export const EMOJIS = ['👍', '❤️', '🔥', '🥰', '👏', '😁', '🤔', '🎉', '😱', '👎', '💯', '🙏']

export const initials = (name: string): string => name.trim().charAt(0).toUpperCase() || '?'

// ── общий пикер участника (для «добавить админа/участника/в чёрный список») ──
export function MemberPicker({
  title, members, onBack, onPick,
}: {
  title: string
  members: EditMember[]
  onBack: () => void
  onPick: (m: EditMember) => void
}) {
  const t = useT()
  const [q, setQ] = useState('')
  const list = useMemo(
    () => members.filter((m) => m.name.toLowerCase().includes(q.trim().toLowerCase())),
    [members, q],
  )
  return (
    <SettingsScreen title={title} onBack={onBack} zIndex={80}>
      <div className={s.search}><InputSearch value={q} onChange={setQ} placeholder={t('Search')} /></div>
      <Section>
        {list.length === 0 && (
          <Text size={14.5} color="var(--secondary-text-color)" style={{ padding: 12 }}>{t('No Results')}</Text>
        )}
        {list.map((m) => (
          <div key={m.userId} className={s.memberRow} onClick={() => onPick(m)}>
            <UserAvatar id={m.userId} name={m.name} avatarUrl={m.avatarUrl} />
            <div className={s.memberBody}>
              <Text noWrap size={16} color="var(--primary-text-color)">{m.name}</Text>
            </div>
          </div>
        ))}
      </Section>
    </SettingsScreen>
  )
}
