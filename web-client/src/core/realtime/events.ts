// src/core/realtime/events.ts
import type { MessageEntity, RawMessage, RawMyMessage, MessageReactions, Reaction } from '../models'
import type { MessageMedia, MessageMediaWebPage, MyDocument } from '../media/messageMedia'
import type { MessagesChatFull, UserReal, UserStatus } from '../peers/peer'
import type { PeerNotifySettings } from '../dialogs/notifySettings'
import type { StoryItem } from '../stories/story'
import type { Peer } from '../peers/peerId'
import type { ChannelParticipantWire, ChatInviteExported } from '../managers/groupsManager'
import type { StickerPack, StickerSet } from '../managers/stickersManager'
// Worker -> UI event names (over SuperMessagePort.emit). Live frames AND difference
// catch-up both surface through these, so the UI handles them uniformly.
export const RT = {
  newMessage: 'rt:new_message',
  // Stage 1B.2 (Task 3): операции над окнами сообщений (MessageOp[]) — порождает
  // ТОЛЬКО воркер (cacheLive), рассылается в ДОПОЛНЕНИЕ к rt:new_message. Проектор
  // переигрывает их поверх стора вместо разбора сырого кадра (Task 4).
  messageOp: 'rt:message_op',
  // Счёт истории окна (`historyStorage.count` оригинала) — ЗНАЧЕНИЕ от
  // владельца `messagesManager` (ответ истории / новое / удалённое), зеркало —
  // `core/history/messagesMirror.ts::mirrorHistoryCount`. Читает шапка
  // «Избранного» («N messages», tweb topbar.ts `messagesCounter`).
  historyCount: 'rt:history_count',
  editMessage: 'rt:edit_message',
  deleteMessage: 'rt:delete_message',
  pinMessage: 'rt:pin_message',
  read: 'rt:read',
  mediaRead: 'rt:media_read',
  typing: 'rt:typing',
  presence: 'rt:presence',
  reaction: 'rt:reaction',
  // Просмотры поста канала — конструктор схемы `updateChannelMessageViews`
  // (tweb appMessagesManager.ts:8448-8459). Тред поста своего кадра не имеет:
  // пост перечитывается (`messages.updateMessage`, :11923-11937).
  viewsUpdate: 'rt:views_update',
  ack: 'rt:ack',
  messageError: 'rt:message_error',
  // Пяти событий rt:pending_* больше нет: жизненный цикл неотправленного
  // сообщения переехал в менеджер воркера (core/managers/messages/pending.ts),
  // и наружу он объявляет только MessageOp (rt:message_op) — «бабл появился» это
  // insert, «доехал ack» — insert финального, «ошибка» — patch {failed}, «отмена»
  // — remove. Окно правит ТОЛЬКО applyOps, исключений больше нет.
  call: 'rt:call',
  chatRemoved: 'rt:chat_removed',
  // Пользователь вступил в broadcast-канал (`updateChannel`): строку диалога
  // заводит владелец списка (dialogsManager.applyChannel) — витрине кадр
  // только транслируется.
  channel: 'rt:channel',
  // `updateChannelTooLong` — канал сдвинулся, пока сокета не было (приходит в
  // other_updates разницы). Вкладкам не рассылается: его применяет состояние
  // канала в воркере (tweb processUpdate :658-662 → getChannelDifference),
  // имя нужно лишь полноте реестра.
  channelTooLong: 'rt:channel_too_long',
  // `updateNewScheduledMessage`/`updateDeleteScheduledMessages` — лента
  // отложенных. Сырым кадром вкладкам не рассылаются: их применяет владелец
  // хранилища отложенных (`messagesManager`), наружу уходят события оригинала
  // `scheduled_new`/`scheduled_delete`/`message_edit` (tweb :11773-11815); имя
  // нужно лишь полноте реестра.
  scheduled: 'rt:scheduled',
  draftUpdate: 'rt:draft_update',
  chatThemeUpdate: 'rt:chat_theme_update',
  dialogPin: 'rt:dialog_pin',
  dialogArchive: 'rt:dialog_archive',
  // Клиентский кросс-таб-эхо REST-мутации mute (у бэка WS-эха mute нет): воркер
  // ретранслирует его всем вкладкам после успешного /mute — см. groupsManager.
  dialogMute: 'rt:dialog_mute',
  // Метаданные чата (title/photo/настройки/права/подписи) — абсолютный снапшот,
  // сервер шлёт участникам (logged, pts). Клиент рефетчит список диалогов + карточку.
  chatUpdate: 'rt:chat_update',
  // Состав или права участника изменились — tweb `rootScope` `chat_participant`
  // (`appChatsManager.onUpdateChannelParticipant`, :1419-1422). Полезная нагрузка —
  // сам `updateChannelParticipant`; до рассылки воркер сбрасывает кэш страниц
  // участников (`groups.invalidateChannelParticipants`), а вкладка — полную
  // карточку (`client/realtime/refetchSubscriber.ts`).
  chatParticipant: 'rt:chat_participant',
  // Заявки на вступление изменились — tweb `chat_requests`
  // (`appChatInvitesManager.onUpdatePendingJoinRequests`, :24-40): плашка заявок
  // в шапке (`chat/requests.solid.tsx`). Полезная нагрузка — `ChatRequestsEvt`.
  chatRequests: 'rt:chat_requests',
  // Мутация папок с другого устройства/вкладки (create/edit/delete/reorder) —
  // logged, pts. Клиент перечитывает список папок.
  folderUpdate: 'rt:folder_update',
  // Порядок папок сменился на другом устройстве/вкладке — `updateDialogFilterOrder`
  // (tweb `filters.ts:179-199`, событие `filter_order`). Конструктор схемы с
  // курсором в конверте: идёт общим путём (UPDATE_RT), а не исключением
  // `folder_update`. Применяет `foldersStore.applyOrder`.
  dialogFilterOrder: 'rt:dialog_filter_order',
  // Юзер сменил имя/username/аватар (сервер шлёт участникам общих чатов + своим
  // сессиям). Кадр интерпретирует ВОРКЕР (peersManager.applyUserUpdate) и
  // публикует результат через rt:peer_op ниже — витрина сырой кадр не разбирает.
  userUpdate: 'rt:user_update',
  // Stage 1C.2 (Task 2): карточки пиров — воркерный peersManager единственный
  // владелец. Он же решает, что карточка изменилась, и публикует это ОПЕРАЦИЕЙ
  // (PeerOp: upsert/patch — см. managers/peersManager.ts), а не снимком кэша и
  // не сигналом «сходи перечитай». Два повода, оба про зеркало: витрина объявила
  // пробел (fillMirror) либо изменился сам факт (user_update). Обычные чтения
  // карточек (getUsers) кадров не порождают. Рассылается всем вкладкам: карточка
  // пира — общий факт сессии (avatar_url приватен per-viewer, но зритель у всех
  // вкладок один). core/peerCache.ts зеркалит операции через storeProjection и больше
  // ниоткуда не пишется (пин — stores/noDuplicatePeers.test.ts).
  peerOp: 'rt:peer_op',
  // Stage «владение диалогами» (этап 1): список диалогов — владелец воркерный
  // dialogsManager, витрина только зеркалит. Событие несёт ЗНАЧЕНИЕ с индексом
  // (порт tweb dialogs_multiupdate), а не «перечитай».
  dialogOp: 'rt:dialog_op',
  // Темы форумов — владелец воркерный хранилище тем (`core/managers/
  // forumTopicsStorage.ts`, порт `dialogsStorage.forumTopics`). Событие несёт
  // ОПЕРАЦИИ со значением (`ForumTopicOp`: события хранилища tweb
  // `dialogs_multiupdate`/`dialog_unread`/`dialog_drop`/
  // `dialog_notify_settings` для темы), а не «перечитай список».
  forumTopicOp: 'rt:forum_topic_op',
  // Закреп темы форума — `updatePinnedForumTopic` (tweb dialogs.ts:2480-2490).
  // Применяет хранилище тем, вкладкам уезжает операциями `forumTopicOp`; имя
  // нужно полноте реестра.
  pinnedForumTopic: 'rt:pinned_forum_topic',
  // Прочтение треда (тема форума, тред комментариев) — `updateReadChannelDiscussion
  // Inbox/Outbox` (tweb appMessagesManager.ts:777-778). Применяет `threadReads`
  // воркера, вкладкам темы уезжают операциями `forumTopicOp`, горизонт исходящих
  // треда — `readOutbox`; имя нужно полноте реестра.
  readDiscussion: 'rt:read_discussion',
  // Горизонт исходящих истории сдвинут кадром прочтения — `historyStorage(peerId,
  // threadId).readOutboxMaxId = maxId` (tweb appMessagesManager.ts:10916) и
  // `dialog_unread` (:10950, только при найденном диалоге/теме), по которому лента
  // перекрашивает «✓✓» (bubbles.ts:2318-2326, :4858-4860). Публикуют владельцы:
  // чата — dialogsManager, треда — threadReads. Горизонт ДИАЛОГА (`dialogOp`) ленту
  // не красит: у оригинала поле диалога и хранилище истории — разные вещи (:10920).
  readOutbox: 'rt:read_outbox',
  pollUpdate: 'rt:poll_update',
  checklistUpdate: 'rt:checklist_update',
  boostUpdate: 'rt:boost_update',
  giveawayUpdate: 'rt:giveaway_update',
  suggestedPost: 'rt:suggested_post_update',
  balanceUpdate: 'rt:balance_update',
  // `updateSavedReactionTags` без параметров: теги «Избранного» сменились — у
  // оригинала перечитать их, если они в кэше (appReactionsManager.ts:121-132).
  // Кэша тегов у нас нет (UI тегов не портирован, Б-26), потребителей нет.
  savedReactionTags: 'rt:saved_reaction_tags',
  // Стикеры и GIF своих устройств (f6-stickers). Вкладкам кадр уезжает не этим
  // именем: владелец (`stickersManager`) объявляет события rootScope
  // `stickers_installed`/`stickers_updated`/`gifs_updated` (tweb
  // appStickersManager.ts:80-88, appGifsManager.ts:21-29), как `notify_settings`.
  newStickerSet: 'rt:new_sticker_set',
  recentStickers: 'rt:recent_stickers',
  favedStickers: 'rt:faved_stickers',
  savedGifs: 'rt:saved_gifs',
  paidMediaUnlock: 'rt:paid_media_unlock',
  groupCall: 'rt:group_call',
  livestream: 'rt:livestream',
  botCallbackAnswer: 'rt:bot_callback_answer',
  geoLiveUpdate: 'rt:geo_live_update',
  webPageUpdate: 'rt:web_page_update',
  factCheckUpdate: 'rt:factcheck_update',
  secretRequest: 'rt:secret_chat_request',
  secretAccept: 'rt:secret_chat_accept',
  secretReject: 'rt:secret_chat_reject',
  // История появилась ЛИБО исчезла — ОДНО событие: различает их конструктор
  // внутри кадра (`storyItem` против `storyItemDeleted`), а не имя кадра.
  story: 'rt:story',
  storyReaction: 'rt:story_reaction',
  storyRead: 'rt:story_read',
  // Блок и правило приватности с другого устройства (Ф-6): воркер переводит их в
  // события tweb `peer_block` / `privacy_update` (rootScope.ts:53, :166) и сами не
  // рассылаются: имена нужны только полноте реестра `UPDATE_RT`.
  peerBlocked: 'rt:peer_blocked',
  privacy: 'rt:privacy',
  // Срок автоудаления чата (Ф-6, f6-ttl): воркер переводит кадр в событие tweb
  // `auto_delete_period_update` (rootScope.ts:271) и сам не рассылается: имя
  // нужно только полноте реестра `UPDATE_RT`.
  peerHistoryTTL: 'rt:peer_history_ttl',
  // rt:state / rt:state_synchronizing / rt:state_synchronized — УВЕДОМЛЕНИЯ
  // «что-то изменилось», НЕ источник значения. Значение — всегда через RPC
  // managers.realtime.getStatus() (realtime.ts, докблок метода — там же разбор,
  // что из этой pull-дисциплины 1:1 с tweb, а что наше расширение поверх него;
  // для rt:state — 1:1, connectionStatus.ts:47-51/:87-91). Не читать поля этих
  // событий как факт.
  state: 'rt:state',
  // tweb apiUpdatesManager.ts:460-469 (state_synchronizing/state_synchronized) —
  // начало/конец догона (updates.getDifference), пара для индикатора «Обновление…» в поиске
  // (порт ConnectionStatusComponent, Задача 1). syncEngine.getDifference() гарантирует
  // парность: «конец» уходит и по успеху, и по ошибке catch-up'а (сознательное
  // расхождение с tweb — см. докблок onSyncEnd в syncEngine.ts).
  stateSynchronizing: 'rt:state_synchronizing',
  stateSynchronized: 'rt:state_synchronized',
  // Stage 1C.2 (Task 1): текущий пользователь — воркер единственный владелец
  // (workerCore.ts::setMe). Публикуется на старте (tokens.ready → auth.me) и
  // после каждой RPC-мутации профиля/премиума/логаута; payload — полный
  // User | null (null — разлогинен). storeProjection зеркалит в chatsStore.setMe.
  // Это канал ЗНАЧЕНИЯ, а не намерения: по нему нельзя отличить «сменили
  // аккаунт» от «вышли» — для этого есть rt:logging_out ниже.
  me: 'rt:me',
  // Stage 1C.2 (Task 1, раунд 4): НАМЕРЕНИЕ перехода активной сессии. Порт
  // tweb `logging_out` (`lib/rootScope.ts:191` — `{accountNumber?,
  // migrateTo?}`, шлёт `appManagers/apiManager.ts:335`, принимает
  // `apiManagerProxy.ts:508` → `onLoggedOut`): владелец сессии сам объявляет,
  // ЧТО происходит, а вкладки не выводят это из снимка пользователя.
  // `migrateTo` — id аккаунта, на который переехала активная сессия (у tweb —
  // номер слота 1..4, у нас id пользователя), `null` — активного аккаунта не
  // осталось (логаут, удаление последнего, «добавить аккаунт», отозванная
  // сессия). Публикует authManager (единственный владелец активного токена),
  // рассылает workerCore всем вкладкам, включая инициатора.
  loggingOut: 'rt:logging_out',
  // Второй, симметричный кадр того же владельца — порт tweb `account_logged_in`
  // (`lib/rootScope.ts:211` — `{accountNumber, userId}`, шлёт
  // `appManagers/apiManagerMethods.ts:78` из `setUser()`, тоже общий для всех
  // вкладок: `apiManagerProxy.ts:332` в commonEventNames). Публикует
  // authManager из persist() — единой точки всех семи путей входа. `userId` —
  // кто вошёл; реакция вкладки по нему НЕ разветвляется: любой успешный вход
  // выдаёт НОВЫЙ активный токен, включая повторный вход того же пользователя,
  // так что переход одинаков в любом случае (см. useAuthGate).
  loggedIn: 'rt:logged_in',
  // Stage 1C.2 (Task 3): короткоживущий медиа-токен — воркер единственный
  // владелец (core/managers/mediaManager.ts). Публикуется при КАЖДОМ получении
  // токена — и на ленивом первом запросе, и на плановом обновлении за минуту до
  // истечения; payload — MediaTokenInfo. storeProjection зеркалит его в
  // core/mediaUrl.ts, откуда медиа-баблы синхронно собирают <img src>.
  // Прямого аналога в tweb нет: там медиа тянутся байтами через appDownloadManager,
  // а не URL'ом с токеном, — это наше расширение, не порт.
  mediaToken: 'rt:media_token',
  // Task 6 (медиа-суперпорт, стадия C): objectURL скачанного медиа — воркер
  // единственный владелец (mediaManager::downloadMediaURL: кэш-контекст →
  // корзина CacheStorage → байты → URL.createObjectURL в воркере; модель tweb
  // apiFileManager.downloadMediaURL + зеркалирование storages/thumbs.ts).
  // Публикуется при каждом СОЗДАНИИ URL (попадание в контекст кадра не
  // порождает — вкладкам он уже объявлен); payload — MediaUrlEvt. Витрина
  // зеркалит в core/mediaCache.ts (cachedMediaUrl) через storeProjection;
  // поздняя вкладка получает URL ответом самого RPC downloadMediaURL
  // (пробел объявляет зеркало — Task 7 переведёт потребителей).
  mediaUrl: 'rt:media_url',
} as const

