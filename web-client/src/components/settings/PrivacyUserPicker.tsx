// PrivacyUserPicker — выбор пользователей для privacy (tweb AppAddMembersTab,
// type 'privacy'): исключения правила (multi, галочка подтверждает) и «Block
// user...» (single, клик выбирает сразу). Кандидаты — контакты ∪ пиры диалогов
// + глобальный поиск.
//
// Разметка — `shared/ui/PeerSelector`; вариант privacy в tweb это
// `design: 'round', checkboxSide: 'right'` (addMembers.tsx:52-56), то есть тот
// же `selector-round selector-right`, что у списков правой колонки.
import { useEffect, useMemo, useState } from 'react'
import { SettingsScreen } from './kit'
import PeerSelector from '../../shared/ui/PeerSelector'
import TgIcon from '../TgIcon'
import { useT } from '../../i18n'
import { useManagers } from '../../core/hooks/useManagers'
import { useGroupCandidates } from '../../core/hooks/useGroupCandidates'

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
  const candidates = useGroupCandidates()
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

  // Фильтрация своя (`noFilter` у селектора): выдачу глобального поиска
  // повторно по имени фильтровать нельзя — сервер матчит и по username.
  const peers = useMemo(() => {
    const query = q.trim().toLowerCase()
    const base = candidates.filter((c) => !query || c.name.toLowerCase().includes(query))
    const seen = new Set(base.map((c) => c.id))
    return [...base, ...found.filter((u) => !seen.has(u.id))]
      .map((c) => ({ id: c.id, name: c.name, avatarUrl: c.avatarUrl }))
  }, [candidates, q, found])

  const changed = useMemo(() => {
    if (selected.length !== initial.length) return true
    const set = new Set(initial)
    return selected.some((id) => !set.has(id))
  }, [selected, initial])

  return (
    <SettingsScreen title={title} onBack={onBack} zIndex={80}>
      <PeerSelector
        peers={peers}
        mode={multi ? 'multi' : 'single'}
        noFilter
        placeholder={t(placeholder)}
        onQueryChange={setQ}
        selected={selected}
        onSelectedChange={setSelected}
        onPick={(p) => onPick?.(p.id)}
        empty={{ title: 'No Results' }}
      />

      {multi && changed && (
        <button type="button" className="btn-circle btn-corner rp" onClick={() => onDone?.(selected)}>
          <TgIcon name="check" />
        </button>
      )}
    </SettingsScreen>
  )
}
