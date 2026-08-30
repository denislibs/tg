import { useSecretChatStore } from '../../stores/secretChatStore'
import { useManagers } from './useManagers'
import type { Chat } from '../../data'
import type { GroupPhoto } from '../../components/NewGroupFlow'

// Команды создания чатов из compose-меню сайдбара (порт tweb createChat/createChannel
// + наш secret-handshake). Read/command-путь через managers — по инварианту слоёв
// (вниз: View → хук → managers → сервер). Открытие созданного чата — через
// onChatCreated (навигация живёт в родителе/navigationStore, не тут).
export function useSidebarActions(chats: Chat[], onChatCreated?: (peerId: PeerId) => void) {
  const managers = useManagers()

  const createGroup = async (name: string, memberIds: number[], photo: GroupPhoto | null) => {
    const peerId = await managers.groups.createGroup({ title: name || 'NewGroup', memberIds })
    // Фото — после создания, как tweb (createChat → editPhoto): upload → set.
    if (photo) {
      const bytes = await photo.blob.arrayBuffer()
      const mediaId = await managers.media.upload({ bytes, mime: 'image/jpeg', size: photo.blob.size, width: photo.width, height: photo.height })
      await managers.groups.setPhoto(peerId, mediaId)
    }
    onChatCreated?.(peerId) // setDraftPeer(null) + setSelectedId + loadChats
  }

  const createChannel = async (name: string, description: string) => {
    const peerId = await managers.channels.createChannel({ title: name || 'NewChannel', about: description })
    onChatCreated?.(peerId)
  }

  // «Секретный чат» (наша фича): выбор контакта → E2E-handshake managers.secret.start,
  // затем открыть созданный чат в статусе «ожидание».
  const startSecret = async (id: string) => {
    // Ключ пира И ЕСТЬ id строки списка (`Chat.id` — знаковый ключ строкой):
    // отдельного поля «собеседник» рядом больше нет.
    const target = chats.find((c) => c.id === id)
    if (!target) return
    const { peerId } = await managers.secret.start(Number(target.id))
    useSecretChatStore.getState().setStatus(peerId, 'awaiting')
    onChatCreated?.(peerId)
  }

  return { createGroup, createChannel, startSecret }
}
