import { useEffect, useState } from 'react'
import { useManagers } from './useManagers'
import { usePrivacyStore } from '../../stores/privacyStore'

// Managers-действия ⋮-меню чата (tweb topbar): статус блокировки собеседника +
// её переключение (private), и per-chat автоудаление (messages.setHistoryTTL).
// Read/command-путь; после команд закрываем меню через переданный close.
// Ключ ОДИН. Прежде здесь лежала пара «id собеседника + id чата», и у
// приватного диалога это было одно и то же число, записанное дважды: ключ
// приватного разговора И ЕСТЬ id собеседника. Блокировка ходит по нему же
// (`canBlock` истинен только у приватного), автоудаление — по нему же как по
// ключу чата.
export function useHeaderMenuActions(args: {
  peerId: PeerId
  canBlock: boolean
  close: () => void
}): {
  blocked: boolean
  toggleBlock: () => void
  setChatTtl: (period: number) => void
} {
  const { peerId, canBlock, close } = args
  const managers = useManagers()
  const [blocked, setBlocked] = useState(false)

  useEffect(() => {
    if (!canBlock) return
    let alive = true
    // «Заблокирован» — флаг ПОЛНОЙ формы (`userFull.pFlags.blocked`), а не поле
    // ответа рядом с ней.
    void managers.privacy.profile(peerId).then((p) => { if (alive) setBlocked(!!p.fullUser.pFlags?.blocked) }).catch(() => {})
    return () => { alive = false }
  }, [canBlock, peerId, managers])

  const toggleBlock = () => {
    void (blocked ? managers.privacy.unblock(peerId) : managers.privacy.block(peerId))
      .then(() => managers.privacy.blocked(0, 1))
      .then((r) => usePrivacyStore.getState().setBlockedTotal(r.count))
      .catch(() => {})
    close()
  }

  const setChatTtl = (period: number) => {
    if (Number.isFinite(peerId)) {
      void managers.privacy.setChatAutoDelete(peerId, period).then(() => managers.dialogs.refresh()).catch(() => {})
    }
    close()
  }

  return { blocked, toggleBlock, setChatTtl }
}
