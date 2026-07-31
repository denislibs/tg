import { useManagers } from './useManagers'
import { useChatsStore } from '../../stores/chatsStore'

// Per-chat mute как в tweb PeerProfile: checked = !muted, переключение —
// togglePeerMute напрямую (без попапа длительности). Оптимистично пишем в стор,
// откатываем на ошибке. Общий для UserInfoPanel и EditContactView (одинаковая
// «Notifications»-строка в обоих).
export function useMuteToggle(chatId: number, fallbackMuted?: boolean): { muted: boolean; toggle: () => void } {
  const managers = useManagers()
  const setDialogMuted = useChatsStore((st) => st.setDialogMuted)
  const dialogMuted = useChatsStore((st) => st.dialogs.find((d) => d.chatId === chatId)?.muted)
  const muted = dialogMuted ?? !!fallbackMuted
  const toggle = () => {
    const next = !muted
    setDialogMuted(chatId, next) // оптимистично
    void managers.groups.setMute(chatId, next).catch(() => setDialogMuted(chatId, !next))
  }
  return { muted, toggle }
}
