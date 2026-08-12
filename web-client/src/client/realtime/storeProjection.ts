// Store-проектор: подписчик rootScope, чья задача — спроецировать realtime-события
// воркера в Zustand-сторы (единственный источник истины для UI). Один из равноправных
// подписчиков шины (рядом с soundSubscriber/notificationSubscriber); побочных эффектов
// (звук/уведомления) не делает. Раньше жил внутри realtimeBridge.
import { useChatsStore } from '../../stores/chatsStore'
import { useMessagesStore, winKey } from '../../stores/messagesStore'
import tabId from '../../config/tabId'
import { usePeersStore } from '../../stores/peersStore'
import { applyStateMirror } from '../../stores/appState'
import { STATE_KEYS, type AppState } from '../../core/state/state'
import { setStarsBalance } from '../../stores/starsStore'
import { mapDraft, mapGeo, mapBoostStatus, mapSuggestedPost } from '../../core/models'
import { useBoostsStore } from '../../stores/boostsStore'
import { useSuggestedPostsStore } from '../../stores/suggestedPostsStore'
import { removeDraft, setDraft } from '../../stores/draftsStore'
import { useUploadsStore } from '../../stores/uploadsStore'
import { applyMediaToken, resetMediaToken } from '../../core/mediaUrl'
import { applyMediaUrl, resetMediaUrlMirror } from '../../core/mediaCache'
import rootScope, { type BroadcastEventsListeners } from '@lib/rootScope'
import { mapReplyMarkup } from '../../core/managers/botsManager'
import { RT, type NewMessageEvt, type ReadEvt, type PresenceEvt, type TypingEvt, type AckEvt, type MessageErrorEvt, type DraftUpdateEvt, type ReactionEvt, type StarReactionEvt, type BotCallbackAnswerEvt, type StoryNewEvt, type StoryReactionEvt } from '../../core/realtime/events'
import type { MessageOp } from '../../core/realtime/messageOps'
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
  [RT.me]: (u) => { useChatsStore.getState().setMe(u) },
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
  [RT.loggingOut]: () => { resetMediaToken(); resetMediaUrlMirror() },
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
  [RT.messageOp]: (e) => { useMessagesStore.getState().applyOps(e.ops) },
  // Stage 1C.2 (Task 2): карточки пиров — владелец воркерный peersManager, он же
  // считает, что изменилось, и публикует операцию. Здесь только применение:
  // проектор — ЕДИНСТВЕННЫЙ писатель peersStore (пин — stores/noDuplicatePeers.test.ts).
  // Прежний обработчик RT.userUpdate (patch имени + refresh().then(upsert)) убран:
  // это был второй, независимый вывод того же факта, расходившийся с воркерным
  // на упавшем до-фетче аватара. Один кадр несёт одну операцию, а upsert батчевый
  // сам по себе (op.peers) — на событие приходится один set(), как и раньше.
  [RT.peerOp]: (e) => {
    const st = usePeersStore.getState()
    for (const op of e.ops) {
      if (op.op === 'upsert') st.upsert(op.peers)
      else st.patch(op.id, op.fields)
    }
  },
  // Task 2 (перенос владения диалогами): список диалогов — владелец воркерный
  // dialogsManager (порядок считает единожды он, порт tweb generateDialogIndex).
  // applyDialogOps — ЕДИНСТВЕННЫЙ вход зеркала для операций воркера; легаси-
  // мутаторы chatsStore (setDialogMuted и т.п.) пока пишут в dialogs напрямую
  // параллельно (см. докблок applyDialogOps) — их перевод на операции воркера
  // отдельными задачами (Task 4/6), поэтому строгий пин «один писатель» здесь
  // пока не заводится (в отличие от peersStore — там альтернативных писателей
  // никогда не было).
  [RT.dialogOp]: (e) => { useChatsStore.getState().applyDialogOps(e.ops) },
  [RT.chatRemoved]: (e) => useChatsStore.getState().removeDialog(e.chat_id),
  // Live-статус бустов / предложки поста (окно сообщений сюда не входит).
  [RT.boostUpdate]: (e) => { useBoostsStore.getState().applyStatus(e.chat_id, mapBoostStatus(e.status)) },
  [RT.suggestedPost]: (e) => { useSuggestedPostsStore.getState().apply(e.chat_id, mapSuggestedPost(e.post)) },
  // Тема оформления / пин / архив / mute диалога (с другого устройства/вкладки).
  [RT.chatThemeUpdate]: (e) => { useChatsStore.getState().setDialogTheme(e.chat_id, e.theme_id) },
  [RT.dialogPin]: (e) => { useChatsStore.getState().setDialogPinned(e.chat_id, e.pinned) },
  [RT.dialogArchive]: (e) => { useChatsStore.getState().setDialogArchived(e.chat_id, e.archived) },
  [RT.dialogMute]: (e) => { useChatsStore.getState().setDialogMuted(e.chat_id, e.muted) },
  // Edit/гео-трансляция — НЕ переведены на операции (см. комментарий у RT.messageOp
  // выше), окно правят из сырого кадра, как раньше.
  [RT.editMessage]: (e) => { useMessagesStore.getState().applyEdit(e.chat_id, e.msg_id, e.text, e.edited_at, e.entities ?? undefined, e.reply_markup ? mapReplyMarkup(e.reply_markup) : null) },
  [RT.geoLiveUpdate]: (e) => { useMessagesStore.getState().applyGeoLive(e.chat_id, e.msg_id, mapGeo(e.geo)) },
  // Новый баланс звёзд; удаление истории.
  [RT.balanceUpdate]: (e) => { if (typeof e.balance === 'number') setStarsBalance(e.balance) },
  [RT.storyDeleted]: (e) => { useStoriesStore.getState().removeStory(e.author_id, e.story_id) },
  // Оптимистичная отправка (воркер — funnel): вставка/медиа/ошибка/ретрай/удаление
  // бабла. storeProjection единственный писатель окна; reconcile ack/err — ниже.
  [RT.pendingNew]: (e) => {
    // localUrl (blob-URL) валиден только во вкладке-инициаторе — в остальных
    // вырезаем, иначе битый превью-бабл навсегда (localUrl приоритетнее mediaId и
    // не очищается). В своей вкладке — оставляем для мгновенного превью.
    const media = e.media && e.origin_tab !== tabId ? { ...e.media, localUrl: undefined } : e.media
    useMessagesStore.getState().appendOptimistic(winKey(e.chat_id, e.thread_root_id ?? undefined), e.text, e.sender_id, e.client_msg_id, e.media_id ?? undefined, e.type, e.entities, e.grouped_id, media, { geo: e.geo, contact: e.contact, threadRootId: e.thread_root_id ?? undefined, secret: e.secret, sendAs: e.send_as })
  },
  [RT.pendingMedia]: (e) => { useMessagesStore.getState().setOptimisticMedia(winKey(e.chat_id, e.thread_root_id ?? undefined), e.client_msg_id, e.media_id) },
  [RT.pendingFail]: (e) => { useMessagesStore.getState().failOptimistic(winKey(e.chat_id, e.thread_root_id ?? undefined), e.client_msg_id) },
  [RT.pendingRetry]: (e) => { useMessagesStore.getState().retryOptimistic(winKey(e.chat_id, e.thread_root_id ?? undefined), e.client_msg_id) },
  [RT.pendingRemove]: (e) => { useMessagesStore.getState().removeOptimistic(winKey(e.chat_id, e.thread_root_id ?? undefined), e.client_msg_id) },
}

