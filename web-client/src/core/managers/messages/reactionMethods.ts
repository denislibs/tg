// src/core/managers/messages/reactionMethods.ts
//
// Реакции + теги «Избранного» + платная ⭐-реакция (порт tweb appReactions).
// Выделено из God-объекта messagesManager: зависит от rest, точечного патча SSOT
// (patchMsg) и meId (для деривации `mine`) через ctx. Публичный API не меняется —
// методы спредятся в объект messagesManager; типы реэкспортятся оттуда же.
import { reactionDelta } from '../../reactionDelta'
import { generateMessageId, getServerMessageId } from '../../history/messageId'
import { mapReactions } from '../../models'
import { getPeerId } from '../../peers/peerId'
import type { MyMessage } from '../../models'
import type { ReactionEvt, StarReactionEvt } from '../../realtime/events'
import type { MessagesCtx } from './ctx'
import type { UserReal } from '../../peers/peer'

/** Кто отреагировал (для попапа who-reacted): КОНСТРУКТОР `user` плюс реакция
 *  рядом с ним. Прежняя плоская четвёрка {userId, name, username, avatarUrl}
 *  была снимком пользователя рядом с настоящим — имя теперь собирает клиент,
 *  аватарка это `photo.photo_id`. */
export interface ReactionUser {
  user: UserReal
  emoji: string
}

/** Тег-реакция «Избранного»: реакция (эмодзи/id кастом-эмодзи), имя и счётчик. */
export interface SavedTag {
  reaction: string
  title: string
  count: number
}

interface RawSavedTag {
  reaction: string
  title?: string
  count: number
}

/** Один отправитель платной ⭐-реакции (топ-отправители попапа): КОНСТРУКТОР
 * `user` плюс наши поля рядом. Анонимный — без личности (`user` пустой,
 * `anonymous: true`): рисуется как «Anonymous». Прежняя тройка {userId, name,
 * avatarUrl} была снимком пользователя рядом с настоящим. */
export interface StarSender {
  user: UserReal
  stars: number
  anonymous: boolean
}

/** Агрегат платной ⭐-реакции сообщения: сумма звёзд, мой вклад, топ-отправители. */
export interface StarReactionInfo {
  total: number
  mine: number
  top: StarSender[]
}

/** Результат отправки платной ⭐-реакции: новый агрегат + мой новый баланс. */
export interface StarReactionResult extends StarReactionInfo {
  balance: number
}

// Маппера нет: форма провода и форма модели совпали.
function mapStarSenders(rows: StarSender[] | undefined): StarSender[] {
  return rows ?? []
}