export type ConnState = 'connecting' | 'ready' | 'reconnecting' | 'offline'

/**
 * Кадр с новым сообщением — форма `updateNewMessage` схемы: сообщение ЦЕЛИКОМ
 * лежит под ключом `message`, а `pts` рядом с ним.
 *
 * Прежде поля сообщения лежали вперемешку с полями конверта (`msg_id`, `seq`,
 * `sender_id`, `type`, `text`, `sender_name`, `client_msg_id`, `grouped_id`,
 * `send_as`, `reply_snapshot_*`, …), и это была ВТОРАЯ проводная форма
 * сообщения, расходившаяся с витриной в обе стороны. Теперь форма одна —
 * решение Р5 разбора.
 *
 * `peer_id` внутри сообщения зависит от ПОЛУЧАТЕЛЯ (у приватного диалога
 * стороны видят разный ключ) и приклеивается сервером на выходе; `pFlags.out`
 * — тоже пер-зритель и приезжает там же.
 */
export interface NewMessageEvt {
  /**
   * ДВА конструктора с одинаковым телом: различает их курсор, который двигает
   * кадр, — общий пер-юзерный у `updateNewMessage`, пер-канальный у
   * `updateNewChannelMessage`. Ровно так же устроена схема, и ровно поэтому
   * тела совпадают: предмет один.
   */
  _: 'updateNewMessage' | 'updateNewChannelMessage'
  message: import('../models').RawMessage
  /** плотный монотонный pts (funnel-дедуп/гейт/gap). */
  pts?: number
}
/** Патч уже нарисованного бабла: правка текста/разметки/клавиатуры. Кадром-
 *  конструктором `Message` он НЕ является — в схеме это `updateEditMessage`,
 *  несущий сообщение целиком, и приведение кадров-патчей к нему принадлежит
 *  подсистеме ОБНОВЛЕНИЙ, а не сообщения (названный остаток шага витрин).
 *
 *  `action` едет здесь потому, что правка служебного сообщения существует ровно
 *  одна — принятие предложенного фото, и меняется в ней только действие. */
