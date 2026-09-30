import { useI18nStore } from '../../i18n'
import type { LangPackKey } from '../../lang'
import { useSecretChatStore } from '../../stores/secretChatStore'
import { useManagers } from './useManagers'
import { toPeerId } from '../peers/peerId'
import type { GroupPhoto } from '../../components/NewGroupFlow'

// Команды создания чатов из compose-меню сайдбара (порт tweb createChat/createChannel
// + наш secret-handshake). Read/command-путь через managers — по инварианту слоёв
// (вниз: View → хук → managers → сервер). Открытие созданного чата — через
// onChatCreated (навигация живёт в родителе/navigationStore, не тут).
export function useSidebarActions(onChatCreated?: (peerId: PeerId) => void) {
  const managers = useManagers()
  // Название по умолчанию уезжает НА СЕРВЕР данными, а не рисуется: сюда нужен ТЕКСТ
  // на языке пользователя, а не символический ключ (иначе группа так и называется
  // «NewGroup» у всех, кто её увидит). Ключ — СВОЙ (`*.DefaultTitle`), а не тот, что
  // подписывает пункт меню: по-русски пункт меню это «Создать группу», и группа без
  // имени называлась бы так у всех участников.
  //
  // Язык читается СНИМКОМ В МОМЕНТ ВЫЗОВА, а не на рендере: подписки тут не нужно
  // (ничего не рисуется), но и застревать на языке, который стоял при монтировании,
  // нельзя — язык меняется на лету (задача 8), и пользователь мог сменить его до
  // нажатия «Создать».
  const t = (key: LangPackKey) => useI18nStore.getState().t(key)

  const createGroup = async (name: string, memberIds: number[], photo: GroupPhoto | null) => {
    const { chatId } = await managers.groups.createChat(name || t('NewGroup.DefaultTitle'), memberIds)
    const peerId = toPeerId(chatId, true)
    // Фото — после создания, как tweb (createChat → editPhoto): upload → set.
    if (photo) {
      const bytes = await photo.blob.arrayBuffer()
      const mediaId = await managers.media.upload({ bytes, mime: 'image/jpeg', size: photo.blob.size, width: photo.width, height: photo.height })
      await managers.groups.setPhoto(peerId, mediaId)
    }
    onChatCreated?.(peerId) // setDraftPeer(null) + setSelectedId + loadChats
  }

  const createChannel = async (name: string, description: string) => {
    const peerId = await managers.channels.createChannel({ title: name || t('NewChannel.DefaultTitle'), about: description })
    onChatCreated?.(peerId)
  }

  // «Секретный чат» (наша фича): выбор контакта → E2E-handshake managers.secret.start,
  // затем открыть созданный чат в статусе «ожидание». Контакт берётся из
  // адресной книги (`NewPrivateChat`), и личного диалога с ним может не быть —
  // поэтому собеседник адресуется ключом пользователя, а не строкой списка.
  const startSecret = async (userId: PeerId) => {
    const { peerId } = await managers.secret.start(userId)
    useSecretChatStore.getState().setStatus(peerId, 'awaiting')
    onChatCreated?.(peerId)
  }

  return { createGroup, createChannel, startSecret }
}
