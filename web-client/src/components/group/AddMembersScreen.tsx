// AddMembersScreen — под-экран «Добавить участников» (tweb AppAddMembersTab):
// поиск (локально + глобально по людям), кандидаты с квадратными чекбоксами и
// статусом; уже состоящие в группе видны с проставленным неактивным чекбоксом.
// Угловая кнопка-галочка добавляет выбранных.
//
// Разметка — левый вариант селектора tweb: `selector-square selector-left`
// с чипами выбранных в поле поиска (дампы `14-left-30-new-group-members`
// и `14-left-30b-new-group-members-selected`).
import { useEffect, useMemo, useState } from 'react'
import { SettingsScreen } from '../settings/kit'
import PeerSelector from '../../shared/ui/PeerSelector'
import Spinner from '../../shared/ui/Spinner'
import TgIcon from '../TgIcon'
import { useT, useLang } from '../../i18n'
import { useManagers } from '../../core/hooks/useManagers'
import { useGroupCandidates } from '../../core/hooks/useGroupCandidates'
import { useChatsStore } from '../../stores/chatsStore'
import { userStatusLabel } from '../../core/presence'
import { getPeerPhotoId, peerKey } from '../../core/peers/peer'
import { getUserTitle } from '../../core/peers/getPeerTitle'

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
  const candidates = useGroupCandidates()
  const presence = useChatsStore((st) => st.presence)
  const [q, setQ] = useState('')
  const [selected, setSelected] = useState<number[]>([])
  const [saving, setSaving] = useState(false)
  const existing = useMemo(() => new Set(existingIds), [existingIds])

  // Глобальный поиск людей по имени/username (как в Telegram): результаты
  // подмешиваются к контактам при вводе запроса.
  const [found, setFound] = useState<{ id: PeerId; name: string; photoId?: number }[]>([])
  useEffect(() => {
    const query = q.trim()
    if (query.length < 2) {
      setFound([])
      return
    }
    let alive = true
    const tm = setTimeout(() => {
      void managers.channels.search(query).then((r) => {
        if (alive) setFound(r.users.map((u) => ({ id: peerKey(u), name: getUserTitle(u), photoId: getPeerPhotoId(u.photo) || undefined })))
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
    const extra = found.filter((u) => !seen.has(u.id))
    // уже участники — видны с проставленным неактивным чекбоксом (как в Telegram)
    return [...base, ...extra].map((c) => {
      const p = presence[c.id]
      return {
        id: c.id,
        name: c.name,
        photoId: c.photoId,
        subtitle: userStatusLabel(p, lang),
        // уже участник: галочка стоит, снять нельзя, чипа не даёт
        disabled: existing.has(c.id),
        checked: existing.has(c.id),
      }
    })
  }, [candidates, q, found, presence, existing, t, lang])

  const confirm = async () => {
    if (!selected.length || saving) return
    setSaving(true)
    try {
      for (const id of selected) await managers.groups.addMember(chatId, id)
      await managers.dialogs.refresh()
      onAdded()
    } finally {
      setSaving(false)
    }
  }

  return (
    <SettingsScreen title="GroupAddMembers" onBack={onClose} zIndex={70}>
      <PeerSelector
        peers={peers}
        mode="multi"
        design="square"
        side="left"
        noFilter
        onQueryChange={setQ}
        selected={selected}
        onSelectedChange={setSelected}
        empty={{ title: 'SearchEmptyViewTitle' }}
      />

      {selected.length > 0 && (
        <button type="button" className="btn-circle btn-corner rp" onClick={() => void confirm()}>
          {saving ? <Spinner size={24} /> : <TgIcon name="check" />}
        </button>
      )}
    </SettingsScreen>
  )
}
