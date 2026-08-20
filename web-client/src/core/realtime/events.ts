// src/core/realtime/events.ts
import type { GeoData, MessageEntity, MessageFwdHeader, RawGeo } from '../models'
import type { Peer } from '../peers/peerId'
import type { MessagesChatFull, UserReal, UserStatus } from '../peers/peer'
import type { PeerNotifySettings } from '../dialogs/notifySettings'
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
  starReaction: 'rt:star_reaction',
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

export interface NewMessageEvt { peer_id: PeerId; msg_id: number; seq: number; sender_id: number; type: string; text: string; entities?: MessageEntity[] | null; media_id: number | null; created_at: string; thread_root_id?: number | null; reply_to_id?: number | null; reply_quote_text?: string; reply_quote_offset?: number | null;
  /** кросс-чат ответ (tweb ReplyToAnotherChat): исходный чат оригинала + готовый
   * снимок превью (имя автора + текст/медиа-лейбл) — оригинала нет в текущем чате */
  reply_to_peer_id?: Peer | null; reply_snapshot_name?: string; reply_snapshot_text?: string;
  /** атрибуция пересылки — конструктор `messageFwdHeader` (пяти плоских
   *  `fwd_from_*` на проводе больше нет, см. `core/models.ts`) */
  fwd_from?: MessageFwdHeader | null; media_unread?: boolean; sender_name?: string; grouped_id?: string | null; geo?: RawGeo | null; contact?: { user_id: number; name?: string; phone?: string } | null; gift?: import('../models').RawMessage['gift']; reply_markup?: import('../models').RawMessage['reply_markup'];
  /** Вложение live-кадра — ТОТ ЖЕ объект, что в витрине истории
   * (`messageMediaPhoto`/`messageMediaDocument` со ступенями и атрибутами).
   * Одна форма на обе витрины: без неё у ЖИВОГО сообщения не было бы ни волны
   * голосового, ни бейджа гифки, ни заслонки спойлера до перезагрузки истории
   * (тот же класс дефектов, что был у send_as), а последнее — ещё и утечка
   * того, что отправитель просил скрыть. */
  media?: import('../media/messageMedia').MessageMedia;
  // ВРЕМЕННО: плоская проекция того же вложения — бэк выводит её ИЗ `media`
  // (domain.LegacyFlatKeys). Уходит вместе с переездом потребителей на `media`.
  /** send-as (Telegram send_as): отображаемый автор (канал/группа) вместо
   * sender_id, который остаётся реальным. Бэк кладёт ключ в кадр
   * (usecase/chat/frame.go: messageUpdatePayload), и без него у живого
   * сообщения не было ни имени автора, ни правила `out` (send-as рисуется
   * ВХОДЯЩИМ даже когда отправитель — я, см. models.deriveOut) — расхождение
   * держалось до перезагрузки истории. */
  send_as?: { peer_id: PeerId; title?: string; photo_id?: number } | null;
  /** E2E-медиа секретного чата — инжектится воркером после расшифровки enc_body (не проводное поле сервера) */
  secret_media?: import('../models').SecretMedia;
  /** вид эффекта сообщения (наш аналог Telegram message effects) */
  effect?: string | null;
  /** платное медиа (Telegram paid media): цена в звёздах + заблокировано ли для
   * получателя (у заблокированного кадра media_id отсутствует) */
  paid_media?: { price: number; locked: boolean } | null;
  /** Wave 3: эхо своей отправки несёт client_msg_id → applyIncoming/reconcileAck
   * матчат оптимистичный бабл по нему (а не по фабричному tentative seq). */
  client_msg_id?: string;
  /** плотный монотонный pts (funnel-дедуп/гейт/gap). */
  pts?: number;
  /** авторитетный счётчик непрочитанных диалога (только получателям): стор берёт
   * его verbatim вместо локального +1. Отсутствует у старого бэка → fallback. */
  unread?: number }
