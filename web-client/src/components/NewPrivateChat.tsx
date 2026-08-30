import { useEffect, useRef, useState } from 'react'
import IconButton from '../shared/ui/IconButton'
import Text from '../shared/ui/Text'
import TgIcon from './TgIcon'
import Avatar from '../shared/ui/Avatar'
import { useMediaUrl } from '../core/hooks/useMediaUrl'
import type { Chat } from '../data'
import { useT } from '../i18n'
import s from './NewPrivateChat.module.scss'

// Строка контакта: id медиа фото → objectURL воркерного конвейера (иначе
// <img> ловит 401 и аватар «пропадает»), фолбэк — градиент+инициал.
function ContactRow({ c, onPick }: { c: Chat; onPick: () => void }) {
  const src = useMediaUrl(c.photoId ?? null)
  return (
    <div className={s.row} onClick={onPick}>
      <Avatar background={c.avatar} text={c.avatarText} emoji={c.avatarEmoji} src={src || undefined} preview={c.avatarPreview} size="lg" />
      <div className={s.rowText}>
        <Text noWrap size={16} weight={500} color="var(--primary-text-color)">{c.name}</Text>
        <Text noWrap size={14} color="var(--secondary-text-color)">{c.status}</Text>
      </div>
    </div>
  )
}

interface Props {
  chats: Chat[]
  onClose: () => void
  onSelect: (id: string) => void
  /** заголовок экрана (по умолчанию «New Message»); секретный чат переиспользует пикер */
  title?: string
  /** секретный чат: боты недоступны (у ботов нет E2E-секретов), скрываем их */
  excludeBots?: boolean
}

export default function NewPrivateChat({ chats, onClose, onSelect, title = 'New Message', excludeBots }: Props) {
  const t = useT()
  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  // focus only after the slide-in finishes (autofocus would interrupt the animation)
  useEffect(() => {
    const id = window.setTimeout(() => inputRef.current?.focus(), 220)
    return () => window.clearTimeout(id)
  }, [])

  const people = chats.filter(
    (c) =>
      (c.type === 'private' || c.type === 'bot') &&
      !(excludeBots && (c.isBot || c.type === 'bot')) &&
      c.name.toLowerCase().includes(query.toLowerCase()),
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
          people.map((c) => (
            <ContactRow key={c.id} c={c} onPick={() => { onSelect(c.id); onClose() }} />
          ))
        )}
      </div>
    </div>
  )
}
