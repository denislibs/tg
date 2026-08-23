// src/core/realtime/updateCatalog.ts
//
// Маршрутизация кадров-АПДЕЙТОВ по конструктору.
//
// Раньше вид кадра выражала строка `t` в конверте, и клиент ветвился по ней —
// каталог имён был источником правды о типах. В схеме кадр это конструктор
// объединения `Update`: тип выражен числовым id, а «конверт» существует только
// как контейнер пачки. Ветвление идёт по дискриминатору `_`, ровно как во всём
// остальном портированном коде (`switch(entity._)`, `thumbs.find(t => t._ ===
// 'photoPathSize')`) и ровно как у оригинала, где `apiUpdatesManager` —
// эмиттер ПО ИМЕНАМ КОНСТРУКТОРОВ (`this.dispatchEvent(update._, update)`,
// apiUpdatesManager.ts:666-669).
//
// Полнота держится типом: `UPDATE_RT` объявлен `satisfies
// Record<UpdatePredicate, string>`, а `UpdatePredicate` выведен из объединения
// `Update` (events.ts). Забытый конструктор — ошибка компиляции, а не молча
// проигнорированный кадр. Совпадение этого набора с тем, что ПРОИЗВОДИТ
// бэкенд, проверяется отдельно — `updateCatalog.test.ts` читает объявление
// домена.

import { RT, type Update, type UpdatePredicate } from './events'
import { getPeerId } from '../peers/peerId'

/** Конструктор → имя события, которым кадр уезжает на вкладки. */
export const UPDATE_RT = {
  // Сообщение: два конструктора, одно событие — различает их курсор, а не предмет.
  updateNewMessage: RT.newMessage,
  updateNewChannelMessage: RT.newMessage,
  updateEditMessage: RT.editMessage,
  updateDeletePeerMessages: RT.deleteMessage,
  updatePinnedMessages: RT.pinMessage,
  // Прочтение: «прочитал я» и «прочитали меня» — РАЗНЫЕ конструкторы, и
  // получатель больше не выводит «чьё это» сравнением user_id с собой.
  updateReadHistoryInbox: RT.read,
  updateReadHistoryOutbox: RT.read,
  updateReadPeerMessagesContents: RT.mediaRead,
  updateMessageReactions: RT.reaction,
  updateMessageFactCheck: RT.factCheckUpdate,
  updateMessageWebPage: RT.webPageUpdate,
  updateMessagePoll: RT.pollUpdate,
  updateMessageToDo: RT.checklistUpdate,
  updateMessageGiveaway: RT.giveawayUpdate,
  updateMessageExtendedMedia: RT.paidMediaUnlock,
  updateDraftMessage: RT.draftUpdate,
  updateDialogPinned: RT.dialogPin,
  updateFolderPeers: RT.dialogArchive,
  updateNotifySettings: RT.dialogMute,
  updateChatRemoved: RT.chatRemoved,
  updateChatTheme: RT.chatThemeUpdate,
  updateChatFullSnapshot: RT.chatUpdate,
  updateChannelFullSnapshot: RT.chatUpdate,
  updateChannelBoostStatus: RT.boostUpdate,
  updateStarsBalance: RT.balanceUpdate,
  updateUserSnapshot: RT.userUpdate,
  // Ниже — кадры БЕЗ курсора. Прежде они лежали в отдельном списке
  // «эфемерных», и список этот был рукописным. Теперь деления нет: несёт кадр
  // курсор или нет, решает СТРУКТУРА конструктора (у updateUserTyping и
  // updateUserStatus параметра pts нет вовсе), а воронка гейтит только то, у
  // чего курсор есть.
  updateUserTyping: RT.typing,
  updateChannelUserTyping: RT.typing,
  updateUserStatus: RT.presence,
  updateBotCallbackAnswer: RT.botCallbackAnswer,
  // История: один конструктор на «появилась» и «исчезла» — различает их выбор
  // ВНУТРИ кадра, а не имя кадра, как было у пары story_new/story_deleted.
  updateStory: RT.story,
  updateSentStoryReaction: RT.storyReaction,
} as const satisfies Record<UpdatePredicate, string>

/**
 * Кадры, чей `pts` — пер-КАНАЛЬНЫЙ.
 *
 * Своего имени у канального курсора в схеме нет: `pts` у
 * `updateNewChannelMessage` — обычный pts, а канальный он потому, что таков
 * КОНСТРУКТОР. Прежде вид курсора решало имя ключа (`channel_pts` против
 * `pts`) — второе имя одного и того же поля.
 */
export const CHANNEL_CURSOR: ReadonlySet<string> = new Set<UpdatePredicate>([
  'updateNewChannelMessage',
  'updateChannelFullSnapshot',
  'updateChannelBoostStatus',
])

/** Дискриминатор кадра, если он есть (кадры без конструктора его не несут). */
export function updatePredicate(d: unknown): UpdatePredicate | undefined {
  const tag = (d as { _?: string } | null | undefined)?._
  return tag && tag in UPDATE_RT ? (tag as UpdatePredicate) : undefined
}

/**
 * Ключ маршрутизации кадра.
 *
 * У кадра с конструктором это сам ДИСКРИМИНАТОР. Тип конверта остаётся
 * запасным ответом ровно для одного кадра — `folder_update`: предмета папки в
 * нашей модели ещё нет (задача #51: `dialogFilter` схемы несёт
 * `title:TextWithEntities` и `include_peers:Vector<InputPeer>`), а курсор кадр
 * несёт и переживать догон обязан. Запасной ответ умрёт вместе с этой задачей.
 */
export function frameKey(type: string, d: unknown): string {
  return updatePredicate(d) ?? type
}

/**
 * Ключ канала у кадра с пер-канальным курсором.
 *
 * Пир лежит в РАЗНЫХ местах, и это не небрежность: кадр с сообщением несёт его
 * ВНУТРИ конструктора сообщения (`message.peer_id` — там это параметр самого
 * сообщения), а кадр метаданных сообщения не несёт вовсе и держит пир своим
 * параметром `peer`.
 */
export function channelPeerId(u: Update): number | undefined {
  if (u._ === 'updateNewChannelMessage') {
    return u.message.peer_id !== undefined ? getPeerId(u.message.peer_id) : undefined
  }
  if (u._ === 'updateChannelFullSnapshot' || u._ === 'updateChannelBoostStatus') {
    return getPeerId(u.peer)
  }
  return undefined
}
