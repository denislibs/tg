import { useManagers } from './useManagers'
import { useChatsStore } from '../../stores/chatsStore'
import { isPeerMuted } from '../dialogs/notifySettings'

// Per-chat mute как в tweb PeerProfile: checked = !muted, переключение —
// togglePeerMute напрямую (без попапа длительности). Общий для UserInfoPanel и
// EditContactView (одинаковая «Notifications»-строка в обоих). Task 4 (действия
// без оптимистики): оптимистики нет — локальный апдейт применяет владелец
// (dialogsManager.applyMute) ПОСЛЕ успешного REST-ответа (groupsManager.ts).
export function useMuteToggle(peerId: PeerId, fallbackMuted?: boolean): { muted: boolean; toggle: () => void } {
  const managers = useManagers()
  // Мьют — СРОК: «замьючен сейчас» вычисляется предикатом, а не читается полем
  // (порт `appNotificationsManager.isMuted`).
  const notify = useChatsStore((st) => st.dialogs.find((d) => d.peerId === peerId)?.notify_settings)
  const muted = notify ? isPeerMuted(notify, Math.floor(Date.now() / 1000)) : !!fallbackMuted
  const toggle = () => {
    void managers.groups.setMute(peerId, !muted).catch(() => {})
  }
  return { muted, toggle }
}
