// PrivacyUserPicker — выбор пользователей для privacy (tweb AppAddMembersTab,
// type 'privacy'): исключения правила (multi, галочка подтверждает) и «Block
// user...» (single, клик выбирает сразу). Кандидаты — контакты ∪ пиры диалогов
// + глобальный поиск.
import { useEffect, useMemo, useState } from 'react'
import { SettingsScreen } from './kit'
import InputSearch from '../../shared/ui/InputSearch'
import UserAvatar from '../UserAvatar'
import Checkbox from '../../shared/ui/Checkbox'
import Text from '../../shared/ui/Text'
import TgIcon from '../TgIcon'
import { useT } from '../../i18n'
import { useManagers } from '../../core/hooks/useManagers'
import { useGroupCandidates } from '../../core/hooks/useGroupCandidates'
import s from '../group/GroupEditFlow.module.scss'

export default function PrivacyUserPicker({
  title,
  placeholder = 'Search',
  multi = true,
  initial = [],
  onDone,
  onPick,
  onBack,
}: {
  title: string
  placeholder?: string
  /** multi: чекбоксы + галочка-подтверждение; single: клик выбирает сразу */
  multi?: boolean
  initial?: number[]
  onDone?: (ids: number[]) => void
  onPick?: (id: number) => void
  onBack: () => void
}) {
  const t = useT()
  const managers = useManagers()
  const candidates = useGroupCandidates(managers)
  const [q, setQ] = useState('')
  const [selected, setSelected] = useState<number[]>(initial)

  // Глобальный поиск людей по имени/username — как в AddMembersScreen.
  const [found, setFound] = useState<{ id: number; name: string; avatarUrl?: string }[]>([])
  useEffect(() => {
    const query = q.trim()
    if (query.length < 2) {
      setFound([])
      return
    }
    let alive = true
    const tm = setTimeout(() => {
      void managers.channels.search(query).then((r) => {
        if (alive) setFound(r.users.map((u) => ({ id: u.id, name: u.displayName || u.username, avatarUrl: u.avatarUrl || undefined })))
      }).catch(() => {})
    }, 250)
    return () => {
      alive = false
      clearTimeout(tm)
    }
  }, [q, managers])

  const list = useMemo(() => {
    const query = q.trim().toLowerCase()
    const base = candidates.filter((c) => !query || c.name.toLowerCase().includes(query))
    const seen = new Set(base.map((c) => c.id))
    return [...base, ...found.filter((u) => !seen.has(u.id))]
  }, [candidates, q, found])

  const rowClick = (id: number) => {
    if (!multi) {
      onPick?.(id)
      return
    }
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  const changed = useMemo(() => {
    if (selected.length !== initial.length) return true
    const set = new Set(initial)
    return selected.some((id) => !set.has(id))
  }, [selected, initial])

  return (
    <SettingsScreen title={title} onBack={onBack} zIndex={80}>
      <div className={s.search}>
        <InputSearch value={q} onChange={setQ} placeholder={t(placeholder)} />
      </div>
      <div className={s.cardList}>
        {list.length === 0 && (
          <Text size={14.5} color="var(--tg-textSecondary)" style={{ padding: 16, display: 'block', textAlign: 'center' }}>
            {t('No Results')}
          </Text>
        )}
        {list.map((c) => (
          <div key={c.id} className={s.memberRow} onClick={() => rowClick(c.id)}>
            {multi && <Checkbox checked={selected.includes(c.id)} shape="square" size={20} />}
            <UserAvatar id={c.id} name={c.name} avatarUrl={c.avatarUrl} />
            <div className={s.memberBody}>
              <Text noWrap size={16} color="var(--tg-textPrimary)">{c.name}</Text>
            </div>
          </div>
        ))}
      </div>

      {multi && changed && (
        <div className={s.fab} onClick={() => onDone?.(selected)}>
          <TgIcon name="check" />
        </div>
      )}
    </SettingsScreen>
  )
}
