// AddMembersScreen — под-экран «Добавить участников» (tweb AppAddMembersTab):
// поиск, кандидаты с чекбоксами и статусом, угловая кнопка-галочка добавляет
// выбранных. Кандидаты — контакты ∪ пиры приватных диалогов, минус уже участники.
import { useMemo, useState } from 'react'
import { SettingsScreen } from '../settings/kit'
import InputSearch from '../../shared/ui/InputSearch'
import Avatar from '../../shared/ui/Avatar'
import Checkbox from '../../shared/ui/Checkbox'
import Spinner from '../../shared/ui/Spinner'
import Text from '../../shared/ui/Text'
import TgIcon from '../TgIcon'
import { useT, useLang } from '../../i18n'
import { useManagers } from '../../core/hooks/useManagers'
import { useGroupCandidates } from '../../core/hooks/useGroupCandidates'
import { useChatsStore, loadChats } from '../../stores/chatsStore'
import { gradientFor } from '../../core/dialogToChat'
import { lastSeenLabel } from '../../core/presence'
import s from './GroupEditFlow.module.scss'

export default function AddMembersScreen({
  chatId,
  existingIds,
  onClose,
  onAdded,
}: {
  chatId: number
  /** уже участники — прячем из кандидатов */
  existingIds: number[]
  onClose: () => void
  onAdded: () => void
}) {
  const t = useT()
  const [lang] = useLang()
  const managers = useManagers()
  const candidates = useGroupCandidates(managers)
  const presence = useChatsStore((st) => st.presence)
  const [q, setQ] = useState('')
  const [selected, setSelected] = useState<number[]>([])
  const [saving, setSaving] = useState(false)

  const list = useMemo(() => {
    const taken = new Set(existingIds)
    const query = q.trim().toLowerCase()
    return candidates
      .filter((c) => !taken.has(c.id))
      .filter((c) => !query || c.name.toLowerCase().includes(query))
  }, [candidates, existingIds, q])

  const toggle = (id: number) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))

  const confirm = async () => {
    if (!selected.length || saving) return
    setSaving(true)
    try {
      for (const id of selected) await managers.groups.addMember(chatId, id)
      await loadChats(managers)
      onAdded()
    } finally {
      setSaving(false)
    }
  }

  return (
    <SettingsScreen title="Add Members" onBack={onClose} zIndex={70}>
      <div className={s.search}>
        <InputSearch value={q} onChange={setQ} placeholder={t('Search')} />
      </div>
      <div className={s.cardList}>
        {list.length === 0 && (
          <Text size={14.5} color="var(--tg-textSecondary)" style={{ padding: 16, display: 'block', textAlign: 'center' }}>
            {t('No Results')}
          </Text>
        )}
        {list.map((c) => {
          const p = presence[c.id]
          return (
            <div key={c.id} className={s.memberRow} onClick={() => toggle(c.id)}>
              <Checkbox checked={selected.includes(c.id)} size={20} />
              <Avatar size="md" background={gradientFor(c.id)} src={c.avatarUrl} text={c.name.charAt(0).toUpperCase() || '?'} />
              <div className={s.memberBody}>
                <Text noWrap size={15.5} weight={600} color="var(--tg-textPrimary)">{c.name}</Text>
                <Text noWrap size={13.5} color={p?.online ? 'var(--tg-accent)' : 'var(--tg-textSecondary)'}>
                  {p?.online ? t('online') : lastSeenLabel(p?.lastSeen ?? 0, lang)}
                </Text>
              </div>
            </div>
          )
        })}
      </div>

      {selected.length > 0 && (
        <div className={s.fab} onClick={() => void confirm()}>
          {saving ? <Spinner size={24} /> : <TgIcon name="check" />}
        </div>
      )}
    </SettingsScreen>
  )
}
