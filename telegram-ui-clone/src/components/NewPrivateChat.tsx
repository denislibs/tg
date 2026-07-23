import { useEffect, useRef, useState } from 'react'
import IconButton from '../shared/ui/IconButton'
import Text from '../shared/ui/Text'
import { motion } from 'framer-motion'
import TgIcon from './TgIcon'
import Avatar from '../shared/ui/Avatar'
import type { Chat } from '../data'
import { useT } from '../i18n'
import s from './NewPrivateChat.module.scss'

interface Props {
  chats: Chat[]
  onClose: () => void
  onSelect: (id: string) => void
  /** заголовок экрана (по умолчанию «New Message»); секретный чат переиспользует пикер */
  title?: string
}

export default function NewPrivateChat({ chats, onClose, onSelect, title = 'New Message' }: Props) {
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
      c.name.toLowerCase().includes(query.toLowerCase())
  )

  return (
    <motion.div
      initial={{ x: '100%' }}
      animate={{ x: 0 }}
      exit={{ x: '100%' }}
      transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 41,
        background: 'var(--tg-sidebarBg)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <div className={s.header}>
        <IconButton onClick={onClose} color="var(--tg-textSecondary)">
          <TgIcon name="back" />
        </IconButton>
        <Text size={19} weight={600} color="var(--tg-textPrimary)">
          {t(title)}
        </Text>
      </div>

      {/* Search */}
      <div className={s.searchBar}>
        <TgIcon name="search" size={22} color="var(--tg-textFaint)" />
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
            <Text size={19} weight={600} color="var(--tg-textPrimary)">
              {t('No Results')}
            </Text>
            <Text size={15} color="var(--tg-textSecondary)">{t('Try searching.')}</Text>
          </div>
        ) : (
          people.map((c) => (
            <div
              key={c.id}
              className={s.row}
              onClick={() => {
                onSelect(c.id)
                onClose()
              }}
            >
              <Avatar background={c.avatar} text={c.avatarText} emoji={c.avatarEmoji} size="lg" />
              <div className={s.rowText}>
                <Text noWrap size={16} weight={500} color="var(--tg-textPrimary)">
                  {c.name}
                </Text>
                <Text noWrap size={14} color="var(--tg-textSecondary)">
                  {c.status}
                </Text>
              </div>
            </div>
          ))
        )}
      </div>
    </motion.div>
  )
}