/**
 * Правка — `updateEditMessage{message, pts, pts_count}`: сообщение ЦЕЛИКОМ, а
 * не патч полей. Прежде кадр вёз собственный набор (id + текст + сущности +
 * дата + разметка) — вторую проводную форму сообщения.
 */
export interface EditMessageEvt {
  _: 'updateEditMessage'
  message: RawMyMessage
  pts?: number
}
// Live-обновление координат гео-трансляции (geo_live_update). Координаты едут
// ТЕМ ЖЕ конструктором, что и в самом сообщении (`messageMediaGeoLive` под
// ключом `media`); собственный ключ `geo` с плоской точкой внутри был второй
// формой гео на проводе.
//
// Время обновления едет ОТДЕЛЬНЫМ ключом edit_date, а не внутри вложения: одно
// и то же поле прежде значило и «время правки», и «время обновления координат».
// Оно же решает, каким приедет `period` остановленной трансляции, поэтому едут
// они парой.
export interface GeoLiveUpdateEvt { peer_id: PeerId; id: number; media: MessageMedia; edit_date?: number }
// Догоняющее серверное превью ссылки (web_page_update): строится после
// отправки, кадр патчит уже отрисованное сообщение карточкой web page.
//
// Карточка приезжает ТЕМ ЖЕ конструктором, что и в самом сообщении
// (`messageMediaWebPage` под ключом `media`) — ровно как у `geo_live_update`,
// `poll_update` и остальных кадров с вложением. Собственного ключа `web_page`
// с плоским снимком read-модели (`site_name`/`photo_id`/`photo_w`/`photo_blur`)
// на проводе больше нет, а вместе с ним исчез и переходник на границе, который
// ДУБЛИРОВАЛ арифметику ступеней `domain.fitThumb`.
export interface WebPageUpdateEvt {
  _: 'updateMessageWebPage'
  peer: Peer
  msg_id: number
  media: MessageMedia
}
/** updateNewScheduledMessage#39a51dfb message:Message = Update;
 *
 *  Отложенное появилось или изменилось (текст, время, переход в «когда в
 *  сети») — схемный конструктор, `layer.d.ts:3306-3310`. Едет только автору,
 *  на все его устройства; `message.random_id` — `client_msg_id` постановки
 *  (по нему снимается свой временный бабл, tweb `checkPendingMessage`). */
export interface NewScheduledMessageEvt { _: 'updateNewScheduledMessage'; message: RawMessage }
/** updateDeleteScheduledMessages#f2a71983 flags:# peer:Peer messages:Vector<int>
 *  sent_messages:flags.0?Vector<int> = Update;
 *
 *  Отложенные удалены или опубликованы (`layer.d.ts:3312-3317`). Номера —
 *  ключи отложенных, СЕРВЕРНОЕ пространство. `sent_messages` tweb не читает. */
export interface DeleteScheduledMessagesEvt { _: 'updateDeleteScheduledMessages'; peer: Peer; messages: number[]; sent_messages?: number[] }
// «Проверка фактов» прикреплена/изменена/снята (factcheck_update): кадр патчит
// блок fact-check в уже отрисованном бабле. factcheck===null — проверка снята.
export interface FactCheckUpdateEvt {
  _: 'updateMessageFactCheck'
  peer: Peer
  msg_id: number
  /** «Проверку сняли» — ОТСУТСТВИЕ параметра, а не null под тем же ключом. */
  factcheck?: import('../models').FactCheck
}
/** Опрос: адресуется СВОИМ id — как у оригинала (updateMessagePoll), где
 *  сообщение лишь необязательная подсказка. */
