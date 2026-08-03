import { useSecretChatStore } from '../../stores/secretChatStore'
import { useManagers } from './useManagers'
import type { Chat } from '../../data'
import type { GroupPhoto } from '../../components/NewGroupFlow'

// Команды создания чатов из compose-меню сайдбара (порт tweb createChat/createChannel
// + наш secret-handshake). Read/command-путь через managers — по инварианту слоёв
// (вниз: View → хук → managers → сервер). Открытие созданного чата — через
// onChatCreated (навигация живёт в родителе/navigationStore, не тут).
export function useSidebarActions(chats: Chat[], onChatCreated?: (chatId: number) => void) {
  const managers = useManagers()

  const createGroup = async (name: string, memberIds: number[], photo: GroupPhoto | null) => {
    const chatId = await managers.groups.createGroup({ title: name || 'New Group', memberIds })
    // Фото — после создания, как tweb (createChat → editPhoto): upload → set.
    if (photo) {
      const bytes = await photo.blob.arrayBuffer()
      const mediaId = await managers.media.upload({ bytes, mime: 'image/jpeg', size: photo.blob.size, width: photo.width, height: photo.height })
      await managers.groups.setPhoto(chatId, mediaId)
    }
    onChatCreated?.(chatId) // setDraftPeer(null) + setSelectedId + loadChats
  }

  const createChannel = async (name: string, description: string) => {
    const chatId = await managers.channels.createChannel({ title: name || 'New Channel', about: description })
    onChatCreated?.(chatId)
  }

  // «Секретный чат» (наша фича): выбор контакта → E2E-handshake managers.secret.start,
  // затем открыть созданный чат в статусе «ожидание».
  const startSecret = async (id: string) => {
    const peerId = chats.find((c) => c.id === id)?.peerId
    if (peerId == null) return
    const { chatId } = await managers.secret.start(peerId)
    useSecretChatStore.getState().setStatus(chatId, 'awaiting')
    onChatCreated?.(chatId)
  }

  return { createGroup, createChannel, startSecret }
}
