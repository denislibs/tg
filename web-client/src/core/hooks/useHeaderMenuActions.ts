import { useEffect, useState } from 'react'
import { useManagers } from './useManagers'
import { usePrivacyStore } from '../../stores/privacyStore'

// Managers-действия ⋮-меню чата (tweb topbar): статус блокировки собеседника +
// её переключение (private), и per-chat автоудаление (messages.setHistoryTTL).
// Read/command-путь; после команд закрываем меню через переданный close.
export function useHeaderMenuActions(args: {
  peerId: number | null | undefined
  canBlock: boolean
  chatId: number
  close: () => void
}): {
  blocked: boolean
  toggleBlock: () => void
  setChatTtl: (period: number) => void
} {
  const { peerId, canBlock, chatId, close } = args
  const managers = useManagers()
  const [blocked, setBlocked] = useState(false)

  useEffect(() => {
    if (!canBlock || peerId == null) return
    let alive = true
    void managers.privacy.profile(peerId).then((p) => { if (alive) setBlocked(p.isBlocked) }).catch(() => {})
    return () => { alive = false }
  }, [canBlock, peerId, managers])

  const toggleBlock = () => {
    if (peerId == null) return
    void (blocked ? managers.privacy.unblock(peerId) : managers.privacy.block(peerId))
      .then(() => managers.privacy.blocked(0, 1))
      .then((r) => usePrivacyStore.getState().setBlockedTotal(r.total))
      .catch(() => {})
    close()
  }

  const setChatTtl = (period: number) => {
    if (Number.isFinite(chatId)) {
      void managers.privacy.setChatAutoDelete(chatId, period).then(() => managers.dialogs.refresh()).catch(() => {})
    }
    close()
  }

  return { blocked, toggleBlock, setChatTtl }
}
