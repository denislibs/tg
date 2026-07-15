// AddMembersScreen — под-экран «Добавить участников» (tweb AppAddMembersTab):
// поиск (локально + глобально по людям), кандидаты с квадратными чекбоксами и
// статусом; уже состоящие в группе видны с проставленным неактивным чекбоксом.
// Угловая кнопка-галочка добавляет выбранных.
import { useEffect, useMemo, useState } from 'react'
import { SettingsScreen } from '../settings/kit'
import InputSearch from '../../shared/ui/InputSearch'
import UserAvatar from '../UserAvatar'
import Checkbox from '../../shared/ui/Checkbox'
import Spinner from '../../shared/ui/Spinner'
import Text from '../../shared/ui/Text'
import TgIcon from '../TgIcon'
import { useT, useLang } from '../../i18n'
import { useManagers } from '../../core/hooks/useManagers'
import { useGroupCandidates } from '../../core/hooks/useGroupCandidates'
import { useChatsStore, loadChats } from '../../stores/chatsStore'
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
  const existing = useMemo(() => new Set(existingIds), [existingIds])

  // Глобальный поиск людей по имени/username (как в Telegram): результаты
  // подмешиваются к контактам при вводе запроса.
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
    const extra = found.filter((u) => !seen.has(u.id))
    // уже участники — видны с проставленным неактивным чекбоксом (как в Telegram)
    return [...base, ...extra]
  }, [candidates, q, found])

  const toggle = (id: number) => {
    if (existing.has(id)) return
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

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
          const isMember = existing.has(c.id)
          return (
            <div key={c.id} className={s.memberRow} onClick={() => toggle(c.id)} style={isMember ? { cursor: 'default' } : undefined}>
              <Checkbox checked={isMember || selected.includes(c.id)} disabled={isMember} shape="square" size={20} />
              <UserAvatar id={c.id} name={c.name} avatarUrl={c.avatarUrl} online={p?.online} />
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
