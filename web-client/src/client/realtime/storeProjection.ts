// Store-проектор: подписчик eventBus, чья задача — спроецировать realtime-события
// воркера в Zustand-сторы (единственный источник истины для UI). Один из равноправных
// подписчиков шины (рядом с soundSubscriber/notificationSubscriber); побочных эффектов
// (звук/уведомления) не делает. Раньше жил внутри realtimeBridge.
import { loadChats, useChatsStore } from '../../stores/chatsStore'
import { useMessagesStore } from '../../stores/messagesStore'
import { usePinsStore } from '../../stores/pinsStore'
import { useStarsStore } from '../../stores/starsStore'
import { fromNewMessageEvt, mapDraft, mapPoll, mapChecklist, mapGeo, mapWebPage, mapFactCheck, mapBoostStatus, mapGiveaway, mapSuggestedPost, type RawPoll, type RawChecklist, type RawBoostStatus, type RawGiveaway } from '../../core/models'
import { useBoostsStore } from '../../stores/boostsStore'
import { useSuggestedPostsStore } from '../../stores/suggestedPostsStore'
import { useDraftsStore } from '../../stores/draftsStore'
import { useUploadsStore } from '../../stores/uploadsStore'
import { uiEvents } from '../../core/hooks/uiEvents'
import { mapReplyMarkup } from '../../core/managers/botsManager'
import { RT, type NewMessageEvt, type ReadEvt, type MediaReadEvt, type ChatRemovedEvt, type PresenceEvt, type TypingEvt, type AckEvt, type MessageErrorEvt, type EditMessageEvt, type DeleteMessageEvt, type PinMessageEvt, type CallFrameEvt, type DraftUpdateEvt, type ReactionEvt, type StarReactionEvt, type BotCallbackAnswerEvt, type GeoLiveUpdateEvt, type WebPageUpdateEvt, type FactCheckUpdateEvt, type ChatThemeUpdateEvt, type SuggestedPostEvt, type StoryNewEvt, type StoryDeletedEvt, type StoryReactionEvt } from '../../core/realtime/events'
import { useSecretChatStore } from '../../stores/secretChatStore'
import { useStoriesStore, loadStories } from '../../stores/storiesStore'
import { mapStory } from '../../core/managers/storiesManager'
import * as callEngine from '../../core/calls/callEngine'
import { handleGroupCallFrame, type GroupCallFrame } from '../../core/calls/groupCallEngine'
import { handleLivestreamFrame, type LivestreamFrame } from '../../core/calls/livestreamEngine'
import { eventBus } from '../../core/realtime/eventBus'
import type { Managers } from '../bootstrap'

// A typing indicator with no follow-up clears itself after this long (the server
// emits no "stopped typing" frame; the client re-sends every ~3s while active).
const TYPING_TTL = 6000
const typingTimers = new Map<string, ReturnType<typeof setTimeout>>()

// Debounced dialog-list refetch for messages arriving into unknown chats (a burst
// of frames after being added to a group must not spawn N parallel reloads).
let chatsReloadTimer: ReturnType<typeof setTimeout> | null = null
function scheduleChatsReload(managers: Parameters<typeof loadChats>[0]): void {
  if (chatsReloadTimer) return
  chatsReloadTimer = setTimeout(() => {
    chatsReloadTimer = null
    void loadChats(managers)
  }, 300)
}

