import { useMemo, useState } from 'react'
import Text from '../shared/ui/Text'
import IconButton from '../shared/ui/IconButton'
import { motion } from 'framer-motion'
import TgIcon from './TgIcon'
import { slideInRight } from '../motion'
import Avatar from '../shared/ui/Avatar'
import { useT } from '../i18n'
import type { Chat } from '../data'
import NewContactPopup from './NewContactPopup'
import s from './ContactsView.module.scss'

export default function ContactsView({
  chats,
  onSelect,
  onBack,
  onOpenChat,
}: {
  chats: Chat[]
  onSelect: (id: string) => void
  onBack: () => void
  /** открыть (только что созданный) приватный чат по id — после добавления контакта */
  onOpenChat?: (chatId: number) => void
}) {
  const t = useT()
  const [query, setQuery] = useState('')
  const [newOpen, setNewOpen] = useState(false)

  const contacts = useMemo(
    () =>
      chats
        .filter((c) => c.type === 'private')
        .filter((c) => c.name.toLowerCase().includes(query.trim().toLowerCase()))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [chats, query],
  )

  // group by first letter
  const groups = useMemo(() => {
    const map = new Map<string, Chat[]>()
    for (const c of contacts) {
      const k = c.name[0]?.toUpperCase() ?? '#'
      if (!map.has(k)) map.set(k, [])
      map.get(k)!.push(c)
    }
    return [...map.entries()]
  }, [contacts])

  return (
    <motion.div
      variants={slideInRight}
      initial="initial"
      animate="animate"
      exit="exit"
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 40,
        background: 'var(--tg-sidebarBg)',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Header */}
      <div className={s.header}>
        <IconButton onClick={onBack} color="var(--tg-textSecondary)">
          <TgIcon name="back" />
        </IconButton>
        <Text size={19} weight={600} color="var(--tg-textPrimary)" className={s.title}>
          {t('Contacts')}
        </Text>
        <IconButton color="var(--tg-textSecondary)" onClick={() => setNewOpen(true)}>
          <TgIcon name="adduser" />
        </IconButton>
      </div>

      {/* Search */}
      <div className={s.searchWrap}>
        <div className={s.searchBar}>
          <TgIcon name="search" size={20} color="var(--tg-textFaint)" />
          <input
            className={s.searchInput}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('Search')}
          />
        </div>
      </div>

      {/* List */}
      <div className={s.list}>
        {groups.length === 0 && (
          <Text size={14} color="var(--tg-textSecondary)" className={s.emptyHint}>
            {t('No contacts found.')}
          </Text>
        )}
        {groups.map(([letter, list]) => (
          <div key={letter}>
            <Text size={13} weight={600} color="var(--tg-accent)" className={s.groupLetter}>
              {letter}
            </Text>
            {list.map((c) => (
              <div key={c.id} className={s.row} onClick={() => onSelect(c.id)}>
                <Avatar
                  background={c.avatar}
                  text={c.avatarText}
                  emoji={c.avatarEmoji}
                  size={46}
                  online={c.online}
                />
                <div className={s.rowText}>
                  <Text noWrap size={16} color="var(--tg-textPrimary)">
                    {c.name}
                  </Text>
                  <Text noWrap size={13.5} color={c.online ? 'var(--tg-accent)' : 'var(--tg-textSecondary)'}>
                    {c.online ? t('online') : c.status || t('last seen recently')}
                  </Text>
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>

      <NewContactPopup
        open={newOpen}
        onClose={() => setNewOpen(false)}
        onCreated={(chatId) => { setNewOpen(false); onOpenChat?.(chatId) }}
      />
    </motion.div>
  )
}