// Регистрирует все стор-подписки на rootScope. Вызывается один раз из realtimeBridge.
export function registerStoreProjection(managers: Managers): void {
  const store = useChatsStore.getState()

  // 1:1-события (см. APPLY) — пачкой штатным методом tweb; ниже только
  // обработчики с побочными эффектами.
  rootScope.addMultipleEventsListeners(APPLY)

  rootScope.addEventListener(RT.newMessage, (m) => {
    const evt = m as NewMessageEvt
    // Stage 1B.2 (Task 4): вставку/дедуп/слияние с оптимистикой по clientId уже
    // сделала операция RT.messageOp — routeNewMessage шлёт её ПЕРВЫМ кадром, до
    // этого события (workerCore.ts:routeNewMessage), и APPLY[RT.messageOp] выше уже
    // применил её к окну. applyIncoming здесь больше не зовём — единственный
    // писатель окна для входящих теперь applyOps. markRead/unread-below решает
    // Chat (нужны scroll/focus, которых тут нет).
    const ms = useMessagesStore.getState()
    // Резолв превью ответа операция не несёт (в кадре только reply_to_id, не
    // текст/тип/автор оригинала — воркер не знает, что отрисовано на вкладке).
    // Точечно накладываем его поверх уже вставленного сообщения (по id), не
    // трогая остальные поля (localUrl/clientId/secret — их корректно перенесла
    // операция вставки).
    const rt = evt.reply_to_id != null ? ms.byKey[String(evt.chat_id)]?.msgs.find((x) => x.id === evt.reply_to_id) : undefined
    if (rt) {
      const replyTo = { msgId: rt.id, seq: rt.seq, senderId: rt.senderId, text: rt.text, type: rt.type, quoteText: evt.reply_quote_text || undefined }
      const keys = evt.thread_root_id != null ? [winKey(evt.chat_id), winKey(evt.chat_id, evt.thread_root_id)] : [winKey(evt.chat_id)]
      const ops = keys
        .map((key): MessageOp | null => {
          const cur = ms.byKey[key]?.msgs.find((x) => x.id === evt.msg_id)
          return cur ? { op: 'replace', key, msg: { ...cur, replyTo } } : null
        })
        .filter((op): op is MessageOp => op !== null)
      if (ops.length) ms.applyOps(ops)
    }
    // Сообщение в неизвестный чат = меня только что добавили в новый чат (первое
    // сообщение / сервисное «создал группу») → подтянуть список диалогов.
    // Сервисное сообщение в известный чат — признак смены метаданных группы
    // (фото/название) → тоже рефетч (дебаунс внутри).
    if (!useChatsStore.getState().dialogs.some((d) => d.chatId === evt.chat_id) || evt.type === 'service') {
      scheduleChatsReload(managers)
    }
    store.applyNewMessage(evt) // dialog-list preview (chatsStore)
    // UI-реакции на новое сообщение (read-marker/unread-pill в useChatScroll,
    // звук, нотификация) — отдельные подписчики rootScope напрямую, без
    // дублирующего тоста.
  })
  rootScope.addEventListener(RT.read, (r) => { store.applyRead(r as ReadEvt) })
  // Черновик изменён на другом устройстве/вкладке (или снят отправкой/очисткой)
  rootScope.addEventListener(RT.draftUpdate, (raw) => {
    const e = raw as DraftUpdateEvt
    if (e.draft) setDraft(mapDraft(e.draft))
    else removeDraft(e.chat_id)
  })
  rootScope.addEventListener(RT.presence, (p) => { store.setPresence(p as PresenceEvt) })
  rootScope.addEventListener(RT.typing, (raw) => {
    const t = raw as TypingEvt
    const action = t.action ?? 'typing'
    store.setTyping(t.chat_id, t.user_id, action, Date.now())
    const key = `${t.chat_id}:${t.user_id}`
    const prev = typingTimers.get(key)
    if (prev) clearTimeout(prev)
    typingTimers.set(
      key,
      setTimeout(() => {
        typingTimers.delete(key)
        store.clearTyping(t.chat_id, t.user_id)
      }, TYPING_TTL),
    )
  })
  // Реакция → окно сообщений. Серверное эхо (live/catch-up) несёт АБСОЛЮТНЫЙ агрегат
  // (counts) → set verbatim; поверх оптимистичного клика (хук) даёт тот же результат.
  rootScope.addEventListener(RT.reaction, (raw) => {
    const e = raw as ReactionEvt
    const meId = useChatsStore.getState().meId
    const isMine = e.user_id === meId
    // Серверное эхо реакции несёт АБСОЛЮТНЫЙ агрегат (counts) → ставим verbatim.
    // Оптимистику клика теперь двигает хук (applyReactionOptimistic), не воркер-эхо.
    if (e.counts) {
      useMessagesStore.getState().applyReaction(e.chat_id, e.msg_id, e.counts, isMine ? e.emoji : null, isMine ? e.action : null)
    }
    // Кто-то поставил реакцию на МОЁ сообщение → бейдж непрочитанных реакций
    // диалога (Telegram unread_reactions_count). Сброс — на прочтении чата (applyRead).
    if (e.action === 'add' && e.author_id === meId && !isMine) {
      useChatsStore.getState().bumpUnreadReactions(e.chat_id, e.unread_reactions)
    }
  })
  // Платная ⭐-реакция → окно сообщений: новый агрегат total; личный вклад mine
  // обновляем только у самого отправителя (эхо своего действия), иначе не трогаем.
  rootScope.addEventListener(RT.starReaction, (raw) => {
    const e = raw as StarReactionEvt
    const meId = useChatsStore.getState().meId
    useMessagesStore.getState().applyStarReaction(e.chat_id, e.msg_id, e.total, e.sender_id === meId ? e.mine : undefined)
  })
  // Ack/error carry only client_msg_id → reconcile by clientMsgId (store maps it to the chat).
  rootScope.addEventListener(RT.ack, (raw) => {
    const a = raw as AckEvt
    useMessagesStore.getState().reconcileAckByClient(a.client_msg_id, { msgId: a.msg_id, seq: a.seq, createdAt: a.created_at })
    // Звук подтверждения отправки («пак») — отдельный подписчик rootScope (sound).
  })
  rootScope.addEventListener(RT.messageError, (raw) => {
    const err = raw as MessageErrorEvt
    useMessagesStore.getState().failOptimisticByClient(err.client_msg_id)
    // Платное сообщение отвергнуто из-за нехватки звёзд — тост (Telegram paid messages).
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
    const r = raw as { chat_id: number; initiator_id: number; responder_id: number }
    const meId = useChatsStore.getState().meId
    // Роль решает статус: получатель видит входящий запрос ('requested' → бар с
    // «Принять/Отклонить»), инициатор ждёт ('awaiting'). Живьём сервер шлёт кадр
    // только получателю; при reload оба состояния восстанавливает secret.sync().
    if (meId === r.responder_id) {
      useSecretChatStore.getState().setStatus(r.chat_id, 'requested')
      // Живьём чат ещё не в списке диалогов у получателя — подтянуть /chats, чтобы
      // строка-заявка появилась сверху (дебаунс внутри). Статус 'requested' даёт
      // pending-превью «Приглашение в секретный чат» в ChatListItem.
      if (!useChatsStore.getState().dialogs.some((d) => d.chatId === r.chat_id)) {
        scheduleChatsReload(managers)
      }
    } else if (meId === r.initiator_id) {
      useSecretChatStore.getState().setStatus(r.chat_id, 'awaiting')
    }
  })
  rootScope.addEventListener(RT.secretAccept, (raw) => {
    const r = raw as { chat_id: number; state?: string; fingerprint?: string[] }
    useSecretChatStore.getState().setStatus(r.chat_id, 'established')
    if (r.fingerprint) useSecretChatStore.getState().setFingerprint(r.chat_id, r.fingerprint)
  })
  rootScope.addEventListener(RT.secretReject, (raw) => {
    const r = raw as { chat_id: number }
    useSecretChatStore.getState().setStatus(r.chat_id, 'rejected')
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
  // Прогресс отгрузки медиа (кольцо на оптимистичном бабле)
  rootScope.addEventListener('media:upload_progress', (raw) => {
    const e = raw as { id: string; loaded: number; total: number }
    if (e.total > 0) useUploadsStore.getState().setProgress(e.id, e.loaded / e.total)
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