// Реестр «1:1» обработчиков: событие → одна мутация стора, без побочных эффектов.
// Добавить такое событие = одна строка здесь (подписка — циклом в registerStoreProjection).
// Обработчики с таймерами/uiEvents/meId/сетью/движками остаются явными ниже.
const APPLY: Record<string, (raw: unknown) => void> = {
  [RT.mediaRead]: (raw) => { const e = raw as MediaReadEvt; useMessagesStore.getState().applyMediaRead(e.chat_id, e.msg_id) },
  [RT.chatRemoved]: (raw) => useChatsStore.getState().removeDialog((raw as ChatRemovedEvt).chat_id),
  // Live-агрегаты опроса / чек-листа / розыгрыша / бустов / предложки поста.
  [RT.pollUpdate]: (raw) => { const e = raw as { chat_id: number; poll: RawPoll }; useMessagesStore.getState().applyPollUpdate(e.chat_id, mapPoll(e.poll)) },
  // Эхо своего голоса → полная установка опроса (myVotes из ответа сервера).
  [RT.pollVoted]: (raw) => { const e = raw as { chat_id: number; poll: RawPoll }; useMessagesStore.getState().setPoll(e.chat_id, mapPoll(e.poll)) },
  [RT.checklistUpdate]: (raw) => { const e = raw as { chat_id: number; checklist: RawChecklist }; useMessagesStore.getState().applyChecklistUpdate(e.chat_id, mapChecklist(e.checklist)) },
  [RT.boostUpdate]: (raw) => { const e = raw as { chat_id: number; status: RawBoostStatus }; useBoostsStore.getState().applyStatus(e.chat_id, mapBoostStatus(e.status)) },
  [RT.giveawayUpdate]: (raw) => { const e = raw as { chat_id: number; giveaway: RawGiveaway }; useMessagesStore.getState().applyGiveawayUpdate(e.chat_id, mapGiveaway(e.giveaway)) },
  [RT.suggestedPost]: (raw) => { const e = raw as SuggestedPostEvt; useSuggestedPostsStore.getState().apply(e.chat_id, mapSuggestedPost(e.post)) },
  // Тема оформления / пин / архив / mute диалога (с другого устройства/вкладки).
  [RT.chatThemeUpdate]: (raw) => { const e = raw as ChatThemeUpdateEvt; useChatsStore.getState().setDialogTheme(e.chat_id, e.theme_id) },
  [RT.dialogPin]: (raw) => { const e = raw as { chat_id: number; pinned: boolean }; useChatsStore.getState().setDialogPinned(e.chat_id, e.pinned) },
  [RT.dialogArchive]: (raw) => { const e = raw as { chat_id: number; archived: boolean }; useChatsStore.getState().setDialogArchived(e.chat_id, e.archived) },
  [RT.dialogMute]: (raw) => { const e = raw as { chat_id: number; muted: boolean }; useChatsStore.getState().setDialogMuted(e.chat_id, e.muted) },
  // Edit/delete/гео-трансляция/web-page/fact-check → окно сообщений чата.
  [RT.editMessage]: (raw) => { const e = raw as EditMessageEvt; useMessagesStore.getState().applyEdit(e.chat_id, e.msg_id, e.text, e.edited_at, e.entities ?? undefined, e.reply_markup ? mapReplyMarkup(e.reply_markup) : null) },
  [RT.deleteMessage]: (raw) => { const e = raw as DeleteMessageEvt; useMessagesStore.getState().applyDelete(e.chat_id, e.msg_id) },
  [RT.geoLiveUpdate]: (raw) => { const e = raw as GeoLiveUpdateEvt; useMessagesStore.getState().applyGeoLive(e.chat_id, e.msg_id, mapGeo(e.geo)) },
  [RT.webPageUpdate]: (raw) => { const e = raw as WebPageUpdateEvt; useMessagesStore.getState().applyWebPage(e.chat_id, e.msg_id, mapWebPage(e.web_page)) },
  [RT.factCheckUpdate]: (raw) => { const e = raw as FactCheckUpdateEvt; useMessagesStore.getState().applyFactCheck(e.chat_id, e.msg_id, e.factcheck ? mapFactCheck(e.factcheck) : undefined) },
  // Новый баланс звёзд; удаление истории.
  [RT.balanceUpdate]: (raw) => { const b = (raw as { balance: number }).balance; if (typeof b === 'number') useStarsStore.getState().setBalance(b) },
  [RT.storyDeleted]: (raw) => { const e = raw as StoryDeletedEvt; useStoriesStore.getState().removeStory(e.author_id, e.story_id) },
}

