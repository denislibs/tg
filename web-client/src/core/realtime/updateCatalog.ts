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
  // Их канальные близнецы (журнал broadcast-канала). Наружу они не уходят:
  // воркер приводит их к пер-юзерному конструктору (channelTwin) ДО рассылки,
  // так что события здесь — те же, что у пары, и строки нужны лишь полноте.
  updateEditChannelMessage: RT.editMessage,
  updateDeleteChannelMessages: RT.deleteMessage,
  updatePinnedChannelMessages: RT.pinMessage,
  updateChannel: RT.channel,
  // Только в разнице и только состоянию канала: наружу не уходит (см. RT).
  updateChannelTooLong: RT.channelTooLong,
  // Прочтение: «прочитал я» и «прочитали меня» — РАЗНЫЕ конструкторы, и
  // получатель больше не выводит «чьё это» сравнением user_id с собой.
  updateReadHistoryInbox: RT.read,
  updateReadHistoryOutbox: RT.read,
  updateReadPeerMessagesContents: RT.mediaRead,
  updateMessageReactions: RT.reaction,
  // Счётчики поста канала. Курсора у обоих нет (см. CHANNEL_CURSOR ниже), но в
  // реестре они на общих основаниях: воронка гейтит по числу, а его отсутствие
  // — тоже ответ.
  updateChannelMessageViews: RT.viewsUpdate,
  updateChannelMessageReplies: RT.repliesUpdate,
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
  // Участники и заявки — пер-юзерный журнал (курсор в конверте). Заявки
  // уезжают на вкладки ПЕРЕЛОЖЕННЫМИ (`ChatRequestsEvt`, как tweb `chat_requests`):
  // перекладку делает владелец в `workerCore.ts::dispatch`.
  updateChannelParticipant: RT.chatParticipant,
  updatePendingJoinRequests: RT.chatRequests,
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
  updateReadStories: RT.storyRead,
} as const satisfies Record<UpdatePredicate, string>

/**
 * Кадры, чей `pts` — пер-КАНАЛЬНЫЙ.
 *
 * Своего имени у канального курсора в схеме нет: `pts` у
 * `updateNewChannelMessage` — обычный pts, а канальный он потому, что таков
 * КОНСТРУКТОР. Прежде вид курсора решало имя ключа (`channel_pts` против
 * `pts`) — второе имя одного и того же поля.
 *
 * `updateChannelMessageViews`/`updateChannelMessageReplies` сюда НЕ входят,
 * хотя канальные по имени: курсора у них нет вовсе — счётчики приближённы, и
 * догонять их разрывом незачем (авторитетное значение приезжает внутри самого
 * сообщения со страницей истории). Набор здесь — не «кадры канала», а «кадры,
 * чей pts канальный»; попади они сюда, `channelPeerId` вернул бы `undefined`,
 * и развилка в `workerCore.ts::onFrame` всё равно пропустила бы их дальше
 * (там канальная ветка требует ЧИСЛА и в `peerId`, и в `pts`) — то есть строка
 * была бы неверной и при этом безвредной, а таких не заводим.
 */
export const CHANNEL_CURSOR: ReadonlySet<string> = new Set<UpdatePredicate>([
  'updateNewChannelMessage',
  'updateEditChannelMessage',
  'updateDeleteChannelMessages',
  'updatePinnedChannelMessages',
  'updateChannelFullSnapshot',
  'updateChannelBoostStatus',
])

/**
 * Канальный близнец → пер-юзерный конструктор того же предмета.
 *
 * У оригинала обе пары разбирает ОДИН обработчик (`onUpdateEditMessage` на
 * `updateEditMessage`/`updateEditChannelMessage`, `onUpdateDeleteMessages` на
 * `updateDeleteMessages`/`updateDeleteChannelMessages`): различает их только
 * курсор, а его к этому месту уже применила канальная воронка. Поэтому кадр
 * переводится в форму пары и дальше идёт её путём. У канального удаления и
 * закрепления канал назван `channel_id` — у пары это `peer`.
 */
export function channelTwin(u: Update): Update | undefined {
  switch (u._) {
    case 'updateEditChannelMessage':
      return { ...u, _: 'updateEditMessage' }
    case 'updateDeleteChannelMessages':
      return {
        _: 'updateDeletePeerMessages', peer: { _: 'peerChannel', channel_id: u.channel_id },
        messages: u.messages, pts: u.pts,
      }
    case 'updatePinnedChannelMessages':
      return {
        _: 'updatePinnedMessages', ...(u.pFlags ? { pFlags: u.pFlags } : {}),
        peer: { _: 'peerChannel', channel_id: u.channel_id }, messages: u.messages, pts: u.pts,
      }
    default:
      return undefined
  }
}

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
  if (u._ === 'updateNewChannelMessage' || u._ === 'updateEditChannelMessage') {
    return u.message.peer_id !== undefined ? getPeerId(u.message.peer_id) : undefined
  }
  if (u._ === 'updateDeleteChannelMessages' || u._ === 'updatePinnedChannelMessages') {
    return getPeerId({ _: 'peerChannel', channel_id: u.channel_id })
  }
  if (u._ === 'updateChannelFullSnapshot' || u._ === 'updateChannelBoostStatus') {
    return getPeerId(u.peer)
  }
  return undefined
}

/**
 * Дата апдейта для `updatesState.date` — у оригинала её несёт контейнер
 * (`updates.date`, tweb apiUpdatesManager.ts:736-738 и :774-776). Наш живой
 * кадр контейнера с датой не несёт, поэтому датой служит время самого
 * события: у кадра с сообщением — его `edit_date` либо `date`. У прочих кадров
 * даты нет, и дата состояния ими не двигается.
 */
export function updateDate(d: unknown): number | undefined {
  const m = (d as { message?: { date?: number; edit_date?: number } } | null | undefined)?.message
  if (!m || typeof m.date !== 'number') return undefined
  return Math.max(m.date, m.edit_date ?? 0)
}