// Stage 1B.3 (Task 5): cacheReaction/cacheStarReaction ниже СОЗНАТЕЛЬНО НЕ
// переведены на операцию patch (workerCore.ts: типы reaction/star_reaction остаются
// без cache в APPLY-реестре, окно правит storeProjection.ts из сырого кадра —
// RT.reaction/RT.starReaction → applyReaction/applyReactionOptimistic/
// applyStarReaction). Карта обогащений (docs/research/2026-08-10-message-
// enrichments.md, §3.3) формально относит оба к «patch» — но «воркер знает
// mine» и «операция может это безопасно нести» оказались РАЗНЫМИ вопросами:
//
// 1) `mine` реакции (в отличие от `pFlags.chosen` у варианта опроса, Task 4) —
//    не единственный вложенный скаляр, который можно безусловно
//    подставить из окна поверх любого значения из кадра. applyReaction
//    (messagesStore.ts) делает ПОЭЛЕМЕНТНОЕ слияние МАССИВА по ключу emoji:
//    сохраняет mine для НЕЗАТРОНУТЫХ эмодзи И БЕРЁТ его из кадра для эмодзи
//    своего действия — обе ветки нужны одновременно, а какая сработает,
//    решают два внешних сигнала (свой ли user_id, add или remove), которых
//    нет в самом агрегате counts. Патч как протокол умеет нести только
//    готовое значение поля, а не алгоритм с внешними по отношению к полю
//    параметрами — воспроизвести это значило бы протащить в общий
//    messageOps.ts копию reactionDelta/setReactions под видом «просто patch».
// 2) Реакции (в отличие от опроса/розыгрыша) имеют НЕЗАВИСИМЫЙ клиентский
//    оптимистичный путь: хук (useMessageActions) сам зовёт
//    store.applyReactionOptimistic() СРАЗУ, а managers.messages.react/unreact
//    (эта секция) параллельно и НЕЗАВИСИМО применяет свою оптимистику к SSOT
//    воркера. Это две раздельные копии; SSOT воркера не видит оптимистичных
//    кликов ДРУГИХ вкладок по ДРУГИМ эмодзи того же сообщения — операция,
//    построенная из воркерной копии, рисковала бы навязать вкладке чужую
//    версию массива реакций поверх её собственной, ещё не подтверждённой
//    оптимистики (тот самый риск, от которого предостерегает бриф задачи).
//
// Эталон семантики — messagesStore.reactions.test.ts (не менять, только
// сверяться). Если решение по poll/giveaway (Task 4) когда-нибудь расширят на
// массивы через отдельный тип операции — тогда стоит вернуться и сюда.
export function newReactionMethods({ rest, patchMsg, getMeId, readMsg }: MessagesCtx) {
  // Дельта СВОЕГО клика (count±1 по emoji) → SSOT: оптимистика до сети.
  //
  // Кадром это больше не притворяется. Прежде функция принимала ReactionEvt и
  // вызывающие лепили фальшивый кадр со своим user_id — форма провода служила
  // внутренним протоколом менеджера. Кадр теперь несёт абсолютное состояние без
  // диффа, и собственный клик — единственное место, где дельта вообще
  // осмысленна.
  const applyLocalDelta = (peerId: number, msgId: number, emoji: string, action: 'add' | 'remove'): void => {
    const id = generateMessageId(msgId)
    patchMsg(peerId, (m) => m.id === id, (m: MyMessage) => {
      const next = reactionDelta(m.reactions, emoji, action, true)
      return next === null ? null : { ...m, reactions: next }
    })
  }
  // АБСОЛЮТНЫЙ агрегат кадра → SSOT. Свой выбор (`mine`) СОХРАНЯЕТСЯ: тело
  // кадра одно на всех получателей и потому помечено `pFlags.min` — моего
  // chosen_order в нём нет и быть не может. Прежде «моё» вычислялось из двух
  // внешних сигналов (свой ли user_id, add или remove), которых в самом
  // агрегате нет, — вместе с диффом они из кадра ушли.
  //
  // Идемпотентно на реплей (catch-up), поэтому дедуп по pts тут не нужен.
  const applyAbsoluteReactionToCache = (evt: ReactionEvt): void => {
    const peerId = getPeerId(evt.peer)
    const id = generateMessageId(evt.msg_id)
    const { reactions } = mapReactions(evt.reactions)
    patchMsg(peerId, (m) => m.id === id, (m: MyMessage) => {
      const prevMine = new Set((m.reactions ?? []).filter((r) => r.mine).map((r) => r.emoji))
      const next = (reactions ?? []).map((r) => ({ ...r, mine: prevMine.has(r.emoji) }))
      return { ...m, reactions: next.length ? next : undefined }
    })
  }

  // Платная ⭐-реакция → SSOT: total авторитетен, свой вклад (mine) — только для
  // собственного действия (sender_id === meId), иначе сохраняем кэшированный.
  const applyStarToCache = (evt: StarReactionEvt): void => {
    const isMine = evt.sender_id === (getMeId?.() ?? null)
    const id = generateMessageId(evt.id)
    patchMsg(evt.peer_id, (m) => m.id === id,
      (m: MyMessage) => ({ ...m, starReaction: { total: evt.total, mine: isMine ? evt.mine : (m.starReaction?.mine ?? 0) } }))
  }

  return {
    // ── Live-кадры funnel'а (worker APPLY зовёт messages.cacheX) → SSOT ──
    // С counts (серверное эхо/catch-up) — АБСОЛЮТНЫЙ set; без counts (оптимистичный
    // клик до эха) — дельта.
    cacheReaction(evt: ReactionEvt): void {
      applyAbsoluteReactionToCache(evt)
    },
    cacheStarReaction(evt: StarReactionEvt): void {
      applyStarToCache(evt)
    },

    // Выросло ли число реакций на МОЁМ сообщении — вопрос, на который отвечает
    // только владелец окна: кадр несёт абсолютный агрегат без «кто поставил» и
    // без пер-зрительских счётчиков, потому что тело одно на всех получателей.
    // Бейдж непрочитанных реакций бампится по этому ответу (порт tweb: дифф
    // выводит клиент), а авторитетное значение приезжает со строкой диалога.
    reactionsGrewOnMyMessage(peerId: number, serverMsgId: number, wire: ReactionEvt['reactions']): boolean {
      const m = readMsg(peerId, generateMessageId(serverMsgId))
      if (!m || m._ !== 'message' || !m.pFlags.out) return false
      const total = (list: { count: number }[] | undefined) => (list ?? []).reduce((sum, r) => sum + r.count, 0)
      return total(mapReactions(wire).reactions) > total(m.reactions)
    },

    // Реакции: поставить/снять свою. Оптимистика в SSOT воркера (tweb sendReaction)
    // — применяем локально ДО сети; на ошибке сети — откат обратной дельтой. meId
    // обязателен для верной деривации `mine`; пока не разрешён (старт) — ждём эхо.
    async react(peerId: number, msgId: number, emoji: string): Promise<void> {
      const me = getMeId?.() ?? null
      if (me != null) applyLocalDelta(peerId, getServerMessageId(msgId), emoji, 'add')
      try {
        await rest.post(`/chats/${peerId}/messages/${getServerMessageId(msgId)}/reactions`, { emoji })
      } catch (e) {
        if (me != null) applyLocalDelta(peerId, getServerMessageId(msgId), emoji, 'remove')
        throw e
      }
    },

    async unreact(peerId: number, msgId: number, emoji: string): Promise<void> {
      const me = getMeId?.() ?? null
      if (me != null) applyLocalDelta(peerId, getServerMessageId(msgId), emoji, 'remove')
      try {
        await rest.del(`/chats/${peerId}/messages/${getServerMessageId(msgId)}/reactions/${encodeURIComponent(emoji)}`)
      } catch (e) {
        if (me != null) applyLocalDelta(peerId, getServerMessageId(msgId), emoji, 'add')
        throw e
      }
    },

    // Кто отреагировал (who-reacted попап). Член чата — проверяет бэк.
    async reactionUsers(peerId: number, msgId: number): Promise<ReactionUser[]> {
      // Маппера нет: форма провода и форма модели совпали.
      const r = await rest.get<{ users: ReactionUser[] }>(`/chats/${peerId}/messages/${getServerMessageId(msgId)}/reactions/users`)
      return r.users ?? []
    },

    // Теги-реакции «Избранного» (Telegram saved reaction tags): список тегов и имена.
    async getSavedTags(): Promise<SavedTag[]> {
      const r = await rest.get<{ tags: RawSavedTag[] }>('/saved/tags')
      return (r.tags ?? []).map((t) => ({ reaction: t.reaction, title: t.title ?? '', count: t.count }))
    },
    // Задать/переименовать/очистить (пустой title) имя тега (updateSavedReactionTag).
    async renameSavedTag(reaction: string, title: string): Promise<void> {
      await rest.put(`/saved/tags/${encodeURIComponent(reaction)}`, { title })
    },

    // Платная ⭐-реакция: списать count звёзд, начислить автору, накопить вклад.
    // Возвращает агрегат + топ-отправителей + мой баланс. Live-эхо star_reaction
    // тоже придёт (идемпотентно правит total в сторе).
    async sendStarReaction(peerId: number, msgId: number, count: number, anonymous: boolean): Promise<StarReactionResult> {
      const r = await rest.post<{ star_reaction: { total: number; mine: number }; top: StarSender[]; balance: number }>(
        `/chats/${peerId}/messages/${getServerMessageId(msgId)}/star_reaction`, { count, anonymous })
      applyStarToCache({ peer_id: peerId, id: getServerMessageId(msgId), sender_id: getMeId?.() ?? 0, total: r.star_reaction.total, mine: r.star_reaction.mine })
      return { total: r.star_reaction.total, mine: r.star_reaction.mine, balance: r.balance, top: mapStarSenders(r.top) }
    },
    // Агрегат платной ⭐-реакции сообщения (total + мой вклад + топ-отправители).
    async getStarReaction(peerId: number, msgId: number): Promise<StarReactionInfo> {
      const r = await rest.get<{ star_reaction: { total: number; mine: number }; top: StarSender[] }>(
        `/chats/${peerId}/messages/${getServerMessageId(msgId)}/star_reaction`)
      return { total: r.star_reaction.total, mine: r.star_reaction.mine, top: mapStarSenders(r.top) }
    },
  }
}