export interface PollUpdateEvt {
  _: 'updateMessagePoll'
  /** Пир — необязательный параметр схемы, и мы его ПРОИЗВОДИМ: окна разложены
   *  по чатам, без него пришлось бы искать опрос во всех сразу. */
  peer: Peer
  poll_id: number
  poll?: import('../media/messageMedia').MessageMediaPoll['poll']
  results: import('../media/messageMedia').MessageMediaPoll['results']
}
/** Чек-лист и розыгрыш адресуются своим id внутри вложения — по той же причине,
 *  что и опрос: объект самостоятельный. Конструкторы НАШИ (апдейтов у них в
 *  схеме нет вовсе). */
export interface ChecklistUpdateEvt { _: 'updateMessageToDo'; peer: Peer; media: MessageMedia }
export interface GiveawayUpdateEvt { _: 'updateMessageGiveaway'; peer: Peer; media: MessageMedia }
/** Платное вложение разблокировано: кадр несёт РОВНО предмет — вектор позиций,
 *  ставших настоящими вместо заглушек, а не копию всего сообщения. */
export interface PaidMediaUnlockEvt {
  _: 'updateMessageExtendedMedia'
  peer: Peer
  msg_id: number
  extended_media: import('../media/messageMedia').MessageMediaPaidMedia['extended_media']
}
// Ответ бота на callback уже после таймаута синхронного ожидания — тост по WS.
/** Поздний ответ бота на callback — НАШ конструктор: у оригинала это ОТВЕТ
 *  метода `messages.getBotCallbackAnswer`, а не апдейт. Кадр существует потому,
 *  что ответ может прийти уже после таймаута синхронного ожидания.
 *
 *  «Показать модалкой» — БИТ (`pFlags.alert`), а не поле `alert: false`. */
export interface BotCallbackAnswerEvt {
  _: 'updateBotCallbackAnswer'
  pFlags?: { alert?: true }
  message: string
}
// Рукопожатие секретного чата (request/accept/reject) — realtimeBridge
// маппит snake_case-кадр в этот camelCase-вид; воркер бродкастит сырой payload.
export interface SecretHandshakeEvt {
  peerId: PeerId
  initiatorId: number
  responderId: number
  initiatorPub?: string // base64 (в request)
  responderPub?: string // base64 (в accept)
  state: string
}
// Новая/решённая предложка поста (suggested_post_update): админам — новые/решённые,
// автору — статус его предложки. post — сырая read-модель backend.
export interface SuggestedPostEvt { peer_id: PeerId; post: import('../models').RawSuggestedPost }
// Карточка пользователя изменилась. Кадр несёт КОНСТРУКТОР `user` целиком —
// АБСОЛЮТНЫЙ снимок, который получатель кладёт в кэш пиров ровно так же, как
// объект из любого списка. Прежний кадр вместо этого сообщал `display_name`
// (имени на проводе больше нет — его собирает клиент) и флажок
// `avatar_changed`, по которому карточку надо было перезапрашивать отдельной
// ручкой; на упавшем до-фетче витрина оставалась со старым аватаром.
//
// Аватарка гасится ПОКАЖДОМУ получателю: `photo` живёт внутри `user`, и
// правило `profile_photo` применяется на бэкенде при сборке кадра.
/**
 * Карточка пользователя изменилась — НАШ конструктор `updateUserSnapshot`.
 *
 * В схеме на этом месте `updateUser{user_id}` («перечитай карточку»), а сама
 * карточка едет вектором `users` КОНТЕЙНЕРА `updates`. Контейнера у нас пока
 * нет, а один id дал бы шторм запросов карточки — поэтому карточка едет внутри
 * кадра, и конструктор объявлен своим, с явным id (`schema_additional_params`).
 *
 * Своего `pts` у него нет — курсор едет в КОНВЕРТЕ (`Frame.pts`).
 */
export interface UserUpdateEvt { _: 'updateUserSnapshot'; user: UserReal }
/**
 * Удаление — НАШ конструктор `updateDeletePeerMessages`. Схемный
 * `updateDeleteMessages` пира не несёт вовсе: у оригинала номер сообщения
 * уникален в «ящике» получателя, а у нас он пер-чатный, и кадр без пира
 * означал бы «удалить №12 везде».
 *
 * Признака `for_me` больше нет: «удалено у меня» — тот же кадр, просто
 * разосланный одному получателю. Потребителей у поля не было ни одного.
 */
export interface DeleteMessageEvt {
  _: 'updateDeletePeerMessages'
  peer: Peer
  messages: number[]
  pts?: number
}
/**
 * Закрепление — `updatePinnedMessages`. «Открепили» это ТОТ ЖЕ конструктор с
 * опущенным битом: `pFlags.pinned` отсутствует, а не равен `false`. Номера
 * едут вектором — у оригинала одно действие закрепляет сразу пачку.
 */
export interface PinMessageEvt {
  _: 'updatePinnedMessages'
  peer: Peer
  messages: number[]
  pFlags?: { pinned?: true }
  pts?: number
}
/**
 * Прочтение — ДВА конструктора, а не один кадр с `user_id` внутри.
 *
 * `updateReadHistoryInbox` — прочитал Я: несёт мой горизонт и авторитетный
 * счётчик оставшегося непрочитанного. `updateReadHistoryOutbox` — прочитали
 * МЕНЯ: только горизонт собеседника (чужой непрочитанный меня не касается,
 * поэтому счётчика у конструктора нет вовсе).
 *
 * Прежде кадр был один, и «чьё это» каждый получатель выводил сам, сравнивая
 * `user_id` с собой, — тот же вывод повторялся в трёх местах разбора.
 */
export interface ReadHistoryInboxEvt {
  _: 'updateReadHistoryInbox'
  peer: Peer
  /** Горизонт в СЕРВЕРНЫХ номерах (клиентский получается через generateMessageId). */
  max_id: number
  still_unread_count: number
  pts?: number
}
export interface ReadHistoryOutboxEvt {
  _: 'updateReadHistoryOutbox'
  peer: Peer
  max_id: number
  pts?: number
}
export type ReadEvt = ReadHistoryInboxEvt | ReadHistoryOutboxEvt
// Голосовое/кружок прослушано получателем → у сообщения гаснет точка media_unread.
/** Вложение прослушано (голосовое, кружок) — наш `updateReadPeerMessagesContents`
 * по той же причине, что и удаление: схемный конструктор пира не несёт. */
export interface MediaReadEvt {
  _: 'updateReadPeerMessagesContents'
  peer: Peer
  messages: number[]
  /** Тема форума, в которой сняты упоминания (ответ `readMentions` в теме);
   *  серверный номер. tweb читает её из кадра (onUpdateReadMessagesContents
   *  :10998-10999); без неё тема выводится из самого сообщения. */
  top_msg_id?: number
  pts?: number
}
/** Меня удалили из группы / я вышел — диалог убирается из списка. НАШ
 *  конструктор: предмета «чат исчез» в схеме нет вовсе (у оригинала выход
 *  выражается сообщением-действием и перечитыванием карточки).
 *
 *  Поле `removed: true` ушло — оно было константой: «кадр удаления сообщает об
 *  удалении». Вид кадра несёт дискриминатор. */