export interface EditMessageEvt { peer_id: PeerId; msg_id: number; seq: number; text: string; entities?: MessageEntity[] | null; edited_at: string; reply_markup?: import('../models').RawMessage['reply_markup'] }
// Live-обновление координат гео-трансляции (geo_live_update).
export interface GeoLiveUpdateEvt { peer_id: PeerId; msg_id: number; seq: number; geo: RawGeo }
// Догоняющее серверное превью ссылки (web_page_update): строится после
// отправки, кадр патчит уже отрисованное сообщение карточкой web page.
export interface WebPageUpdateEvt { peer_id: PeerId; msg_id: number; seq: number; web_page: import('../models').RawWebPage }
// «Проверка фактов» прикреплена/изменена/снята (factcheck_update): кадр патчит
// блок fact-check в уже отрисованном бабле. factcheck===null — проверка снята.
export interface FactCheckUpdateEvt { peer_id: PeerId; msg_id: number; seq: number; factcheck: import('../models').RawFactCheck | null }
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
export interface DeleteMessageEvt { peer_id: PeerId; msg_id: number; seq: number; for_me: boolean }
export interface PinMessageEvt { peer_id: PeerId; msg_id: number; pinned: boolean }
export interface ReadEvt { peer_id: PeerId; user_id: number; up_to_seq: number;
  /** авторитетный счётчик непрочитанных диалога после этого read (Wave 3): стор
   * берёт его verbatim вместо локального =0. Отсутствует у старого бэка → fallback. */
  unread?: number; pts?: number }
// Голосовое/кружок прослушано получателем → у сообщения гаснет точка media_unread.
export interface MediaReadEvt { peer_id: PeerId; msg_id: number }
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
// Реакция (Wave 3, АБСОЛЮТНАЯ): counts — полный агрегат сообщения (набор
// {emoji,count}); `mine` не приходит с сервера и деривится клиентом (см.
// applyReaction). emoji/action/user_id описывают конкретное действие → нужны только
// чтобы поставить/снять `mine` у реагирующего (когда user_id===meId). Оптимистичный
// клик бродкастит этот же тип БЕЗ counts (дельта до эха) — потребитель ветвится по
// наличию counts. pts — для funnel-дедупа/гейта.
export interface ReactionEvt { peer_id: PeerId; msg_id: number; user_id: number; author_id?: number; emoji: string; action: 'add' | 'remove'; counts?: { emoji: string; count: number }[]; unread_reactions?: number; pts?: number }
// Обновление платной ⭐-реакции: новый агрегат звёзд сообщения (total) + вклад
// отправителя (mine, у sender_id). Получатель правит total; sender_id===me — и mine.
export interface StarReactionEvt { peer_id: PeerId; msg_id: number; sender_id: number; total: number; mine: number }
// Истории (Stories realtime): новая история автора / удаление / изменение реакции.
export interface StoryNewEvt { id: number; author_id: number; media_id: number; caption: string; expires_at: string }
export interface StoryDeletedEvt { story_id: number; author_id: number }
export interface StoryReactionEvt { story_id: number; user_id: number; reaction: string | null; reactions_count: number }
export interface AckEvt { client_msg_id: string; msg_id: number; seq: number; created_at: string }
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
  grouped_id?: string
  media?: PendingMedia
  /** blob-URL локального превью, сминченный воркером (см. выше) */
  local_url?: string
  geo?: GeoData
  contact?: { userId: number; name: string; phone: string }
  secret?: boolean
  send_as?: { peerId: PeerId; title: string; photoId?: number }
  /** Ответ на сообщение — в бабле СРАЗУ, до подтверждения сервера (порт tweb
   *  `generateOutgoingMessage → reply_to: generateReplyHeader(...)`,
   *  appMessagesManager.ts:2926). Сам превью-снимок (`Message.replyTo`) собирает
   *  владелец SSOT — `insertPending` резолвит оригинал по этому id в своей же
   *  Map сообщений чата. */
  reply_to_id?: number | null
  /** Текст цитаты (reply quote) — в превью бабла вместо текста оригинала. */
  reply_quote_text?: string
  /** Кросс-чат ответ: готовый снимок превью (оригинала нет в этом чате, а
   *  серверный `reply_snapshot_*` приедет только с эхом) — тот же снимок, что
   *  рисует плашка ответа в композере. */
  reply_snapshot?: { peerId: PeerId; name: string; text: string }
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
