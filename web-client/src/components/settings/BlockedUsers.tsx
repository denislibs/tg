// BlockedUsers — чёрный список (tweb AppBlockedUsersTab): реальный список с
// бэка, добавление через пикер («Block user...»), разблокировка крестиком.
import { useCallback, useEffect, useState } from 'react'
import TgIcon from '../TgIcon'
import UserAvatar from '../UserAvatar'
import Text from '../../shared/ui/Text'
import { useT } from '../../i18n'
import { useManagers } from '../../core/hooks/useManagers'
import { usePrivacyStore } from '../../stores/privacyStore'
import { SettingsScreen, Section, Row, EntryRow } from './kit'
import PrivacyUserPicker from './PrivacyUserPicker'
import { getPeerId } from '../../core/peers/peerId'
import { getPeerPhotoId, type UserReal } from '../../core/peers/peer'
import { getUserTitle } from '../../core/peers/getPeerTitle'

export default function BlockedUsers({ onBack }: { onBack: () => void }) {
  const t = useT()
  const managers = useManagers()
  const setBlockedTotal = usePrivacyStore((s) => s.setBlockedTotal)
  // Ответ — конструктор `contacts.blockedSlice`: вектор `peerBlocked{peer_id}`
  // отдельно, КАРТОЧКИ отдельно (в `users`). Плоского снимка пользователя рядом
  // с настоящим больше нет, поэтому строку собираем связкой ключ → карточка,
  // как это делает оригинал со всеми ответами вида `…{chats, users}`.
  const [list, setList] = useState<UserReal[]>([])
  const [loaded, setLoaded] = useState(false)
  const [picking, setPicking] = useState(false)

  const reload = useCallback(async () => {
    try {
      const res = await managers.privacy.blocked(0, 100)
      const byId = new Map(res.users.map((u) => [u.id, u]))
      setList(res.blocked.map((b) => byId.get(getPeerId(b.peer_id))).filter((u): u is UserReal => !!u))
      setBlockedTotal(res.count)
    } catch {
      /* оффлайн — оставляем как есть */
    }
    setLoaded(true)
  }, [managers, setBlockedTotal])

  useEffect(() => {
    void reload()
  }, [reload])

  const block = async (userId: number) => {
    setPicking(false)
    await managers.privacy.block(userId).catch(() => {})
    void reload()
  }

  const unblock = async (userId: number) => {
    setList((l) => l.filter((x) => x.id !== userId)) // оптимистично
    await managers.privacy.unblock(userId).catch(() => {})
    void reload()
  }

  return (
    <SettingsScreen
      title="Blocked Users"
      onBack={onBack}
      sub={picking ? (
        <PrivacyUserPicker
          title="Blocked Users"
          placeholder="Block user..."
          multi={false}
          onPick={(id) => void block(id)}
          onBack={() => setPicking(false)}
        />
      ) : null}
    >
      <Section footer="Blocked users can't send you messages or add you to groups. They will not see your profile photos, online and last seen status.">
        <Row icon={<TgIcon name="restrict" size={24} />} label="Block User" accent onClick={() => setPicking(true)} />
      </Section>

      {list.length > 0 && (
        <Section>
          {list.map((b) => (
            <EntryRow
              key={b.id}
              left={<UserAvatar id={b.id} name={getUserTitle(b)} photoId={getPeerPhotoId(b.photo) || undefined} />}
              title={getUserTitle(b)}
              sub={b.username ? `@${b.username}` : b.phone || undefined}
              onRemove={() => void unblock(b.id)}
            />
          ))}
        </Section>
      )}
      {loaded && list.length === 0 && (
        <Text size={14} color="var(--secondary-text-color)" style={{ paddingLeft: '24px', paddingRight: '24px' }}>
          {t('BlockedEmptyDescription')}
        </Text>
      )}

    </SettingsScreen>
  )
}
