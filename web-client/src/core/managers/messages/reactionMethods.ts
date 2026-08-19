// src/core/managers/messages/reactionMethods.ts
//
// Реакции + теги «Избранного» + платная ⭐-реакция (порт tweb appReactions).
// Выделено из God-объекта messagesManager: зависит от rest, точечного патча SSOT
// (patchMsg) и meId (для деривации `mine`) через ctx. Публичный API не меняется —
// методы спредятся в объект messagesManager; типы реэкспортятся оттуда же.
import { reactionDelta } from '../../reactionDelta'
import type { Message } from '../../models'
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
// 1) `mine` реакции (в отличие от poll.myVotes/giveaway.participating+iWon,
//    Task 4) — не единственный вложенный скаляр, который можно безусловно
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
export function newReactionMethods({ rest, patchMsg, getMeId }: MessagesCtx) {
  // Дельта реакции (count±1 по emoji) → SSOT. `mine` = моё ли действие
  // (user_id === meId). null из дельты — эхо своего уже применённого действия, no-op.
  const applyReactionToCache = (evt: ReactionEvt): void => {
    const mine = evt.user_id === (getMeId?.() ?? null)
    patchMsg(evt.peer_id, (m) => m.id === evt.msg_id, (m: Message) => {
      const next = reactionDelta(m.reactions, evt.emoji, evt.action, mine)
      return next === null ? null : { ...m, reactions: next }
    })
  }
  // АБСОЛЮТНЫЙ агрегат (серверное эхо с counts) → SSOT verbatim; `mine` деривим.
  // Идемпотентно на реплей (catch-up), поэтому дедуп по pts тут не нужен.
  const applyAbsoluteReactionToCache = (evt: ReactionEvt): void => {
    const counts = evt.counts ?? []
    const isMine = evt.user_id === (getMeId?.() ?? null)
    patchMsg(evt.peer_id, (m) => m.id === evt.msg_id, (m: Message) => {
      const prevMine = new Set((m.reactions ?? []).filter((r) => r.mine).map((r) => r.emoji))
      const next = counts.map((c) => {
        let mine = prevMine.has(c.emoji)
        if (isMine && c.emoji === evt.emoji) mine = evt.action === 'add'
        return { emoji: c.emoji, count: c.count, mine }
      })
      return { ...m, reactions: next.length ? next : undefined }
    })
  }
  // Платная ⭐-реакция → SSOT: total авторитетен, свой вклад (mine) — только для
  // собственного действия (sender_id === meId), иначе сохраняем кэшированный.
  const applyStarToCache = (evt: StarReactionEvt): void => {
    const isMine = evt.sender_id === (getMeId?.() ?? null)
    patchMsg(evt.peer_id, (m) => m.id === evt.msg_id,
      (m: Message) => ({ ...m, starReaction: { total: evt.total, mine: isMine ? evt.mine : (m.starReaction?.mine ?? 0) } }))
  }

  return {
    // ── Live-кадры funnel'а (worker APPLY зовёт messages.cacheX) → SSOT ──
    // С counts (серверное эхо/catch-up) — АБСОЛЮТНЫЙ set; без counts (оптимистичный
    // клик до эха) — дельта.
    cacheReaction(evt: ReactionEvt): void {
      if (evt.counts) applyAbsoluteReactionToCache(evt)
      else applyReactionToCache(evt)
    },
    cacheStarReaction(evt: StarReactionEvt): void {
      applyStarToCache(evt)
    },

    // Реакции: поставить/снять свою. Оптимистика в SSOT воркера (tweb sendReaction)
    // — применяем локально ДО сети; на ошибке сети — откат обратной дельтой. meId
    // обязателен для верной деривации `mine`; пока не разрешён (старт) — ждём эхо.
    async react(peerId: number, msgId: number, emoji: string): Promise<void> {
      const me = getMeId?.() ?? null
      if (me != null) applyReactionToCache({ peer_id: peerId, msg_id: msgId, user_id: me, emoji, action: 'add' })
      try {
        await rest.post(`/chats/${peerId}/messages/${msgId}/reactions`, { emoji })
      } catch (e) {
        if (me != null) applyReactionToCache({ peer_id: peerId, msg_id: msgId, user_id: me, emoji, action: 'remove' })
        throw e
      }
    },

    async unreact(peerId: number, msgId: number, emoji: string): Promise<void> {
      const me = getMeId?.() ?? null
      if (me != null) applyReactionToCache({ peer_id: peerId, msg_id: msgId, user_id: me, emoji, action: 'remove' })
      try {
        await rest.del(`/chats/${peerId}/messages/${msgId}/reactions/${encodeURIComponent(emoji)}`)
      } catch (e) {
        if (me != null) applyReactionToCache({ peer_id: peerId, msg_id: msgId, user_id: me, emoji, action: 'add' })
        throw e
      }
    },

    // Кто отреагировал (who-reacted попап). Член чата — проверяет бэк.
    async reactionUsers(peerId: number, msgId: number): Promise<ReactionUser[]> {
      // Маппера нет: форма провода и форма модели совпали.
      const r = await rest.get<{ users: ReactionUser[] }>(`/chats/${peerId}/messages/${msgId}/reactions/users`)
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
        `/chats/${peerId}/messages/${msgId}/star_reaction`, { count, anonymous })
      applyStarToCache({ peer_id: peerId, msg_id: msgId, sender_id: getMeId?.() ?? 0, total: r.star_reaction.total, mine: r.star_reaction.mine })
      return { total: r.star_reaction.total, mine: r.star_reaction.mine, balance: r.balance, top: mapStarSenders(r.top) }
    },
    // Агрегат платной ⭐-реакции сообщения (total + мой вклад + топ-отправители).
    async getStarReaction(peerId: number, msgId: number): Promise<StarReactionInfo> {
      const r = await rest.get<{ star_reaction: { total: number; mine: number }; top: StarSender[] }>(
        `/chats/${peerId}/messages/${msgId}/star_reaction`)
      return { total: r.star_reaction.total, mine: r.star_reaction.mine, top: mapStarSenders(r.top) }
    },
  }
}