export interface ChatRemovedEvt { _: 'updateChatRemoved'; peer: Peer }
/**
 * «Перечитай канал» — `updateChannel{channel_id}`. Сервер шлёт его вступившему
 * в broadcast-канал: диалога ещё нет, и строку заводит перечитывание (tweb
 * `onUpdateChannel` → `reloadConversation`).
 */
export interface ChannelEvt { _: 'updateChannel'; channel_id: number }
/**
 * «Канал сдвинулся, пока тебя не было» — `updateChannelTooLong{channel_id,
 * pts?}` в other_updates `updates.getDifference`: канал с известным состоянием
 * догоняется `updates.getChannelDifference`.
 */
export interface ChannelTooLongEvt { _: 'updateChannelTooLong'; channel_id: number; pts?: number }
/**
 * Канальные близнецы правки, удаления и закрепления — те же предметы, что
 * `updateEditMessage` / `updateDeletePeerMessages` / `updatePinnedMessages`, но
 * журналом broadcast-канала: `pts` у них ПЕР-КАНАЛЬНЫЙ. Канал назван
 * `channel_id` (номера пер-канальные), у правки — `message.peer_id`.
 * Обработчик у них общий с пер-юзерными (tweb вешает на обе пары один:
 * `onUpdateEditMessage`, `onUpdateDeleteMessages`), различает их только курсор.
 */
export interface EditChannelMessageEvt { _: 'updateEditChannelMessage'; message: RawMyMessage; pts?: number }
export interface DeleteChannelMessagesEvt { _: 'updateDeleteChannelMessages'; channel_id: number; messages: number[]; pts?: number }
export interface PinChannelMessagesEvt {
  _: 'updatePinnedChannelMessages'
  pFlags?: { pinned?: true }
  channel_id: number
  messages: number[]
  pts?: number
}
// Тема оформления чата сменилась (chat_theme_update) — общая для чата, приходит
// обоим участникам. theme_id пустой — тема сброшена к дефолту.
export interface ChatThemeUpdateEvt { _: 'updateChatTheme'; peer: Peer; theme_id: string }
// Пин/архив/mute диалога с другого устройства/вкладки (Task 4: применяет владелец
// dialogsManager из workerCore.ts::dispatch, см. applyPinned/applyArchived/
// applyNotifySettings).
/**
 * Закрепление диалога — `updateDialogPinned{peer: DialogPeer}`. «Открепили» это
 * ТОТ ЖЕ конструктор с опущенным битом `pFlags.pinned`, а не поле
 * `pinned: false` и не второй кадр: то же правило, что у закрепления сообщения.
 *
 * Своего `pts` у конструктора нет — курсор такого кадра едет в КОНВЕРТЕ
 * (`Frame.pts`), а не в теле.
 */
export interface DialogPinEvt {
  _: 'updateDialogPinned'
  peer: import('../models').DialogPeer
  pFlags?: { pinned?: true }
}
/**
 * Переезд диалога МЕЖДУ ПАПКАМИ — `updateFolderPeers{folder_peers, pts}`.
 *
 * Архив это ПАПКА, а не признак: прежний `archived: boolean` подделывал
 * значение (номер папки) признаком — тот же дефект, что был у мьюта булевым.
 * «Вернуть из архива» — тот же кадр с `folder_id = 0`. Вектор потому, что у
 * оригинала одно действие переносит сразу пачку.
 */
export interface DialogArchiveEvt {
  _: 'updateFolderPeers'
  folder_peers: import('../models').FolderPeer[]
  pts?: number
}
/**
 * Мьют чата сменился. Кадр несёт КОНСТРУКТОР настроек ЦЕЛИКОМ, а не пару
 * `{muted, muted_until}`: мьют это СРОК (`notify_settings.mute_until`), и
 * прежняя булева форма его теряла — «заглушить на час» доезжало как
 * «навсегда». Бэкенд читает настройки обратно из базы, поэтому в кадре едут и
 * превью со звуком, которых мьют не менял (usecase/chat/group.go::SetMute).
 */
/** updatePinnedForumTopic#683b2c52 flags:# pinned:flags.0?true peer:Peer
 *  topic_id:int = Update; — тему закрепили/открепили (tweb `dialogs.ts:2480-2490`).
 *  «Открепили» — отсутствие бита. `topic_id` — серверный номер темы. */
/** updateReadChannelDiscussionInbox#d6b19546 flags:# channel_id:long top_msg_id:int
 *  read_max_id:int broadcast_id:flags.0?long broadcast_post:flags.0?int = Update;
 *  updateReadChannelDiscussionOutbox#695c9e7c channel_id:long top_msg_id:int read_max_id:int = Update;
 *  — горизонт прочтения ТРЕДА (тема, тред комментариев). Номера серверные;
 *  `broadcast_*` tweb не читает, сервер их не производит. */
export interface ReadDiscussionEvt {
  _: 'updateReadChannelDiscussionInbox' | 'updateReadChannelDiscussionOutbox'
  channel_id: number
  top_msg_id: number
  read_max_id: number
}
export interface PinnedForumTopicEvt {
  _: 'updatePinnedForumTopic'
  pFlags?: { pinned?: true }
  peer: Peer
  topic_id: number
}
export interface DialogMuteEvt {
  _: 'updateNotifySettings'
  peer: import('../models').NotifyPeer
  notify_settings: PeerNotifySettings
}
// АБСОЛЮТНЫЙ снимок метаданных чата после мутации (переименование, фото, права,
// участники, настройки) — backend/internal/usecase/chat/chat_update.go:18-42,
// функция chatUpdatePayload. Абсолютность и делает применение идемпотентным:
// порядок доставки (живой кадр / догон по pts) значения не имеет.
// Здесь объявлены только поля, которые реально ложатся в модель `Dialog`
// (core/models.ts:88-118); остальные (`about`, `is_public`, `settings`,
// `signatures`, …) живут в карточке чата, которую грузит useChatInfoCard.
export interface ChatUpdateEvt {
  /** Пара по КУРСОРУ, как у кадра сообщения: канальный снимок едет журналом
   *  канала (`updateChannelFullSnapshot`), групповой — пер-юзерным веером. */
  _: 'updateChatFullSnapshot' | 'updateChannelFullSnapshot'
  peer: Peer
  /** ТОТ ЖЕ объект, что отдаёт `GET /chats/{peerID}/card` — `messages.chatFull`
   *  с краткой формой чата внутри (`chats[0]`). Прежде одна карточка ехала
   *  двумя разными формами: плоско с `id` у ручки и вложенно в кадре, из-за
   *  чего кадр приходилось разбирать своим кодом. */
  chat_full: MessagesChatFull
  pts?: number
}
/**
 * updateChannelParticipant#985d3abb flags:# channel_id:long date:int
 * actor_id:long user_id:long prev_participant:flags.0?ChannelParticipant
 * new_participant:flags.1?ChannelParticipant invite:flags.2?ExportedChatInvite
 * qts:int = Update;
 *
 * Смена состава или прав участника. Отсутствие `prev_participant` — «не был
 * участником», отсутствие `new_participant` — «больше ни в каких списках».
 * `channel_id` — СЫРОЙ положительный id чата (как у оригинала, `chatId`).
 * `qts` не производится: курсор один, он едет в конверте. Тот же объект
 * порождает и сам воркер после своей мутации (`groupsManager.editAdmin`/
 * `editBanned`/`addMember` — порт `generateUpdateChannelParticipant`), тогда
 * `actor_id` нет.
 */
