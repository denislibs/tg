// src/client/realtimeBridge.ts
import { startClient } from './bootstrap'
import { loadChats, useChatsStore } from '../stores/chatsStore'
import { useMessagesStore } from '../stores/messagesStore'
import { usePinsStore } from '../stores/pinsStore'
import { useStarsStore } from '../stores/starsStore'
import { mapMessage, mapDraft, mapPoll, mapChecklist, mapGeo, mapWebPage, mapFactCheck, mapBoostStatus, mapGiveaway, mapSuggestedPost, type RawPoll, type RawChecklist, type RawBoostStatus, type RawGiveaway } from '../core/models'
import { useBoostsStore } from '../stores/boostsStore'
import { useSuggestedPostsStore } from '../stores/suggestedPostsStore'
import { useDraftsStore } from '../stores/draftsStore'
import { useUploadsStore } from '../stores/uploadsStore'
import { uiEvents } from '../core/hooks/uiEvents'
import { mapReplyMarkup } from '../core/managers/botsManager'
import { RT, type NewMessageEvt, type ReadEvt, type MediaReadEvt, type ChatRemovedEvt, type PresenceEvt, type TypingEvt, type AckEvt, type MessageErrorEvt, type EditMessageEvt, type DeleteMessageEvt, type PinMessageEvt, type CallFrameEvt, type DraftUpdateEvt, type ReactionEvt, type StarReactionEvt, type BotCallbackAnswerEvt, type GeoLiveUpdateEvt, type WebPageUpdateEvt, type FactCheckUpdateEvt, type ChatThemeUpdateEvt, type SuggestedPostEvt } from '../core/realtime/events'
import { playMessageSent } from '../core/audio/sounds'
import { playEmojiEffect } from '../core/effects/emojiEffects'
import { notifyIncomingMessage } from './uiNotifications'
import { useSettingsStore } from '../settings'
import { useSecretChatStore } from '../stores/secretChatStore'
import * as callEngine from '../core/calls/callEngine'
import { handleGroupCallFrame, type GroupCallFrame } from '../core/calls/groupCallEngine'
import { handleLivestreamFrame, type LivestreamFrame } from '../core/calls/livestreamEngine'

let started = false

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

