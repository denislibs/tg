// BlockedUsers — чёрный список (tweb AppBlockedUsersTab): реальный список с
// бэка, добавление через пикер («Block user...»), разблокировка крестиком.
import { useCallback, useEffect, useState } from 'react'
import { AnimatePresence } from 'framer-motion'
import TgIcon from '../TgIcon'
import UserAvatar from '../UserAvatar'
import Text from '../../shared/ui/Text'
import { useT } from '../../i18n'
import { useManagers } from '../../core/hooks/useManagers'
import { usePrivacyStore } from '../../stores/privacyStore'
import { SettingsScreen, Section, Row, EntryRow } from './kit'
import PrivacyUserPicker from './PrivacyUserPicker'
import type { BlockedUser } from '../../core/managers/privacyManager'

export default function BlockedUsers({ onBack }: { onBack: () => void }) {
  const t = useT()
  const managers = useManagers()
  const setBlockedTotal = usePrivacyStore((s) => s.setBlockedTotal)
  const [list, setList] = useState<BlockedUser[]>([])
  const [loaded, setLoaded] = useState(false)
  const [picking, setPicking] = useState(false)

  const reload = useCallback(async () => {
    try {
      const res = await managers.privacy.blocked(0, 100)
      setList(res.users)
      setBlockedTotal(res.total)
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
    setList((l) => l.filter((x) => x.userId !== userId)) // оптимистично
    await managers.privacy.unblock(userId).catch(() => {})
    void reload()
  }

  return (
    <SettingsScreen title="Blocked Users" onBack={onBack}>
      <Section footer="Blocked users can't send you messages or add you to groups. They will not see your profile photos, online and last seen status.">
        <Row icon={<TgIcon name="restrict" size={24} />} label="Block User" accent onClick={() => setPicking(true)} />
      </Section>

      {list.length > 0 && (
        <Section>
          {list.map((b) => (
            <EntryRow
              key={b.userId}
              left={<UserAvatar id={b.userId} name={b.displayName || b.username} avatarUrl={b.avatarUrl || undefined} />}
              title={b.displayName || b.username}
              sub={b.username ? `@${b.username}` : b.phone || undefined}
              onRemove={() => void unblock(b.userId)}
            />
          ))}
        </Section>
      )}
      {loaded && list.length === 0 && (
        <Text size={14} color="var(--tg-textSecondary)" style={{ paddingLeft: '24px', paddingRight: '24px' }}>
          {t("You haven't blocked anyone.")}
        </Text>
      )}

      <AnimatePresence>
        {picking && (
          <PrivacyUserPicker
            title="Blocked Users"
            placeholder="Block user..."
            multi={false}
            onPick={(id) => void block(id)}
            onBack={() => setPicking(false)}
          />
        )}
      </AnimatePresence>
    </SettingsScreen>
  )
}