export interface ChannelParticipantEvt {
  _: 'updateChannelParticipant'
  channel_id: number
  date: number
  actor_id?: number
  user_id: number
  prev_participant?: ChannelParticipantWire
  new_participant?: ChannelParticipantWire
  invite?: ChatInviteExported
}
/**
 * updatePendingJoinRequests#7063c3db peer:Peer requests_pending:int
 * recent_requesters:Vector<long> = Update;
 *
 * Своего `pts` у конструктора нет — курсор едет в КОНВЕРТЕ.
 */
export interface PendingJoinRequestsEvt {
  _: 'updatePendingJoinRequests'
  peer: Peer
  requests_pending: number
  recent_requesters: number[]
}
/** Полезная нагрузка `rt:chat_requests` — tweb `BroadcastEvents['chat_requests']`
 *  (`rootScope.ts:37`): чат — положительным `chatId`, заявители — `UserId`. */
export interface ChatRequestsEvt { chatId: ChatId; recentRequesters: UserId[]; requestsPending: number }
/**
 * Черновик изменён на другом устройстве/вкладке — `updateDraftMessage`.
 *
 * «Снят» выражает КОНСТРУКТОР `draftMessageEmpty` внутри того же параметра, а
 * не `draft: null`: отсутствие — выбор конструктора, как у любого объединения.
 *
 * Своего `pts` у конструктора нет — курсор едет в КОНВЕРТЕ (`Frame.pts`).
 */
export type DraftUpdateEvt = import('../models').RawDraft
/**
 * Что именно делает собеседник — ОБЪЕДИНЕНИЕ `SendMessageAction`, а не строка
 * из шести значений с дефолтом «печатает».
 *
 * Разница не в форме: у `sendMessageUpload*Action` есть параметр `progress`, то
 * есть полоска «отправляет фото 40%» у оригинала ВЫРАЗИМА, а строкой её
 * выразить нечем. Мы его пока не производим (прогресс живёт у отправителя и
 * наружу не выходит) — отсутствует значение, а не возможность.
 *
 * Объявлены ровно те конструкторы, что производит наш клиент; остальные
 * пятнадцать (геолокация, выбор контакта, игра, кружок, эмодзи-интеракции, …)
 * предмета у нас не имеют.
 */
export type SendMessageAction =
  | { _: 'sendMessageTypingAction' }
  | { _: 'sendMessageRecordAudioAction' }
  | { _: 'sendMessageRecordVideoAction' }
  | { _: 'sendMessageUploadDocumentAction'; progress?: number }
  | { _: 'sendMessageUploadPhotoAction'; progress?: number }
  | { _: 'sendMessageUploadVideoAction'; progress?: number }
  | { _: 'sendMessageUploadAudioAction'; progress?: number }

/**
 * «Печатает» — ДВА конструктора, и выбирает между ними тип чата.
 *
 * В личном чате ключа пира у кадра нет вовсе: пир — это сам печатающий
 * (`updateUserTyping.user_id`). В группе адрес чата и автор — разные параметры,
 * потому что это разные вопросы (`updateChannelUserTyping`).
 */
export interface UserTypingEvt {
  _: 'updateUserTyping'
  user_id: number
  action: SendMessageAction
}
export interface ChannelUserTypingEvt {
  _: 'updateChannelUserTyping'
  channel_id: number
  from_id: Peer
  action: SendMessageAction
}
export type TypingEvt = UserTypingEvt | ChannelUserTypingEvt
/**
 * Присутствие — объединение `UserStatus` схемы, а не пара `{online, last_seen}`.
 *
 * Это не перестановка полей: у `userStatusOnline` есть `expires` (дедлайн), и
 * клиент гасит статус ПО ТАЙМЕРУ сам (порт `appUsersManager.ts:880-889`,
 * предикат `isUserStatusOnline`). У прежнего `online: true` срока годности не
 * было — потерянный кадр оставлял человека онлайн НАВСЕГДА. Источник
 * (TTL ключа `presence:{id}`) существовал всегда, просто не выпускался на провод.
 *
 * Скрытое правилом приватности «был в сети» выражает САМ КОНСТРУКТОР
 * (`userStatusRecently`), а не флаг `last_seen_visible` рядом с обнулённым
 * временем.
 */
export interface PresenceEvt {
  _: 'updateUserStatus'
  user_id: number
  status: UserStatus
}
/**
 * Реакции — `updateMessageReactions{peer, msg_id, reactions}`: АБСОЛЮТНОЕ
 * состояние агрегата, тем же конструктором, что едет внутри сообщения.
 *
 * Диффа (кто, какой эмодзи, добавил или снял) в кадре больше нет: он был второй
 * формой того же факта, и при гонке двух реакций клиент верил разным полям
 * по-разному. Разницу выводит сам клиент — из состояния, которое у него уже
 * есть.
 *
 * Агрегат помечен `pFlags.min`: тело кадра одно на всех получателей, значит
 * моего `chosen_order` в нём нет и быть не может, — свой выбор клиент
 * сохраняет, а не затирает отсутствием. По той же причине в нём нет и моего
 * вклада ЗВЁЗДАМИ (`top_reactors`).
 *
 * Платная ⭐-реакция своего кадра не имеет: она приезжает ЗДЕСЬ же — вторым
 * конструктором объединения `Reaction` (`reactionPaid`) в том же векторе
 * `results`. Прежде их было два, и каждый вёз ПОЛОВИНУ агрегата, то есть
 * утверждал, что другой половины не существует.
 */
export interface ReactionEvt {
  _: 'updateMessageReactions'
  peer: Peer
  msg_id: number
  /** Тема форума, в которой лежит сообщение (General — 1); серверный номер. */
  top_msg_id?: number
  reactions: MessageReactions
}
/**
 * updateChannelMessageViews#f226ac08 channel_id:long id:int views:int = Update;
 *
 * Счётчик просмотров поста ВЫРОС. `id` — номер поста в канале (серверное
 * пространство: границу переводит получатель, `generateMessageId`).
 *
 * Кадр — ПОБОЧНЫЙ ЭФФЕКТ регистрации просмотра, а не ответ на опрос: видимые
 * посты объявляет интерсектор ленты (tweb bubbles.ts:2305-2328), а счётчик
 * растёт один раз на пару «пост + зритель». У оригинала тот же конструктор
 * появляется ЛОКАЛЬНО — из ответа `messages.getMessagesViews{increment:true}`
 * (appMessagesManager.ts:9145-9155); у нас его производит сервер, потому что
 * зрителей у поста много, а увидеть чужой просмотр должны все.
 *
 * Курсора нет вовсе: кадр уезжает в топик канала, а авторитетное значение
 * приезжает внутри самого сообщения со страницей истории.
 */
export interface ViewsUpdateEvt {
  _: 'updateChannelMessageViews'
  channel_id: number
  id: number
  views: number
}
/** Значение `rt:history_count`: окно (`winKey`) и его счёт. */
export interface HistoryCountEvt {
  key: string
  count: number
}

/** Бусты канала — НАШ конструктор (кадра бустов ЗРИТЕЛЮ в схеме нет:
 *  `updateBotChatBoost` про бота, следящего за чужим каналом). Сам статус —
 *  предмет схемный, `premium.boostsStatus`.
 *
 *  Курсор пер-КАНАЛЬНЫЙ: кадр едет журналом канала. */