// Subscribe to worker realtime events exactly once per page.
export function startRealtime(): void {
  if (started) return
  started = true
  const { smp, managers } = startClient()
  const store = useChatsStore.getState()

  smp.on(RT.newMessage, (m) => {
    const evt = m as NewMessageEvt
    // Сообщение в неизвестный чат = меня только что добавили в новый чат (первое
    // сообщение / сервисное «создал группу») → подтянуть список диалогов.
    // Сервисное сообщение в известный чат — признак смены метаданных группы
    // (фото/название) → тоже рефетч (дебаунс внутри).
    if (!useChatsStore.getState().dialogs.some((d) => d.chatId === evt.chat_id) || evt.type === 'service') {
      scheduleChatsReload(managers)
    }
    store.applyNewMessage(evt) // dialog-list preview (chatsStore)
    // Append to the chat's message window (single source of truth). Resolve the
    // reply preview from the already-loaded window so a reply shows its quote
    // immediately (applyIncoming no-ops if the window isn't loaded). markRead /
    // unread-below is decided in ConversationView (it needs scroll/focus state).
    const ms = useMessagesStore.getState()
    const rt = evt.reply_to_id != null ? ms.byKey[String(evt.chat_id)]?.msgs.find((x) => x.id === evt.reply_to_id) : undefined
    const replyTo = rt ? { msg_id: rt.id, seq: rt.seq, sender_id: rt.senderId, text: rt.text, type: rt.type, quote_text: evt.reply_quote_text || undefined } : null
    const incoming = mapMessage({ id: evt.msg_id, chat_id: evt.chat_id, seq: evt.seq, sender_id: evt.sender_id, type: evt.type, text: evt.text, entities: evt.entities ?? null, reply_to_id: evt.reply_to_id ?? null, media_id: evt.media_id, created_at: evt.created_at, fwd_from_user_id: evt.fwd_from_user_id ?? null, fwd_from_chat_id: evt.fwd_from_chat_id ?? null, fwd_from_msg_id: evt.fwd_from_msg_id ?? null, fwd_date: evt.fwd_date ?? null, reply_to: replyTo, media_unread: evt.media_unread, grouped_id: evt.grouped_id ?? null, geo: evt.geo ?? null, contact: evt.contact ?? null, gift: evt.gift ?? null, reply_markup: evt.reply_markup ?? null, thread_root_id: evt.thread_root_id ?? null, media_w: evt.media_w, media_h: evt.media_h, media_mime: evt.media_mime, media_blur: evt.media_blur, media_has_thumb: evt.media_has_thumb, media_duration: evt.media_duration, media_size: evt.media_size, media_name: evt.media_name, effect: evt.effect ?? null, paid_media: evt.paid_media ?? null })
    // E2E-медиа секретного чата: воркер расшифровал enc_body и положил key/iv/mime
    // в secret_media (не проводное поле → инжектим после mapMessage). secret тоже.
    if (evt.secret_media) { incoming.secretMedia = evt.secret_media; incoming.secret = true }
    ms.applyIncoming(evt.chat_id, incoming)
    // Эффект сообщения (наш аналог Telegram message effects): чужое сообщение с
    // эффектом, пришедшее в ОТКРЫТЫЙ чат, проигрываем один раз (своё уже сыграли
    // на отправке; для закрытого чата — только click-replay в истории).
    const cs = useChatsStore.getState()
    if (incoming.effect && evt.sender_id !== cs.meId && cs.activeChatId === evt.chat_id) {
      playEmojiEffect(incoming.effect)
    }
    uiEvents.emit(RT.newMessage, m)
    // Звук + браузерное уведомление, гейтинг как в tweb: per-chat mute →
    // глобальные настройки типа чата → клиентские настройки (см. uiNotifications).
    notifyIncomingMessage(evt)
  })
  smp.on(RT.read, (r) => { store.applyRead(r as ReadEvt); uiEvents.emit(RT.read, r) })
  smp.on(RT.mediaRead, (raw) => {
    const e = raw as MediaReadEvt
    useMessagesStore.getState().applyMediaRead(e.chat_id, e.msg_id)
  })
  smp.on(RT.chatRemoved, (raw) => {
    useChatsStore.getState().removeDialog((raw as ChatRemovedEvt).chat_id)
  })
  // Черновик изменён на другом устройстве/вкладке (или снят отправкой/очисткой)
  smp.on(RT.draftUpdate, (raw) => {
    const e = raw as DraftUpdateEvt
    const st = useDraftsStore.getState()
    if (e.draft) st.setDraft(mapDraft(e.draft))
    else st.removeDraft(e.chat_id)
    uiEvents.emit(RT.draftUpdate, e)
  })
  // Live-агрегаты опроса (poll_update): голос/закрытие в любом чате
  smp.on(RT.pollUpdate, (raw) => {
    const e = raw as { chat_id: number; poll: RawPoll }
    useMessagesStore.getState().applyPollUpdate(e.chat_id, mapPoll(e.poll))
  })
  // Обновление чек-листа (checklist_update): отметка/добавление пункта в любом чате
  smp.on(RT.checklistUpdate, (raw) => {
    const e = raw as { chat_id: number; checklist: RawChecklist }
    useMessagesStore.getState().applyChecklistUpdate(e.chat_id, mapChecklist(e.checklist))
  })
  // Тема оформления чата сменилась (общая для чата) — пишем в стор диалогов,
  // ConversationView перекрашивает область активного чата.
  smp.on(RT.chatThemeUpdate, (raw) => {
    const e = raw as ChatThemeUpdateEvt
    useChatsStore.getState().setDialogTheme(e.chat_id, e.theme_id)
  })
  // Счётчик/уровень бустов канала (boost_update).
  smp.on(RT.boostUpdate, (raw) => {
    const e = raw as { chat_id: number; status: RawBoostStatus }
    useBoostsStore.getState().applyStatus(e.chat_id, mapBoostStatus(e.status))
  })
  // Live-статус розыгрыша (giveaway_update): число участников/завершение.
  smp.on(RT.giveawayUpdate, (raw) => {
    const e = raw as { chat_id: number; giveaway: RawGiveaway }
    useMessagesStore.getState().applyGiveawayUpdate(e.chat_id, mapGiveaway(e.giveaway))
  })
  // Новая/решённая предложка поста (suggested_post_update).
  smp.on(RT.suggestedPost, (raw) => {
    const e = raw as SuggestedPostEvt
    useSuggestedPostsStore.getState().apply(e.chat_id, mapSuggestedPost(e.post))
  })
  // Пин/архив диалога с другого устройства/вкладки (dialog_pin / dialog_archive)
  smp.on(RT.dialogPin, (raw) => {
    const e = raw as { chat_id: number; pinned: boolean }
    useChatsStore.getState().setDialogPinned(e.chat_id, e.pinned)
  })
  smp.on(RT.dialogArchive, (raw) => {
    const e = raw as { chat_id: number; archived: boolean }
    useChatsStore.getState().setDialogArchived(e.chat_id, e.archived)
  })
  smp.on(RT.presence, (p) => { store.setPresence(p as PresenceEvt); uiEvents.emit(RT.presence, p) })
  smp.on(RT.typing, (raw) => {
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
  // Edit/delete carry chat_id → apply straight to that chat's message window.
  smp.on(RT.editMessage, (raw) => {
    const e = raw as EditMessageEvt
    const markup = e.reply_markup ? mapReplyMarkup(e.reply_markup) : null
    useMessagesStore.getState().applyEdit(e.chat_id, e.msg_id, e.text, e.edited_at, e.entities ?? undefined, markup)
  })
  smp.on(RT.deleteMessage, (raw) => {
    const e = raw as DeleteMessageEvt
    useMessagesStore.getState().applyDelete(e.chat_id, e.msg_id)
  })
  smp.on(RT.geoLiveUpdate, (raw) => {
    const e = raw as GeoLiveUpdateEvt
    useMessagesStore.getState().applyGeoLive(e.chat_id, e.msg_id, mapGeo(e.geo))
  })
  // Догоняющее серверное превью ссылки: карточка web page добирается к уже
  // отрисованному сообщению (сервер строит её после коммита отправки).
  smp.on(RT.webPageUpdate, (raw) => {
    const e = raw as WebPageUpdateEvt
    useMessagesStore.getState().applyWebPage(e.chat_id, e.msg_id, mapWebPage(e.web_page))
  })
  // «Проверка фактов» прикреплена/изменена/снята: блок fact-check добирается/
  // исчезает у уже отрисованного сообщения (factcheck===null — снята).
  smp.on(RT.factCheckUpdate, (raw) => {
    const e = raw as FactCheckUpdateEvt
    useMessagesStore.getState().applyFactCheck(e.chat_id, e.msg_id, e.factcheck ? mapFactCheck(e.factcheck) : undefined)
  })
  // Pin/unpin: refetch the chat's pins and write them to the store (the only
  // socket subscription for pins — usePinnedBar just reads the store).
  smp.on(RT.pinMessage, (raw) => {
    const e = raw as PinMessageEvt
    void managers.messages.listPins(e.chat_id).then((p) => usePinsStore.getState().setPins(e.chat_id, p))
  })
  // Дельта реакции → окно сообщений. Эхо собственного действия (mine) поверх
  // оптимистичного апдейта гасится в applyReaction (идемпотентно).
  smp.on(RT.reaction, (raw) => {
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
  smp.on(RT.starReaction, (raw) => {
    const e = raw as StarReactionEvt
    const meId = useChatsStore.getState().meId
    useMessagesStore.getState().applyStarReaction(e.chat_id, e.msg_id, e.total, e.sender_id === meId ? e.mine : undefined)
  })
  // Ack/error carry only client_msg_id → reconcile by clientMsgId (store maps it to the chat).
  smp.on(RT.ack, (raw) => {
    const a = raw as AckEvt
    useMessagesStore.getState().reconcileAckByClient(a.client_msg_id, { msgId: a.msg_id, seq: a.seq, createdAt: a.created_at })
    // Server confirmed one of our sends → the "pak" (tweb's message_sent),
    // если не выключен в настройках (Sound Effects → Message Sent).
    if (useSettingsStore.getState().sentMessageSound) playMessageSent()
  })
  smp.on(RT.messageError, (raw) => {
    const err = raw as MessageErrorEvt
    useMessagesStore.getState().failOptimisticByClient(err.client_msg_id)
    // Платное сообщение отвергнуто из-за нехватки звёзд — тост (Telegram paid messages).
    if (err.reason === 'paid_required') uiEvents.emit('ui:toast', 'Недостаточно звёзд для отправки сообщения')
  })
  // 1:1 call signaling → движок звонка (стейт живёт в callStore)
  smp.on(RT.call, (raw) => { callEngine.handleFrame(raw as CallFrameEvt) })
  smp.on(RT.groupCall, (raw) => { handleGroupCallFrame(raw as GroupCallFrame) })
  // RTMP-трансляция: старт/стоп → livestreamStore (плашка LIVE + экран просмотра)
  smp.on(RT.livestream, (raw) => { handleLivestreamFrame(raw as LivestreamFrame) })
  // Новый баланс звёзд (после пополнения/подарка/конвертации) — в starsStore.
  smp.on(RT.balanceUpdate, (raw) => {
    const b = (raw as { balance: number }).balance
    if (typeof b === 'number') useStarsStore.getState().setBalance(b)
  })
  // Платное медиа разблокировано покупателем (на всех его вкладках): раскрываем
  // баббл — полное медиа приезжает готовым сообщением (тот же payload, что new_message).
  smp.on(RT.paidMediaUnlock, (raw) => {
    const e = raw as NewMessageEvt
    const incoming = mapMessage({ id: e.msg_id, chat_id: e.chat_id, seq: e.seq, sender_id: e.sender_id, type: e.type, text: e.text, entities: e.entities ?? null, reply_to_id: e.reply_to_id ?? null, media_id: e.media_id, created_at: e.created_at, media_w: e.media_w, media_h: e.media_h, media_mime: e.media_mime, media_blur: e.media_blur, media_has_thumb: e.media_has_thumb, media_duration: e.media_duration, media_size: e.media_size, media_name: e.media_name, paid_media: e.paid_media ?? null })
    useMessagesStore.getState().applyPaidUnlock(e.chat_id, incoming)
  })
  // Поздний ответ бота на callback (после таймаута синхронного ожидания) — тост.
  smp.on(RT.botCallbackAnswer, (raw) => {
    const a = raw as BotCallbackAnswerEvt
    if (a.text) uiEvents.emit('ui:toast', a.text)
  })
  // Секретный чат: handshake-события из воркера → secretChatStore.
  smp.on(RT.secretRequest, (raw) => {
    const r = raw as { chat_id: number; initiator_id: number; responder_id: number }
    const meId = useChatsStore.getState().meId
    // Роль решает статус: получатель видит входящий запрос ('requested' → бар с
    // «Принять/Отклонить»), инициатор ждёт ('awaiting'). Живьём сервер шлёт кадр
    // только получателю; при reload оба состояния восстанавливает secret.sync().
    if (meId === r.responder_id) useSecretChatStore.getState().setStatus(r.chat_id, 'requested')
    else if (meId === r.initiator_id) useSecretChatStore.getState().setStatus(r.chat_id, 'awaiting')
  })
  smp.on(RT.secretAccept, (raw) => {
    const r = raw as { chat_id: number; state?: string; fingerprint?: string[] }
    useSecretChatStore.getState().setStatus(r.chat_id, 'established')
    if (r.fingerprint) useSecretChatStore.getState().setFingerprint(r.chat_id, r.fingerprint)
  })
  smp.on(RT.secretReject, (raw) => {
    const r = raw as { chat_id: number }
    useSecretChatStore.getState().setStatus(r.chat_id, 'rejected')
  })
  smp.on('rt:resync', () => { void loadChats(managers) })
  // Прогресс отгрузки медиа (кольцо на оптимистичном бабле)
  smp.on('media:upload_progress', (raw) => {
    const e = raw as { id: string; loaded: number; total: number }
    if (e.total > 0) useUploadsStore.getState().setProgress(e.id, e.loaded / e.total)
  })

  void managers.realtime.start()
}
