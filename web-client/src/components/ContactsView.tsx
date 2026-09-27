import { useMemo, useState } from 'react'
import Text from '../shared/ui/Text'
import IconButton from '../shared/ui/IconButton'
import TgIcon from './TgIcon'
import UserAvatar from './UserAvatar'
import { PeerStatus } from '../shared/ui/peerStatus'
import { useNavLayer } from '../core/hooks/useNavLayer'
import { useContactPeerIds } from '../core/hooks/useContactPeerIds'
import { usePeers } from '../core/hooks/usePeers'
import { useChatsStore } from '../stores/chatsStore'
import { getUserTitle } from '../core/peers/getPeerTitle'
import { getPeerPhotoId, isUserStatusOnline, type UserReal } from '../core/peers/peer'
import { useT } from '../i18n'
import type { OpenPeer } from '../data'
import NewContactPopup from './NewContactPopup'
import s from './ContactsView.module.scss'

/**
 * Экран «Контакты» — адресная книга зрителя (tweb `AppContactsTab` →
 * `ContactsList`, `sidebarLeft/contactsList.tsx`): строки — контакты книги
 * (`useContactPeerIds`), а не личные диалоги. Поиск — индексом книги
 * (`getContactsPeerIds(query)`), клик — `setPeer` пира
 * (`appDialogsManager.setListClickListener`), у нас `openPeer`.
 *
 * Сам список ещё НЕ порт `ContactsList` (виртуальный список, сортировка по
 * «был(а) в сети»/имени с кнопкой в шапке, `SectionIndex` сбоку): это наша
 * прежняя разметка с группами по букве — порядок по имени задаёт книга
 * (`contactsManager.getContacts`, `sortBy: 'name'`).
 */
export default function ContactsView({
  onOpenPeer,
  onBack,
  onOpenChat,
}: {
  onOpenPeer: (peer: OpenPeer) => void
  onBack: () => void
  /** открыть (только что созданный) приватный чат по id — после добавления контакта */
  onOpenChat?: (chatId: number) => void
}) {
  const t = useT()
  useNavLayer(true, onBack, 'left') // Back закрывает экран «Контакты»
  const [query, setQuery] = useState('')
  const [newOpen, setNewOpen] = useState(false)
  const presence = useChatsStore((st) => st.presence)

  const contactIds = useContactPeerIds(query)
  const cards = usePeers(contactIds ?? [])
  const contacts = useMemo(
    () => (contactIds ?? []).flatMap((id) => {
      const user = cards.get(id)
      return user?._ === 'user' ? [{ user, name: getUserTitle(user) }] : []
    }),
    [contactIds, cards],
  )

  // group by first letter
  const groups = useMemo(() => {
    const map = new Map<string, { user: UserReal; name: string }[]>()
    for (const c of contacts) {
      const k = c.name[0]?.toUpperCase() ?? '#'
      if (!map.has(k)) map.set(k, [])
      map.get(k)!.push(c)
    }
    return [...map.entries()]
  }, [contacts])

  return (
    <div className={s.screen}>
      {/* Header */}
      <div className={s.header}>
        <IconButton onClick={onBack} color="var(--secondary-text-color)">
          <TgIcon name="back" />
        </IconButton>
        <Text size={19} weight={600} color="var(--primary-text-color)" className={s.title}>
          {t('Contacts')}
        </Text>
        <IconButton color="var(--secondary-text-color)" onClick={() => setNewOpen(true)}>
          <TgIcon name="adduser" />
        </IconButton>
      </div>

      {/* Search */}
      <div className={s.searchWrap}>
        <div className={s.searchBar}>
          <TgIcon name="search" size={20} color="var(--secondary-text-color)" />
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
        {contactIds !== undefined && groups.length === 0 && (
          <Text size={14} color="var(--secondary-text-color)" className={s.emptyHint}>
            {t('Contacts.NotFound')}
          </Text>
        )}
        {groups.map(([letter, list]) => (
          <div key={letter}>
            <Text size={13} weight={600} color="var(--primary-color)" className={s.groupLetter}>
              {letter}
            </Text>
            {list.map(({ user, name }) => {
              const photoId = getPeerPhotoId(user.photo) || undefined
              const status = presence[user.id] ?? user.status
              const online = isUserStatusOnline(status, Date.now() / 1000)
              return (
                <div
                  key={user.id}
                  className={s.row}
                  data-peer-id={user.id}
                  onClick={() => onOpenPeer({ id: user.id, title: name, username: user.username, photoId })}
                >
                  <UserAvatar id={user.id} name={name} photoId={photoId} size={46} online={online} />
                  <div className={s.rowText}>
                    <Text noWrap size={16} color="var(--primary-text-color)">
                      {name}
                    </Text>
                    <Text noWrap size={13.5} color={online ? 'var(--primary-color)' : 'var(--secondary-text-color)'}>
                      <PeerStatus status={status} />
                    </Text>
                  </div>
                </div>
              )
            })}
          </div>
        ))}
      </div>

      <NewContactPopup
        open={newOpen}
        onClose={() => setNewOpen(false)}
        onCreated={(chatId) => { setNewOpen(false); onOpenChat?.(chatId) }}
      />
    </div>
  )
}
