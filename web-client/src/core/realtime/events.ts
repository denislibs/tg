// src/core/realtime/events.ts
import type { MessageEntity, RawMyMessage, WireMessageReactions } from '../models'
import type { MessageMedia } from '../media/messageMedia'
import type { MessagesChatFull, UserReal, UserStatus } from '../peers/peer'
import type { PeerNotifySettings } from '../dialogs/notifySettings'
import type { Peer } from '../peers/peerId'
// Worker -> UI event names (over SuperMessagePort.emit). Live frames AND /sync
// catch-up both surface through these, so the UI handles them uniformly.
export const RT = {
  newMessage: 'rt:new_message',
  // Stage 1B.2 (Task 3): операции над окнами сообщений (MessageOp[]) — порождает
  // ТОЛЬКО воркер (cacheLive), рассылается в ДОПОЛНЕНИЕ к rt:new_message. Проектор
  // переигрывает их поверх стора вместо разбора сырого кадра (Task 4).
  messageOp: 'rt:message_op',
  editMessage: 'rt:edit_message',
  deleteMessage: 'rt:delete_message',
  pinMessage: 'rt:pin_message',
  read: 'rt:read',
  mediaRead: 'rt:media_read',
  typing: 'rt:typing',
  presence: 'rt:presence',
  reaction: 'rt:reaction',
  ack: 'rt:ack',
  messageError: 'rt:message_error',
  // Пяти событий rt:pending_* больше нет: жизненный цикл неотправленного
  // сообщения переехал в менеджер воркера (core/managers/messages/pending.ts),
  // и наружу он объявляет только MessageOp (rt:message_op) — «бабл появился» это
  // insert, «доехал ack» — insert финального, «ошибка» — patch {failed}, «отмена»
  // — remove. Окно правит ТОЛЬКО applyOps, исключений больше нет.
  call: 'rt:call',
  chatRemoved: 'rt:chat_removed',
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
  // Мутация папок с другого устройства/вкладки (create/edit/delete/reorder) —
  // logged, pts. Клиент перечитывает список папок.
  folderUpdate: 'rt:folder_update',
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
  pollUpdate: 'rt:poll_update',
  checklistUpdate: 'rt:checklist_update',
  boostUpdate: 'rt:boost_update',
  giveawayUpdate: 'rt:giveaway_update',
  suggestedPost: 'rt:suggested_post_update',
  balanceUpdate: 'rt:balance_update',
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
  storyNew: 'rt:story_new',
  storyDeleted: 'rt:story_deleted',
  storyReaction: 'rt:story_reaction',
  // rt:state / rt:state_synchronizing / rt:state_synchronized — УВЕДОМЛЕНИЯ
  // «что-то изменилось», НЕ источник значения. Значение — всегда через RPC
  // managers.realtime.getStatus() (realtime.ts, докблок метода — там же разбор,
  // что из этой pull-дисциплины 1:1 с tweb, а что наше расширение поверх него;
  // для rt:state — 1:1, connectionStatus.ts:47-51/:87-91). Не читать поля этих
  // событий как факт.
  state: 'rt:state',
  // tweb apiUpdatesManager.ts:460-469 (state_synchronizing/state_synchronized) —
  // начало/конец catch-up (/sync), пара для индикатора «Обновление…» в поиске
  // (порт ConnectionStatusComponent, Задача 1). syncEngine.catchUp() гарантирует
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
  message: import('../models').RawMessage
  /** плотный монотонный pts (funnel-дедуп/гейт/gap). */
  pts?: number
  /** авторитетный счётчик непрочитанных диалога (только получателям): владелец
   *  берёт его verbatim вместо локального +1. */
  unread?: number
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
export interface WebPageUpdateEvt { peer_id: PeerId; id: number; media: MessageMedia }
// «Проверка фактов» прикреплена/изменена/снята (factcheck_update): кадр патчит
// блок fact-check в уже отрисованном бабле. factcheck===null — проверка снята.
export interface FactCheckUpdateEvt { peer_id: PeerId; id: number; factcheck: import('../models').FactCheck | null }
// Ответ бота на callback уже после таймаута синхронного ожидания — тост по WS.
export interface BotCallbackAnswerEvt { text: string; alert: boolean }
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
export interface UserUpdateEvt { user: UserReal; pts?: number }
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
  pts?: number
}
// Меня удалили из группы / я вышел — диалог убирается из списка.
export interface ChatRemovedEvt { peer_id: PeerId; removed: true }
// Тема оформления чата сменилась (chat_theme_update) — общая для чата, приходит
// обоим участникам. theme_id пустой — тема сброшена к дефолту.
export interface ChatThemeUpdateEvt { peer_id: PeerId; theme_id: string }
// Пин/архив/mute диалога с другого устройства/вкладки (Task 4: применяет владелец
// dialogsManager из workerCore.ts::dispatch, см. applyPinned/applyArchived/
// applyNotifySettings).
export interface DialogPinEvt { peer_id: PeerId; pinned: boolean }
export interface DialogArchiveEvt { peer_id: PeerId; archived: boolean }
/**
 * Мьют чата сменился. Кадр несёт КОНСТРУКТОР настроек ЦЕЛИКОМ, а не пару
 * `{muted, muted_until}`: мьют это СРОК (`notify_settings.mute_until`), и
 * прежняя булева форма его теряла — «заглушить на час» доезжало как
 * «навсегда». Бэкенд читает настройки обратно из базы, поэтому в кадре едут и
 * превью со звуком, которых мьют не менял (usecase/chat/group.go::SetMute).
 */
