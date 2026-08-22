// Store-проектор: подписчик rootScope, чья задача — спроецировать realtime-события
// воркера в Zustand-сторы (единственный источник истины для UI). Один из равноправных
// подписчиков шины (рядом с soundSubscriber/notificationSubscriber); побочных эффектов
// (звук/уведомления) не делает. Раньше жил внутри realtimeBridge.
import { useChatsStore } from '../../stores/chatsStore'
import { useMessagesStore } from '../../stores/messagesStore'
import { applyPeerOps, resetPeerMirror } from '../../core/peerCache'
import { applyChatTheme, resetChatFullMirror } from '../../core/chatFullCache'
import { applyStateMirror } from '../../stores/appState'
import { STATE_KEYS, type AppState } from '../../core/state/state'
import { setStarsBalance } from '../../stores/starsStore'
import { mapDraftMessage, mapBoostStatus, mapSuggestedPost, mapMessage, mapReactions } from '../../core/models'
import { generateMessageId } from '../../core/history/messageId'
import { getPeerId } from '../../core/peers/peerId'
import { useBoostsStore } from '../../stores/boostsStore'
import { useSuggestedPostsStore } from '../../stores/suggestedPostsStore'
import { removeDraft, setDraft } from '../../stores/draftsStore'
import { useUploadsStore } from '../../stores/uploadsStore'
import { applyMediaToken, resetMediaToken } from '../../core/mediaUrl'
import { applyMediaUrl, resetMediaUrlMirror } from '../../core/mediaCache'
import { resetPlayback } from '../../core/audio/mediaPlaybackController'
import { applyOpsToMirror, resetMessagesMirror } from '../../core/history/messagesMirror'
import rootScope, { type BroadcastEventsListeners } from '@lib/rootScope'
import { RT, type NewMessageEvt, type PresenceEvt, type TypingEvt, type MessageErrorEvt, type DraftUpdateEvt, type ReactionEvt, type BotCallbackAnswerEvt, type StoryNewEvt, type StoryReactionEvt } from '../../core/realtime/events'
import { useSecretChatStore } from '../../stores/secretChatStore'
import { useStoriesStore, loadStories } from '../../stores/storiesStore'
import { mapStory } from '../../core/managers/storiesManager'
import type { Managers } from '../bootstrap'
import { scheduleChatsReload } from './refetchSubscriber'

// A typing indicator with no follow-up clears itself after this long (the server
// emits no "stopped typing" frame; the client re-sends every ~3s while active).
const TYPING_TTL = 6000
const typingTimers = new Map<string, ReturnType<typeof setTimeout>>()

// Реестр «1:1» — типы аргументов приходят из BroadcastEventsListeners, ручные
// касты не нужны; пропущенное/переименованное событие ловит компилятор.
type Projector = { [K in keyof BroadcastEventsListeners]?: BroadcastEventsListeners[K] }

