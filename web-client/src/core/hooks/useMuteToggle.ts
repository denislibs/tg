import { useManagers } from './useManagers'
import { useChatsStore } from '../../stores/chatsStore'

// Per-chat mute как в tweb PeerProfile: checked = !muted, переключение —
// togglePeerMute напрямую (без попапа длительности). Общий для UserInfoPanel и
// EditContactView (одинаковая «Notifications»-строка в обоих). Task 4 (действия
// без оптимистики): оптимистики нет — локальный апдейт применяет владелец
// (dialogsManager.applyMute) ПОСЛЕ успешного REST-ответа (groupsManager.ts).
export function useMuteToggle(peerId: PeerId, fallbackMuted?: boolean): { muted: boolean; toggle: () => void } {
  const managers = useManagers()
  const dialogMuted = useChatsStore((st) => st.dialogs.find((d) => d.peerId === peerId)?.muted)
  const muted = dialogMuted ?? !!fallbackMuted
  const toggle = () => {
    void managers.groups.setMute(peerId, !muted).catch(() => {})
  }
  return { muted, toggle }
}