export interface BoostUpdateEvt {
  _: 'updateChannelBoostStatus'
  peer: Peer
  status: import('../models').BoostsStatus
  pts?: number
}
/**
 * updateDialogFilterOrder#a5d72105 order:Vector<int> = Update;
 *
 * Порядок папок. `order` — id папок в новом порядке, `0` — «Все чаты» (есть,
 * только если устройство его переставляло: у не-премиум tweb вырезает его,
 * `chatFolders.tsx:365-367`). Неперечисленные папки остаются в хвосте в прежнем
 * порядке. Курсор едет в конверте.
 */
export interface DialogFilterOrderEvt { _: 'updateDialogFilterOrder'; order: number[] }
/** updateSavedReactionTags#39c67432 = Update; — параметров нет. */
export interface SavedReactionTagsEvt { _: 'updateSavedReactionTags' }
/** updateNewStickerSet#688a30aa stickerset:messages.StickerSet = Update; */
export interface NewStickerSetEvt {
  _: 'updateNewStickerSet'
  stickerset: {
    _: 'messages.stickerSet'
    set: StickerSet
    packs: StickerPack[]
    keywords: unknown[]
    documents: MyDocument[]
  }
}
/** updateRecentStickers#9a422c20 = Update; — параметров нет, список перечитывается. */
export interface RecentStickersEvt { _: 'updateRecentStickers' }
/** updateFavedStickers#e511996d = Update; */
export interface FavedStickersEvt { _: 'updateFavedStickers' }
/** updateSavedGifs#9375341e = Update; */
export interface SavedGifsEvt { _: 'updateSavedGifs' }
/** Баланс звёзд — `updateStarsBalance{balance: StarsAmount}`. Число едет
 *  конструктором, потому что у оригинала звёзды ДРОБНЫЕ (nanos), и целое —
 *  частный случай, а не форма. */
export interface BalanceUpdateEvt {
  _: 'updateStarsBalance'
  balance: { _: 'starsAmount'; amount: number; nanos: number }
}
// Истории (Stories realtime): новая история автора / удаление / изменение реакции.
/** updateStory#75b3b798 peer:Peer story:StoryItem = Update;
 *
 *  История едет ЦЕЛИКОМ — тем же конструктором, что и на витрине, вместе со
 *  ступенью медиа. Плоский кадр прошлой формы историю построить не мог: в нём
 *  был только номер файла, и витрине приходилось перечитывать ленту. */
export interface StoryUpdateEvt { _: 'updateStory'; peer: Peer; story: StoryItem }
/** updateSentStoryReaction#7d627683 peer:Peer story_id:int reaction:Reaction;
 *
 *  МОЙ выбор — эхо на другие устройства зрителя, `story_id` — НОМЕР истории у
 *  автора. Общий агрегат сюда не входит: он одинаков для всех и едет внутри самой
 *  истории (`storyViews`). Стор кадр не применяет: tweb его не слушает. */
export interface SentStoryReactionEvt { _: 'updateSentStoryReaction'; peer: Peer; story_id: number; reaction?: Reaction }
/** updateReadStories#f74e932b peer:Peer max_id:int = Update;
 *
 *  ГОРИЗОНТ прочтения историй автора сдвинулся — один номер вместо признака на
 *  каждой истории, ровно как `updateReadHistoryInbox` у сообщений. Кадр уезжает
 *  на ДРУГИЕ устройства зрителя: кольцо непрочитанного гаснет везде. */
export interface ReadStoriesEvt { _: 'updateReadStories'; peer: Peer; max_id: number }
/**
 * updatePeerBlocked#ebe07752 flags:# blocked:flags.0?true
 * blocked_my_stories_from:flags.1?true peer_id:Peer = Update;
 *
 * Чёрный список изменился на другом устройстве владельца (или местный апдейт
 * после своего ответа). «Разблокировали» — отсутствие бита `pFlags.blocked`.
 * `blocked_my_stories_from` не производится. Курсор едет в конверте.
 */
export interface PeerBlockedEvt { _: 'updatePeerBlocked'; pFlags?: { blocked?: true }; peer_id: Peer }
/**
 * updatePrivacy#ee3b272a key:PrivacyKey rules:Vector<PrivacyRule> = Update;
 *
 * Правило одного ключа сменилось: вектор правил целиком (абсолютный снимок).
 * Ключ — конструктор схемы (`privacyKeyStatusTimestamp`), перевод в наш ключ —
 * `privacyKeyOfTag`. Курсор едет в конверте.
 */
export interface PrivacyEvt { _: 'updatePrivacy'; key: { _: string }; rules: import('../managers/privacyManager').PrivacyRuleWire[] }
/**
 * updatePeerHistoryTTL#bb9bb9a5 flags:# peer:Peer ttl_period:flags.0?int = Update;
 *
 * Срок автоудаления чата сменился (личка и группа; у broadcast-канала срок
 * едет снимком карточки, В-3 Ф-6). Отсутствие `ttl_period` — «выключено».
 * Курсор едет в конверте.
 */
export interface PeerHistoryTTLEvt { _: 'updatePeerHistoryTTL'; peer: Peer; ttl_period?: number }
/**
 * Объединение `Update` — все кадры, у которых ЕСТЬ конструктор.
 *
 * Отсюда выводится `UpdatePredicate`, и он же держит реестр маршрутизации
 * полным: пропущенный конструктор — ошибка компиляции, а не молчаливо
 * проигнорированный кадр. Кадры БЕЗ конструктора (транспорт и непортированные
 * предметы) сюда не входят и опознаются типом конверта — их список в
 * `transportFrames.ts`.
 */
export type Update =
  | NewMessageEvt
  | EditMessageEvt
  | EditChannelMessageEvt
  | DeleteMessageEvt
  | DeleteChannelMessagesEvt
  | PinMessageEvt
  | PinChannelMessagesEvt
  | ChannelEvt
  | ChannelTooLongEvt
  | ReadEvt
  | MediaReadEvt
  | ReactionEvt
  | ViewsUpdateEvt
  | DraftUpdateEvt
  | DialogPinEvt
  | DialogArchiveEvt
  | DialogMuteEvt
  | PinnedForumTopicEvt
  | ReadDiscussionEvt
  | TypingEvt
  | PresenceEvt
  | UserUpdateEvt
  | PollUpdateEvt
  | ChecklistUpdateEvt
  | GiveawayUpdateEvt
  | WebPageUpdateEvt
  | FactCheckUpdateEvt
  | PaidMediaUnlockEvt
  | ChatRemovedEvt
  | ChatThemeUpdateEvt
  | ChatUpdateEvt
  | ChannelParticipantEvt
  | PendingJoinRequestsEvt
  | BoostUpdateEvt
  | BalanceUpdateEvt
  | SavedReactionTagsEvt
  | DialogFilterOrderEvt
  | NewStickerSetEvt
  | RecentStickersEvt
  | FavedStickersEvt
  | SavedGifsEvt
  | BotCallbackAnswerEvt
  | StoryUpdateEvt
  | SentStoryReactionEvt
  | ReadStoriesEvt
  | NewScheduledMessageEvt
  | DeleteScheduledMessagesEvt
  | PeerBlockedEvt
  | PrivacyEvt
  | PeerHistoryTTLEvt

/** Значение дискриминатора `_` — то же, что `predicate` в схеме. */
export type UpdatePredicate = Update['_']

/** Сервер подтвердил отправку: у бабла появляется НАСТОЯЩИЙ номер в чате
 *  (серверное пространство — владелец переводит его в клиентское) и дата. */