export interface DialogMuteEvt { peer_id: PeerId; notify_settings: PeerNotifySettings }
// АБСОЛЮТНЫЙ снимок метаданных чата после мутации (переименование, фото, права,
// участники, настройки) — backend/internal/usecase/chat/chat_update.go:18-42,
// функция chatUpdatePayload. Абсолютность и делает применение идемпотентным:
// порядок доставки (живой кадр / догон по pts) значения не имеет.
// Здесь объявлены только поля, которые реально ложатся в модель `Dialog`
// (core/models.ts:88-118); остальные (`about`, `is_public`, `settings`,
// `signatures`, …) живут в карточке чата, которую грузит useChatInfoCard.
export interface ChatUpdateEvt {
  peer_id: PeerId
  /** ТОТ ЖЕ объект, что отдаёт `GET /chats/{peerID}/card` — `messages.chatFull`
   *  с краткой формой чата внутри (`chats[0]`). Прежде одна карточка ехала
   *  двумя разными формами: плоско с `id` у ручки и вложенно в кадре, из-за
   *  чего кадр приходилось разбирать своим кодом. */
  chat_full: MessagesChatFull
  pts?: number
}
// Черновик изменён на другом устройстве/вкладке (draft null — удалён).
export interface DraftUpdateEvt { peer_id: PeerId; draft: import('../models').RawDraft | null }
// upload_* — на время аплоада медиа (tweb sendMessageUpload*Action: «отправляет файл/фото/…»)
export type TypingAction = 'typing' | 'voice' | 'video' | 'upload_file' | 'upload_photo' | 'upload_video' | 'upload_audio'
export interface TypingEvt { peer_id: PeerId; user_id: number; action?: TypingAction }
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
export interface PresenceEvt { user_id: number; status: UserStatus }
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
  reactions: WireMessageReactions
  pts?: number
}
// Истории (Stories realtime): новая история автора / удаление / изменение реакции.
export interface StoryNewEvt { id: number; author_id: number; media_id: number; caption: string; expires_at: string }
export interface StoryDeletedEvt { story_id: number; author_id: number }
export interface StoryReactionEvt { story_id: number; user_id: number; reaction: string | null; reactions_count: number }
/** Сервер подтвердил отправку: у бабла появляется НАСТОЯЩИЙ номер в чате
 *  (серверное пространство — владелец переводит его в клиентское) и дата. */
export interface AckEvt { client_msg_id: string; id: number; created_at: string }
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
  /** blob-URL локального превью, сминченный воркером (см. выше) */
  local_url?: string
  /** АРГУМЕНТЫ сборки гео-вложения бабла (как и `media` выше — не само
   *  вложение): три конструктора из них собирает `makeGeoMedia`. */
  geo?: { lat: number; lng: number; title?: string; address?: string; livePeriod?: number; heading?: number }
  /** То же для визитки: телефон гидрирует сервер, до эха его нет. */
  contact?: { user_id: number; name?: string; phone?: string }
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
