import type { LangPackKey } from '@/lang'
import { useEffect, useMemo, useRef, useState } from 'react'
import IconButton from '../shared/ui/IconButton'
import Text from '../shared/ui/Text'
import TgIcon from './TgIcon'
import UserAvatar from './UserAvatar'
import { PeerStatus } from '../shared/ui/peerStatus'
import { useContactPeerIds } from '../core/hooks/useContactPeerIds'
import { usePeers } from '../core/hooks/usePeers'
import { useChatsStore } from '../stores/chatsStore'
import { getUserTitle } from '../core/peers/getPeerTitle'
import { getPeerPhotoId, type UserReal } from '../core/peers/peer'
import type { OpenPeer } from '../data'
import { useT } from '../i18n'
import s from './NewPrivateChat.module.scss'

// Строка контакта: аватарка — конвейером воркера (`UserAvatar` → useMediaUrl),
// фолбэк — градиент+инициал.
function ContactRow({ user, name, onPick }: { user: UserReal; name: string; onPick: () => void }) {
  const presence = useChatsStore((st) => st.presence[user.id])
  return (
    <div className={s.row} data-peer-id={user.id} onClick={onPick}>
      <UserAvatar id={user.id} name={name} photoId={getPeerPhotoId(user.photo) || undefined} size="lg" />
      <div className={s.rowText}>
        <Text noWrap size={16} weight={500} color="var(--primary-text-color)">{name}</Text>
        <Text noWrap size={14} color="var(--secondary-text-color)"><PeerStatus status={presence ?? user.status} /></Text>
      </div>
    </div>
  )
}

interface Props {
  onClose: () => void
  onPick: (peer: OpenPeer) => void
  /** заголовок экрана (по умолчанию «New Message»); секретный чат переиспользует пикер */
  title?: LangPackKey
}

/**
 * «Новое сообщение» (и «Новый секретный чат») — выбор собеседника из АДРЕСНОЙ
 * КНИГИ. У tweb кнопка `newprivate` открывает `AppContactsTab`
 * (`sidebarLeft/index.ts:1039`), то есть тот же список контактов, что и пункт
 * «Контакты»: `getContactsPeerIds(query, false)`, без себя, без служебного
 * «Telegram» и без собеседников вне книги. Ботов в книге не бывает (сервер их
 * туда не пускает, `usecase/contacts::ErrCannotAddBot`), поэтому отдельный
 * фильтр ботов для секретного чата больше не нужен.
 */
export default function NewPrivateChat({ onClose, onPick, title = 'Compose.NewMessage' }: Props) {
  const t = useT()
  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  // focus only after the slide-in finishes (autofocus would interrupt the animation)
  useEffect(() => {
    const id = window.setTimeout(() => inputRef.current?.focus(), 220)
    return () => window.clearTimeout(id)
  }, [])

  const contactIds = useContactPeerIds(query)
  const cards = usePeers(contactIds ?? [])
  const people = useMemo(
    () => (contactIds ?? []).flatMap((id) => {
      const user = cards.get(id)
      return user?._ === 'user' ? [{ user, name: getUserTitle(user) }] : []
    }),
    [contactIds, cards],
  )

  return (
    <div className={s.screen}>
      {/* Header */}
      <div className={s.header}>
        <IconButton onClick={onClose} color="var(--secondary-text-color)">
          <TgIcon name="back" />
        </IconButton>
        <Text size={19} weight={600} color="var(--primary-text-color)">
          {t(title)}
        </Text>
      </div>

      {/* Search */}
      <div className={s.searchBar}>
        <TgIcon name="search" size={22} color="var(--secondary-text-color)" />
        <input
          ref={inputRef}
          className={s.searchInput}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('Search')}
        />
      </div>

      {/* Contact list */}
      <div className={s.list}>
        {people.length === 0 ? (
          <div className={s.empty}>
            <div className={s.emoji}>🐤</div>
            <Text size={19} weight={600} color="var(--primary-text-color)">
              {t('SearchEmptyViewTitle')}
            </Text>
            <Text size={15} color="var(--secondary-text-color)">{t('Search.EmptyQuery')}</Text>
          </div>
        ) : (
          people.map(({ user, name }) => (
            <ContactRow
              key={user.id}
              user={user}
              name={name}
              onPick={() => {
                onPick({ id: user.id, title: name, username: user.username, photoId: getPeerPhotoId(user.photo) || undefined })
                onClose()
              }}
            />
          ))
        )}
      </div>
    </div>
  )
}