// Регистрирует все стор-подписки на eventBus. Вызывается один раз из realtimeBridge.
export function registerStoreProjection(managers: Managers): void {
  const store = useChatsStore.getState()

  // 1:1-события (см. APPLY) — одним циклом; ниже только обработчики с побочными эффектами.
  for (const [ev, fn] of Object.entries(APPLY)) eventBus.subscribe(ev, fn)

  eventBus.subscribe(RT.newMessage, (m) => {
    const evt = m as NewMessageEvt
    // Append to the chat's message window (single source of truth). Resolve the
    // reply preview from the already-loaded window so a reply shows its quote
    // immediately (applyIncoming no-ops if the window isn't loaded). markRead /
    // unread-below is decided in ConversationView (it needs scroll/focus state).
    const ms = useMessagesStore.getState()
    const rt = evt.reply_to_id != null ? ms.byKey[String(evt.chat_id)]?.msgs.find((x) => x.id === evt.reply_to_id) : undefined
    // Резолвим превью ответа из уже загруженного окна, чтобы ответ показал цитату
    // сразу (в кадре её нет). Маппинг кадра → Message + инжект secret_media внутри
    // fromNewMessageEvt (единый источник, см. models.ts).
    const replyTo = rt ? { msg_id: rt.id, seq: rt.seq, sender_id: rt.senderId, text: rt.text, type: rt.type, quote_text: evt.reply_quote_text || undefined } : null
    const incoming = fromNewMessageEvt(evt, replyTo)
    ms.applyIncoming(evt.chat_id, incoming) // дедупит по seq — для backfill no-op
    // backfill (catch-up после reconnect, уже доставляли вживую): окно дедупнуто —
    // превью диалога, счётчик непрочитанных, всплытие диалога наверх и уведомление
    // компонентов (unread-below в useChatScroll) НЕ повторяем, иначе бейдж/список
    // инфлейтят на каждый reconnect. Звук/нотификация гейтятся в своих подписчиках.
    if (evt.backfill) return
    // Сообщение в неизвестный чат = меня только что добавили в новый чат (первое
    // сообщение / сервисное «создал группу») → подтянуть список диалогов.
    // Сервисное сообщение в известный чат — признак смены метаданных группы
    // (фото/название) → тоже рефетч (дебаунс внутри).
    if (!useChatsStore.getState().dialogs.some((d) => d.chatId === evt.chat_id) || evt.type === 'service') {
      scheduleChatsReload(managers)
    }
    store.applyNewMessage(evt) // dialog-list preview (chatsStore)
    // Уведомляем компоненты (напр. useChatScroll) через uiEvents. Звук/эффект и
    // браузерное уведомление — отдельные подписчики eventBus (sound/notification).
    uiEvents.emit(RT.newMessage, m)
  })
  eventBus.subscribe(RT.read, (r) => { store.applyRead(r as ReadEvt); uiEvents.emit(RT.read, r) })
  // Черновик изменён на другом устройстве/вкладке (или снят отправкой/очисткой)
  eventBus.subscribe(RT.draftUpdate, (raw) => {
    const e = raw as DraftUpdateEvt
    const st = useDraftsStore.getState()
    if (e.draft) st.setDraft(mapDraft(e.draft))
    else st.removeDraft(e.chat_id)
    uiEvents.emit(RT.draftUpdate, e)
  })
  eventBus.subscribe(RT.presence, (p) => { store.setPresence(p as PresenceEvt); uiEvents.emit(RT.presence, p) })
  eventBus.subscribe(RT.typing, (raw) => {
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
    uiEvents.emit(RT.typing, t)
  })
  // Pin/unpin: refetch the chat's pins and write them to the store (the only
  // socket subscription for pins — usePinnedBar just reads the store).
  eventBus.subscribe(RT.pinMessage, (raw) => {
    const e = raw as PinMessageEvt
    void managers.messages.listPins(e.chat_id).then((p) => usePinsStore.getState().setPins(e.chat_id, p))
  })
  // Дельта реакции → окно сообщений. Эхо собственного действия (mine) поверх
  // оптимистичного апдейта гасится в applyReaction (идемпотентно).
  eventBus.subscribe(RT.reaction, (raw) => {
    const e = raw as ReactionEvt
    const meId = useChatsStore.getState().meId
    useMessagesStore.getState().applyReaction(e.chat_id, e.msg_id, e.emoji, e.action, e.user_id === meId)
    // Кто-то поставил реакцию на МОЁ сообщение → бейдж непрочитанных реакций
    // диалога (Telegram unread_reactions_count). Сброс — на прочтении чата (applyRead).
    if (e.action === 'add' && e.author_id === meId && e.user_id !== meId) {
      useChatsStore.getState().bumpUnreadReactions(e.chat_id)
    }
  })
  // Платная ⭐-реакция → окно сообщений: новый агрегат total; личный вклад mine
  // обновляем только у самого отправителя (эхо своего действия), иначе не трогаем.
  eventBus.subscribe(RT.starReaction, (raw) => {
    const e = raw as StarReactionEvt
    const meId = useChatsStore.getState().meId
    useMessagesStore.getState().applyStarReaction(e.chat_id, e.msg_id, e.total, e.sender_id === meId ? e.mine : undefined)
  })
  // Ack/error carry only client_msg_id → reconcile by clientMsgId (store maps it to the chat).
  eventBus.subscribe(RT.ack, (raw) => {
    const a = raw as AckEvt
    useMessagesStore.getState().reconcileAckByClient(a.client_msg_id, { msgId: a.msg_id, seq: a.seq, createdAt: a.created_at })
    // Звук подтверждения отправки («пак») — отдельный подписчик eventBus (sound).
  })
  eventBus.subscribe(RT.messageError, (raw) => {
    const err = raw as MessageErrorEvt
    useMessagesStore.getState().failOptimisticByClient(err.client_msg_id)
    // Платное сообщение отвергнуто из-за нехватки звёзд — тост (Telegram paid messages).
    if (err.reason === 'paid_required') uiEvents.emit('ui:toast', 'Недостаточно звёзд для отправки сообщения')
  })
  // 1:1 call signaling → движок звонка (стейт живёт в callStore)
  eventBus.subscribe(RT.call, (raw) => { callEngine.handleFrame(raw as CallFrameEvt) })
  eventBus.subscribe(RT.groupCall, (raw) => { handleGroupCallFrame(raw as GroupCallFrame) })
  // RTMP-трансляция: старт/стоп → livestreamStore (плашка LIVE + экран просмотра)
  eventBus.subscribe(RT.livestream, (raw) => { handleLivestreamFrame(raw as LivestreamFrame) })
  // Платное медиа разблокировано покупателем (на всех его вкладках): раскрываем
  // баббл — полное медиа приезжает готовым сообщением (тот же payload, что new_message).
  eventBus.subscribe(RT.paidMediaUnlock, (raw) => {
    const e = raw as NewMessageEvt
    const incoming = fromNewMessageEvt(e)
    useMessagesStore.getState().applyPaidUnlock(e.chat_id, incoming)
  })
  // Поздний ответ бота на callback (после таймаута синхронного ожидания) — тост.
  eventBus.subscribe(RT.botCallbackAnswer, (raw) => {
    const a = raw as BotCallbackAnswerEvt
    if (a.text) uiEvents.emit('ui:toast', a.text)
  })
  // Секретный чат: handshake-события из воркера → secretChatStore.
  eventBus.subscribe(RT.secretRequest, (raw) => {
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
  eventBus.subscribe(RT.secretAccept, (raw) => {
    const r = raw as { chat_id: number; state?: string; fingerprint?: string[] }
    useSecretChatStore.getState().setStatus(r.chat_id, 'established')
    if (r.fingerprint) useSecretChatStore.getState().setFingerprint(r.chat_id, r.fingerprint)
  })
  eventBus.subscribe(RT.secretReject, (raw) => {
    const r = raw as { chat_id: number }
    useSecretChatStore.getState().setStatus(r.chat_id, 'rejected')
  })
  // Истории (Stories realtime) → storiesStore. Новая история известного автора
  // добавляется в его группу; для нового автора (группы ещё нет) — полный рефетч
  // ленты (нужны имя/аватар автора). Удаление и реакции правят стор точечно.
  eventBus.subscribe(RT.storyNew, (raw) => {
    const e = raw as StoryNewEvt
    const st = useStoriesStore.getState()
    const hasGroup = st.groups.some((g) => g.author.id === e.author_id)
    if (hasGroup) {
      st.addStory(e.author_id, mapStory({ id: e.id, media_id: e.media_id, caption: e.caption, created_at: new Date().toISOString(), viewed: false }))
    } else {
      void loadStories(managers)
    }
  })
  eventBus.subscribe(RT.storyReaction, (raw) => {
    const e = raw as StoryReactionEvt
    const meId = useChatsStore.getState().meId
    // myReaction обновляем только для эха собственного действия (user_id === me).
    useStoriesStore.getState().applyStoryReaction(e.story_id, e.reactions_count, e.user_id === meId ? e.reaction : undefined)
  })
  eventBus.subscribe('rt:resync', () => { void loadChats(managers) })
  // Прогресс отгрузки медиа (кольцо на оптимистичном бабле)
  eventBus.subscribe('media:upload_progress', (raw) => {
    const e = raw as { id: string; loaded: number; total: number }
    if (e.total > 0) useUploadsStore.getState().setProgress(e.id, e.loaded / e.total)
  })
}