// Подтверждение отправки по образцу updateShortSentMessage (A4-17): номер,
// дата (секунды) и то, что сервер сделал с отправленным сам — санитизированные
// entities, вложение (превью ссылки у текста), ttl_period.
export interface AckEvt {
  client_msg_id: string; id: number; date: number
  entities?: MessageEntity[]; media?: MessageMedia; ttl_period?: number
  /** Только провод (S1): отправка ушла в очередь отложенных, `id` — ключ
   *  отложенного. Клиент флаг не читает: куда финализировать бабл, знает сама
   *  заявка (`schedule_date`, `managers/messages/pending.ts`). */
  scheduled?: boolean
}
// Server rejected a send (e.g. text too long). The client drops it from the outbox
// (no infinite retry) and removes the optimistic bubble.
export interface MessageErrorEvt { client_msg_id: string; reason: string }

// Заявка на временный («неотправленный») бабл — вход
// messages.beforeMessageSending (core/managers/messages/pending.ts). Событием это
// больше НЕ является: наружу воркер объявляет только MessageOp.
//
// Локальная мета файла (размеры/mime/имя) нужна, чтобы бабл документа/фото
// нарисовался до аплоада. `local_url` — blob-URL превью, СМИНЧЕННЫЙ ВОРКЕРОМ
// (messages.sendFile): воркерный blob-URL резолвится во всех вкладках, поэтому
// он лежит в SSOT как обычное поле. Вкладочного blob-URL здесь быть не может —
// он был бы битым во всех вкладках, кроме породившей.

// Локальная мета отправляемого файла — АРГУМЕНТЫ сборки вложения, а не само
// вложение: порт `MakeDocumentAndMetaForSendingFileArgs` из tweb
// (appMessagesManager.ts:1908 — `width`/`height`/`duration`/`waveform`/
// `isAnimated`/`spoiler` приходят в менеджер плоскими, ровно так же). Настоящий
// `messageMediaPhoto`/`messageMediaDocument` собирает из них САМ менеджер —
// `makeDocumentAndMetaForSendingFile` в `core/managers/messages/pending.ts`,
// как это делает `sendFile` оригинала.
export interface PendingMedia { width?: number; height?: number; mime?: string; size?: number; name?: string;
  /** tweb `isAnimated` — файл отправляется гифкой: в документ уходит
   * `documentAttributeAnimated`, из него выводится `doc.type === 'gif'` */
  animated?: boolean;
  /** длительность голосового/видео (сек) — посчитана вкладкой при записи/probe */
  duration?: number;
  /** пики волны голосового, base64 — те же, что уедут в media.waveform: бабл
   * «отправляется…» рисует волну сразу, не дожидаясь эха сервера */
  waveform?: string;
  /** медиа скрыто спойлером — своя отправка обязана показать спойлер СРАЗУ,
   * до эха сервера (tweb applyMediaSpoiler в попапе отправки уже накрыл превью) */
  spoiler?: boolean }
export interface PendingNewEvt {
  peer_id: PeerId
  thread_root_id?: number | null
  client_msg_id: string
  sender_id: number
  text: string
  type?: string
  media_id?: number | null
  entities?: MessageEntity[]
  /** ключ альбома — ЧИСЛО (в схеме `grouped_id:flags.17?long`) */
  grouped_id?: number
  media?: PendingMedia
  /** Готовый документ файла (стикер) — кладётся в бабл как есть, см.
   *  `SendOptimistic.document` в `core/managers/messages/pending.ts`. */
  document?: MyDocument
  /** blob-URL локального превью, сминченный воркером (см. выше) */
  local_url?: string
  /** АРГУМЕНТЫ сборки гео-вложения бабла (как и `media` выше — не само
   *  вложение): три конструктора из них собирает `makeGeoMedia`. */
  geo?: { lat: number; lng: number; title?: string; address?: string; livePeriod?: number; heading?: number }
  /** То же для визитки: поля `inputMediaContact`, что уходят на сервер, и
   *  `user_id` — только для бабла (tweb кладёт его в локальное сообщение,
   *  `appMessagesManager.ts:4035-4045`; на провод он не идёт). 0 — аккаунт
   *  неизвестен. */
  contact?: { user_id?: number; first_name: string; last_name: string; phone_number: string; vcard: string }
  secret?: boolean
  /** send-as: бабл сразу от лица канала/группы. Едет ССЫЛКА (знаковый ключ), а
   *  не снимок `{title, photo_id}`: имя и фото автор бабла берёт из зеркала
   *  карточек — ровно так же, как их берёт серверное эхо, у которого `from_id`
   *  указывает на тот же канал. */
  send_as?: PeerId
  /** Ответ на сообщение — в бабле СРАЗУ, до подтверждения сервера (порт tweb
   *  `generateOutgoingMessage → reply_to: generateReplyHeader(...)`,
   *  appMessagesManager.ts:2926). Номер — в КЛИЕНТСКОМ пространстве. */
  reply_to_id?: number | null
  /** Текст цитаты (reply quote) — в превью бабла вместо текста оригинала. */
  reply_quote_text?: string
  /** Кросс-чат ответ: чат оригинала. Оригинала нет в этом чате, поэтому превью
   *  строится из `reply_to.reply_from`/`reply_media`, которые приедут с эхом; до
   *  него плашка показывает ссылку. */
  reply_to_peer_id?: PeerId
  /** tweb `options.scheduleDate` у `generateOutgoingMessage`/`beforeMessageSending`:
   *  бабл ложится в хранилище отложенных, `date` — время отправки. */
  schedule_date?: number
  /** tweb `scheduleRepeatPeriod` — бабл несёт `schedule_repeat_period` сразу. */
  schedule_repeat_period?: number
  /** Карточка ссылки плашки композера — вложение бабла сразу, до эха (tweb
   *  `generateOutgoingWebPage`, appMessagesManager.ts:4893-4900). */
  web_page?: MessageMediaWebPage
  /** «Карточка над текстом» — `message.pFlags.invert_media` (tweb :4903-4905). */
  invert_media?: true
  /** Порт ОПЦИИ tweb `beforeMessageSending({sequential})` (не проводного поля:
   *  наружу этот признак уходит не кадром, а полем операции `insert`, см.
   *  `core/realtime/messageOps.ts`). Смысл в оригинале — «кадр отправки уходит
   *  на сервер В ТОМ ЖЕ ходу, что и появление бабла», поэтому серверный
   *  идентификатор сохранит ту позицию внизу окна, которую бабл уже занял.
   *  tweb ставит его у `sendText`/`sendOther`/`forwardMessages` и НЕ ставит у
   *  `sendFile`/`sendPoll` — там между баблом и кадром стоит аплоад, за время
   *  которого вперёд может уйти другое сообщение. Мы ставим его по тому же
   *  правилу (`messages.sendText`, `channels.post`), а лента на нём срезает
   *  перекладку бабла — `chat/bubbles.ts`, подписка `history_update`. */
  sequential?: boolean
}

// One envelope for every 1:1 call signaling frame (call_request / call_accept /
// call_decline / call_end / call_signal); `d.from_user_id` is stamped by the server.
export interface CallFrameEvt {
  t: 'call_request' | 'call_accept' | 'call_decline' | 'call_end' | 'call_signal'
  d: Record<string, unknown> & { from_user_id: number; call_id?: string }
}