// Реестр «1:1» обработчиков: событие → одна мутация стора, без побочных эффектов.
// Добавить такое событие = одна строка здесь (подписка — addMultipleEventsListeners).
// Обработчики с таймерами/тостами/meId/сетью/движками остаются явными ниже.
const APPLY: Projector = {
  // Stage 1C.2 (Task 1): `me`/`meId` — воркер единственный владелец
  // (workerCore.ts::setMe), публикует на старте и на каждой RPC-мутации
  // профиля/премиума/логаута. chatsStore.setMe — единый писатель (meId
  // выводится из me внутри него же); прямые вызовы из компонентов вне этого
  // проектора допустимы только как allow-listed оптимистичное исключение (см.
  // stores/noDuplicateMe.test.ts).
  // Два зеркала одного факта — ОДИН писатель (как [RT.messageOp] ниже пишет и
  // стор, и messagesMirror): `chatsStore.meId` для React-витрины и
  // `rootScope.myId` для императивного кода (лента `chat/bubbles.ts`, порт tweb,
  // читает его синхронно на рендере бабла). В tweb `myId` пишет сам rootScope из
  // подписки на `user_auth` — у нас это был бы второй писатель факта `me` мимо
  // проектора; расхождение сознательное, разбор — в докблоке поля (lib/rootScope.ts).
  [RT.me]: (u) => { useChatsStore.getState().setMe(u); rootScope.myId = u?.user.id ?? 0 },
  // Stage 1C.2 (Task 3): медиа-токен — воркер единственный владелец
  // (mediaManager::fetchToken публикует при получении и при каждом плановом
  // обновлении). core/mediaUrl.ts — зеркало: applyMediaToken кладёт снимок и
  // будит медиа-баблы, чтобы те пересобрали <img src> со свежим токеном.
  [RT.mediaToken]: (t) => { applyMediaToken(t) },
  // Task 6: objectURL скачанного медиа — воркер единственный владелец
  // (mediaManager::downloadMediaURL публикует при каждом созданном URL).
  // core/mediaCache.ts — зеркало: applyMediaUrl кладёт снимок, cachedMediaUrl
  // отдаёт его синхронно на рендере (потребители — Task 7).
  [RT.mediaUrl]: (e) => { applyMediaUrl(e) },
  // Обратная сторона той же собственности: активная сессия ушла (логаут,
  // переезд на другой аккаунт, отозванная сессия) — снимок в зеркале подписан
  // на ПРОШЛОГО пользователя и живёт ещё до 15 минут. Владелец свой токен
  // выбросил сам (workerCore.ts), а зеркало он не спрашивает — оно отдаёт токен
  // синхронно на рендере, поэтому переход обязан доехать сюда кадром. Реакция
  // считается не из значения (`me`), а из объявленного намерения — по той же
  // причине, что в useAuthGate: из снимка пользователя переход не выводится.
  // Парного [RT.loggedIn] здесь нет сознательно (у владельца он есть):
  // активный токен не появляется, не уйдя перед этим, — любой вход идёт с
  // экрана входа, куда вкладку привёл этот самый кадр, уже сбросивший зеркало.
  // Второе зеркало того же кадра (Task 6): blob:-URL медиа — владелец их уже
  // отозвал (resetDownloads), витрина обязана перестать их отдавать.
  // Третье зеркало того же кадра (этап «лента на императивном DOM»): окна
  // сообщений прошлой сессии — лента читает их синхронно на рендере, поэтому
  // чужая история обязана исчезнуть тем же кадром.
  // Зеркала прошлой сессии обязаны исчезнуть: их читают СИНХРОННО на рендере, и
  // без сброса следующий аккаунт увидит чужие карточки/историю/медиа-URL (у
  // пиров это ещё и `avatarUrl`, приватный per-viewer).
  // Четвёртое зеркало того же кадра: коллекция медиа-элементов плеера
  // (core/audio/mediaPlaybackController) — её элементы держат URL'ы прошлой
  // сессии (токен-стрим, blob расшифрованного секретного голоса) и продолжают
  // играть после логаута, если их не снять.
  [RT.loggingOut]: () => { resetMediaToken(); resetMediaUrlMirror(); resetMessagesMirror(); resetPeerMirror(); resetChatFullMirror(); resetPlayback() },
  // Stage 1B.2 (Task 4): операции воркера (mirror-протокол, порт tweb SlicedArray)
  // переигрываются поверх окон — единственный писатель окна для входящих
  // сообщений (заменяет прямой applyIncoming из обработчика RT.newMessage ниже).
  // Stage 1B.3 (Task 3): media_read/delete_message/web_page_update/factcheck_update/
  // paid_media_unlock тоже переехали на эту операцию (patch/remove) — их прежние
  // 1:1-строки убраны отсюда (и отдельный addEventListener(RT.paidMediaUnlock) ниже),
  // окно правит только applyOps. Stage 1B.3 (Task 4): poll_update/checklist_update/
  // giveaway_update — туда же (см. комментарий у cachePoll/cacheChecklist/
  // cacheGiveaway, pollMethods.ts); их прежние 1:1-строки [RT.pollUpdate]/
  // [RT.checklistUpdate]/[RT.giveawayUpdate] тоже убраны отсюда — иначе вышло бы
  // двойное применение (patch операцией ЗДЕСЬ + applyXUpdate той же строкой).
  // edit_message/geo_live_update НЕ переведены — см. комментарии у
  // messages.cacheEdit/cacheGeoLive (messagesManager.ts). reaction/star_reaction —
  // тоже НЕ переведены (Stage 1B.3, Task 5), обработчики ниже остаются на сыром кадре.
  // Этап «оптимистика в воркере»: этой же операцией приезжает и временный бабл
  // своей отправки (insert), и его ack (insert финального), и ошибка (patch
  // {failed}), и отмена (remove) — пяти кадров rt:pending_* больше нет, окно
  // правит ТОЛЬКО applyOps без исключений. Вкладочных обогащений здесь тоже
  // больше НЕТ: blob-URL локального превью (`localUrl`) минтит воркер внутри
  // messages.sendFile, поэтому он приезжает обычным полем операции.
  // Этап «лента на императивном DOM» (шаг 1): та же пачка операций едет во
  // ВТОРУЮ копию окна — НЕреактивное зеркало главного потока
  // (core/history/messagesMirror.ts, порт apiManagerProxy.mirrors), которое
  // читает синхронно императивная лента и которое объявляет изменения
  // событиями history_append/history_update/message_edit/history_delete.
  // Обе копии правит одна точка (эта строка) одной и той же чистой applyOp —
  // заводить второй вход в зеркало нельзя, копии разъедутся.
  [RT.messageOp]: (e) => { useMessagesStore.getState().applyOps(e.ops); applyOpsToMirror(e.ops) },
  // Stage 1C.2 (Task 2): карточки пиров — владелец воркерный peersManager, он же
  // считает, что изменилось, и публикует операцию. Здесь только применение:
  // проектор — ЕДИНСТВЕННЫЙ писатель зеркала (пин — core/noDuplicatePeers.test.ts).
  // Прежний обработчик RT.userUpdate (patch имени + refresh().then(upsert)) убран:
  // это был второй, независимый вывод того же факта, расходившийся с воркерным
  // на упавшем до-фетче аватара. Один кадр несёт одну операцию, а зеркало будит
  // подписчиков один раз на пачку — как и раньше один set() на событие.
  // Зеркало — обычный модуль (core/peerCache.ts), а не zustand: карточку читает
  // и императивная лента, которой стор запрещён (докблок peerCache.ts).
  [RT.peerOp]: (e) => { applyPeerOps(e.ops) },
  // Task 2 (перенос владения диалогами): список диалогов — владелец воркерный
  // dialogsManager (порядок считает единожды он, порт tweb generateDialogIndex).
  // applyDialogOps — единственный вход зеркала для операций воркера. Task 6
  // снесла легаси-мутаторы chatsStore (setDialogs/applyDialogs и т.п.), которые
  // раньше писали в dialogs напрямую параллельно — пин «один писатель» (плюс
  // allow-listed client/boot.ts и core/hooks/useAuthGate.ts, см. докблок там же)
  // держит stores/noDuplicateDialogs.test.ts, как и у зеркала пиров.
  [RT.dialogOp]: (e) => { useChatsStore.getState().applyDialogOps(e.ops) },
  // Task 3 (realtime-кадры применяет владелец): удаление диалога (chat_removed)
  // теперь тоже операция владельца (dialogsManager.applyRemoved → rt:dialog_op
  // remove), применённая ДО этого сырого кадра в workerCore.ts::dispatch —
  // строка [RT.chatRemoved] здесь была вторым, main-side выводом того же факта.
  // Live-статус бустов / предложки поста (окно сообщений сюда не входит).
  [RT.boostUpdate]: (e) => { useBoostsStore.getState().applyStatus(e.peer_id, mapBoostStatus(e.status)) },
  [RT.suggestedPost]: (e) => { useSuggestedPostsStore.getState().apply(e.peer_id, mapSuggestedPost(e.post)) },
  // Task 4 (действия без оптимистики): пин / архив / mute диалога (с другого
  // устройства/вкладки) применяет владелец (workerCore.ts::dispatch →
  // dialogs.applyPinned/applyArchived/applyNotifySettings → rt:dialog_op) —
  // строки [RT.dialogPin]/[RT.dialogArchive]/[RT.dialogMute] здесь были вторым,
  // main-side выводом того же факта через мутаторы chatsStore (удалены вместе
  // с этими строками).
  //
  // Тема оформления — ИСКЛЮЧЕНИЕ, и оно от решения Р7: её место в схеме не
  // строка диалога, а полная карточка (`chatFull`/`userFull.theme_emoticon`),
  // владельца-в-воркере у карточек нет, а единственное её зеркало —
  // `core/chatFullCache.ts` здесь, на главном потоке. Патчим ту же карточку, а
  // не заводим рядом второе хранилище тем.
  [RT.chatThemeUpdate]: (e) => { applyChatTheme(e.peer_id, e.theme_id) },
  // Edit/гео-трансляция — НЕ переведены на операции (см. комментарий у RT.messageOp
  // выше), окно правят из сырого кадра, как раньше.
  // Номер в кадре СЕРВЕРНЫЙ, в окне — клиентский: перевод на границе, как везде
  // (`core/history/messageId.ts`).
  // Правка приезжает сообщением ЦЕЛИКОМ — разбирает его тот же маппер, что и
  // историю; стор получает уже значения полей, а не россыпь ключей конверта.
  [RT.editMessage]: (e) => {
    const m = mapMessage(e.message, useChatsStore.getState().me?.user.id ?? null)
    if (m._ !== 'message') return
    useMessagesStore.getState().applyEdit(getPeerId(e.message.peer_id), m.id, m.message ?? '', m.edit_date, m.entities, m.reply_markup ?? null)
  },
  [RT.geoLiveUpdate]: (e) => { useMessagesStore.getState().applyGeoLive(e.peer_id, generateMessageId(e.id), e.media, e.edit_date) },
  // Новый баланс звёзд; удаление истории.
  [RT.balanceUpdate]: (e) => { if (typeof e.balance === 'number') setStarsBalance(e.balance) },
  [RT.storyDeleted]: (e) => { useStoriesStore.getState().removeStory(e.author_id, e.story_id) },
}

// Регистрирует все стор-подписки на rootScope. Вызывается один раз из realtimeBridge.
export function registerStoreProjection(managers: Managers): void {
  const store = useChatsStore.getState()

  // 1:1-события (см. APPLY) — пачкой штатным методом tweb; ниже только
  // обработчики с побочными эффектами.
  rootScope.addMultipleEventsListeners(APPLY)

  rootScope.addEventListener(RT.newMessage, (m) => {
    const evt = m as NewMessageEvt
    // Stage 1B.2 (Task 4): вставку/дедуп/слияние с оптимистикой по random_id уже
    // сделала операция RT.messageOp — routeNewMessage шлёт её ПЕРВЫМ кадром, до
    // этого события (workerCore.ts:routeNewMessage), и APPLY[RT.messageOp] выше уже
    // применил её к окну. markRead/unread-below решает Chat (нужны scroll/focus,
    // которых тут нет).
    //
    // ИСКЛЮЧЕНИЯ «точечный replace ради превью ответа» здесь БОЛЬШЕ НЕТ. Оно
    // существовало ровно потому, что `reply_to` ехал СНИМКОМ, собранным
    // сервером, а живой кадр снимка не нёс — вкладке приходилось достраивать
    // его из своего окна поверх уже вставленного сообщения. Теперь `reply_to`
    // это ССЫЛКА (решение Р4), и превью строит тот, кто рисует, разрешая номер
    // в своём окне (`messageToConvMsg(opts.replyToMessage)`). Окно правит
    // ТОЛЬКО applyOps, без исключений.
    const msg = evt.message
    const peerId = getPeerId(msg._ === 'messageEmpty' ? undefined : msg.peer_id)
    // Сообщение в неизвестный чат = меня только что добавили в новый чат (первое
    // сообщение / сервисное «создал группу») → подтянуть список диалогов.
    // Сервисное сообщение в известный чат — признак смены метаданных группы
    // (фото/название) → тоже рефетч (дебаунс внутри). «Служебное ли» — ВЫБОР
    // КОНСТРУКТОРА, а не значение снятого поля `type`.
    if (!useChatsStore.getState().dialogs.some((d) => d.peerId === peerId) || msg._ === 'messageService') {
      scheduleChatsReload(managers)
    }
    // Task 3: превью/unread диалога в списке теперь применяет владелец
    // (workerCore.ts::routeNewMessage → dialogs.applyNewMessage → rt:dialog_op),
    // строка store.applyNewMessage здесь была вторым, main-side выводом того же факта.
    // Чистка typing-индикатора отправителя на новом сообщении — эфемерика (см.
    // «Осторожно» #2 задачи 3), остаётся на main: раньше жила внутри
    // chatsStore.applyNewMessage, теперь вызывается отсюда напрямую.
    if (msg._ !== 'messageEmpty' && msg.from_id) store.clearTyping(peerId, getPeerId(msg.from_id))
    // UI-реакции на новое сообщение (read-marker/unread-pill в useChatScroll,
    // звук, нотификация) — отдельные подписчики rootScope напрямую, без
    // дублирующего тоста.
  })
  // Task 3: rt:read теперь применяет владелец (workerCore.ts::dispatch →
  // dialogs.applyRead → rt:dialog_op) — строка store.applyRead здесь была
  // вторым, main-side выводом того же факта. Кадр rt:read на main больше не
  // нужен (единственным потребителем и был этот обработчик).
  // Черновик изменён на другом устройстве/вкладке (или снят отправкой/очисткой)
  rootScope.addEventListener(RT.draftUpdate, (raw) => {
    const e = raw as DraftUpdateEvt
    const peerId = getPeerId(e.peer)
    const draft = mapDraftMessage(peerId, e.draft)
    if (draft) setDraft(draft)
    else removeDraft(peerId)
  })
  rootScope.addEventListener(RT.presence, (p) => { store.setPresence(p as PresenceEvt) })
  rootScope.addEventListener(RT.typing, (raw) => {
    const t = raw as TypingEvt
    const action = t.action ?? 'typing'
    store.setTyping(t.peer_id, t.user_id, action, Date.now())
    const key = `${t.peer_id}:${t.user_id}`
    const prev = typingTimers.get(key)
    if (prev) clearTimeout(prev)
    typingTimers.set(
      key,
      setTimeout(() => {
        typingTimers.delete(key)
        store.clearTyping(t.peer_id, t.user_id)
      }, TYPING_TTL),
    )
  })
  // Реакция → окно сообщений. Кадр несёт АБСОЛЮТНОЕ состояние агрегата тем же
  // конструктором, что едет внутри сообщения, и помечен `pFlags.min`: моего
  // выбора в общем теле нет и быть не может, поэтому `mine` сохраняется из
  // окна, а не берётся из кадра. Оптимистику клика двигает хук
  // (applyReactionOptimistic) — здесь только серверное состояние.
  rootScope.addEventListener(RT.reaction, (raw) => {
    const e = raw as ReactionEvt
    // Платная ⭐-реакция приезжает ЭТИМ ЖЕ кадром — чипом reactionPaid того же
    // агрегата, а не своим типом: своего конструктора у неё в схеме нет.
    const { reactions, starReaction } = mapReactions(e.reactions)
    useMessagesStore.getState()
      .applyReaction(getPeerId(e.peer), generateMessageId(e.msg_id), reactions ?? [], starReaction?.total ?? 0)
  })
  // RT.ack здесь больше не слушается: сверку бабла с сервером делает владелец
  // (workerCore.ts::onFrame → messages.ackPendingMessage), а окно правит его
  // операция. У кадра остался ровно один потребитель на витрине — звук
  // подтверждения отправки («пак»), см. soundSubscriber.
  rootScope.addEventListener(RT.messageError, (raw) => {
    const err = raw as MessageErrorEvt
    // Пометку failed на бабле ставит владелец (messages.failPendingMessage,
    // тот же onFrame) — здесь осталась только реакция витрины: платное
    // сообщение отвергнуто из-за нехватки звёзд (Telegram paid messages).
    if (err.reason === 'paid_required') rootScope.dispatchEvent('ui:toast', 'Недостаточно звёзд для отправки сообщения')
  })
  // RT.paidMediaUnlock: раньше отдельный addEventListener строил incoming через
  // fromNewMessageEvt и звал applyPaidUnlock — теперь окно правит operation-based
  // патч (cachePaidUnlock → RT.messageOp → applyOps), см. комментарий у RT.messageOp
  // выше (Stage 1B.3, Task 3).
  // Поздний ответ бота на callback (после таймаута синхронного ожидания) — тост.
  rootScope.addEventListener(RT.botCallbackAnswer, (raw) => {
    const a = raw as BotCallbackAnswerEvt
    if (a.text) rootScope.dispatchEvent('ui:toast', a.text)
  })
  // Секретный чат: handshake-события из воркера → secretChatStore.
  rootScope.addEventListener(RT.secretRequest, (raw) => {
    const r = raw as { peer_id: PeerId; initiator_id: number; responder_id: number }
    const meId = useChatsStore.getState().meId
    // Роль решает статус: получатель видит входящий запрос ('requested' → бар с
    // «Принять/Отклонить»), инициатор ждёт ('awaiting'). Живьём сервер шлёт кадр
    // только получателю; при reload оба состояния восстанавливает secret.sync().
    if (meId === r.responder_id) {
      useSecretChatStore.getState().setStatus(r.peer_id, 'requested')
      // Живьём чат ещё не в списке диалогов у получателя — подтянуть /chats, чтобы
      // строка-заявка появилась сверху (дебаунс внутри). Статус 'requested' даёт
      // pending-превью «Приглашение в секретный чат» в ChatListItem.
      if (!useChatsStore.getState().dialogs.some((d) => d.peerId === r.peer_id)) {
        scheduleChatsReload(managers)
      }
    } else if (meId === r.initiator_id) {
      useSecretChatStore.getState().setStatus(r.peer_id, 'awaiting')
    }
  })
  rootScope.addEventListener(RT.secretAccept, (raw) => {
    const r = raw as { peer_id: PeerId; state?: string; fingerprint?: string[] }
    useSecretChatStore.getState().setStatus(r.peer_id, 'established')
    if (r.fingerprint) useSecretChatStore.getState().setFingerprint(r.peer_id, r.fingerprint)
  })
  rootScope.addEventListener(RT.secretReject, (raw) => {
    const r = raw as { peer_id: PeerId }
    useSecretChatStore.getState().setStatus(r.peer_id, 'rejected')
  })
  // Истории (Stories realtime) → storiesStore. Новая история известного автора
  // добавляется в его группу; для нового автора (группы ещё нет) — полный рефетч
  // ленты (нужны имя/аватар автора). Удаление и реакции правят стор точечно.
  rootScope.addEventListener(RT.storyNew, (raw) => {
    const e = raw as StoryNewEvt
    const st = useStoriesStore.getState()
    const hasGroup = st.groups.some((g) => g.author.id === e.author_id)
    if (hasGroup) {
      st.addStory(e.author_id, mapStory({ id: e.id, media_id: e.media_id, caption: e.caption, created_at: new Date().toISOString(), viewed: false }))
    } else {
      void loadStories(managers)
    }
  })
  rootScope.addEventListener(RT.storyReaction, (raw) => {
    const e = raw as StoryReactionEvt
    const meId = useChatsStore.getState().meId
    // myReaction обновляем только для эха собственного действия (user_id === me).
    useStoriesStore.getState().applyStoryReaction(e.story_id, e.reactions_count, e.user_id === meId ? e.reaction : undefined)
  })
  // Прогресс отгрузки медиа (кольцо на оптимистичном бабле). Владелец — воркер:
  // и сами байты, и границы аплоада теперь его (messages.sendFile), поэтому
  // `done` (аплоад кончился успехом/ошибкой/отменой) приезжает тем же каналом,
  // а не снимается вкладкой у себя.
  rootScope.addEventListener('media:upload_progress', (raw) => {
    const e = raw as { id: string; loaded: number; total: number; done?: boolean }
    if (e.done) useUploadsStore.getState().clear(e.id)
    else if (e.total > 0) useUploadsStore.getState().setProgress(e.id, e.loaded / e.total)
  })

  // Ключ State изменила ДРУГАЯ вкладка: воркер разослал зеркало всем портам
  // (порт tweb apiManagerProxy.processMirrorTaskMap.state, :235-241). Применяем
  // молча — обратная запись замкнула бы цикл вкладка → воркер → вкладка, а диск
  // уже записан инициатором.
  //
  // Ключ сверяем со схемой: через RPC-границу приходит строка, и чужой ключ
  // положил бы в State мусор, который потом уехал бы на диск первым же
  // write-through соседнего ключа.
  rootScope.addEventListener('state:mirror', (raw) => {
    const e = raw as { key?: string; value?: unknown }
    if (!e.key || !STATE_KEYS.includes(e.key as keyof AppState)) return
    applyStateMirror(e.key as keyof AppState, e.value as AppState[keyof AppState])
  })
}
