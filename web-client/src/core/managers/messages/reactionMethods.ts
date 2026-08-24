// src/core/managers/messages/reactionMethods.ts
//
// Реакции + теги «Избранного» + платная ⭐-реакция (порт tweb appReactions).
// Выделено из God-объекта messagesManager: зависит от rest, точечного патча SSOT
// (patchMsg) и meId (для деривации `mine`) через ctx. Публичный API не меняется —
// методы спредятся в объект messagesManager; типы реэкспортятся оттуда же.
import { mergeReactions, reactionDelta, setPaidReaction, totalReactions } from '../../reactions/messageReactions'
import { generateMessageId, getServerMessageId } from '../../history/messageId'
import { getPeerId } from '../../peers/peerId'
import type { MyMessage } from '../../models'
import type { ReactionEvt } from '../../realtime/events'
import type { MessagesCtx } from './ctx'
import type { UserReal } from '../../peers/peer'
import type { Peer } from '../../peers/peerId'
import type { Reaction } from '../../models'

/** Кто отреагировал (для попапа who-reacted): КОНСТРУКТОР `user` плюс реакция
 *  рядом с ним. Прежняя плоская четвёрка {userId, name, username, avatarUrl}
 *  была снимком пользователя рядом с настоящим — имя теперь собирает клиент,
 *  аватарка это `photo.photo_id`. */
/** messages.messageReactionsList — «кто отреагировал»: строки-ссылки плюс
 *  карточки вектором `users`. */
export interface MessagesMessageReactionsList {
  _: 'messages.messageReactionsList'
  count: number
  reactions: { _: 'messagePeerReaction'; peer_id: Peer; date: number; reaction: Reaction }[]
  chats: unknown[]
  users: UserReal[]
}

/** messages.savedReactionTags — теги «Избранного»; реакция это объединение. */
export interface MessagesSavedReactionTags {
  _: 'messages.savedReactionTags'
  tags: { _: 'savedReactionTag'; reaction: Reaction; title?: string; count: number }[]
}

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

/** Один отправитель платной ⭐-реакции (топ-отправители попапа): КОНСТРУКТОР
 * `user` плюс наши поля рядом. Анонимный — без личности (`user` пустой,
 * `anonymous: true`): рисуется как «Anonymous». Прежняя тройка {userId, name,
 * avatarUrl} была снимком пользователя рядом с настоящим. */
/**
 * Один отправитель платной ⭐-реакции — СТРОКА `messageReactor` схемы: ССЫЛКА
 * на пира плюс число звёзд. Ссылка, а не карточка: карточки едут вектором
 * `users` того же контейнера и уезжают в зеркало пиров.
 *
 * У анонимного ссылки нет вовсе (`pFlags.anonymous`): личность затёрта на
 * сервере, и подставлять вместо неё пустую карточку нечем.
 */
export interface StarSender {
  peerId: number | null
  stars: number
  anonymous: boolean
}

/** `messageReactor` на проводе. */
interface MessageReactorWire {
  _: 'messageReactor'
  pFlags?: { top?: true; my?: true; anonymous?: true }
  peer_id?: Peer
  count: number
}

/**
 * Витрина ⭐-реакции — КАДР `updateMessageReactions` в контейнере `updates`.
 *
 * Прежде она отдавала безымянную тройку: пару `{total, mine}` под ключом
 * `star_reaction`, список отправителей с ВКЛЕЕННОЙ карточкой в каждой строке и
 * баланс. У оригинала всё это ОДИН предмет — агрегат реакций сообщения, где
 * платная реакция это чип `reactionPaid`, а доска отправителей —
 * `top_reactors`. Баланс уехал своему владельцу: кадру `updateStarsBalance`.
 */
interface StarReactionWire {
  _: 'updates'
  updates: {
    _: 'updateMessageReactions'
    peer: Peer
    msg_id: number
    reactions: {
      _: 'messageReactions'
      results: { _: 'reactionCount'; reaction: { _: string }; count: number; chosen_order?: number }[]
      top_reactors?: MessageReactorWire[]
    }
  }[]
  users: UserReal[]
  chats: unknown[]
}

/** Агрегат платной ⭐-реакции сообщения: сумма звёзд, мой вклад, топ-отправители. */
export interface StarReactionInfo {
  total: number
  mine: number
  top: StarSender[]
}

/** Результат отправки платной ⭐-реакции — тот же агрегат: баланс приезжает
 *  своим кадром `updateStarsBalance`, а не вторым значением в этом ответе. */
export type StarReactionResult = StarReactionInfo

/**
 * Кадр витрины → агрегат для попапа.
 *
 * `total` это count чипа `reactionPaid`, `mine` — count МОЕЙ строки доски
 * (`pFlags.my`): у оригинала личный вклад живёт именно там, а в чипе только
 * «моя или не моя». Прежде обе величины ехали отдельной парой рядом с чипами.
 */
function mapStarReaction(r: StarReactionWire): StarReactionInfo {
  const reactions = r.updates?.[0]?.reactions
  const paid = reactions?.results?.find((c) => c.reaction?._ === 'reactionPaid')
  const reactors = reactions?.top_reactors ?? []
  const mine = reactors.find((x) => x.pFlags?.my)
  return {
    total: paid?.count ?? 0,
    mine: mine?.count ?? 0,
    top: reactors
      .filter((x) => !x.pFlags?.my)
      .map((x) => ({
        peerId: x.peer_id ? getPeerId(x.peer_id) : null,
        stars: x.count,
        anonymous: !!x.pFlags?.anonymous,
      })),
  }
}

// Stage 1B.3 (Task 5): cacheReaction ниже СОЗНАТЕЛЬНО НЕ переведена на операцию
// patch (workerCore.ts: тип reaction остаётся без cache в APPLY-реестре, окно
// правит storeProjection.ts из сырого кадра — RT.reaction → applyReaction/
// applyReactionOptimistic). Карта обогащений (docs/research/2026-08-10-message-
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
export function newReactionMethods({ rest, patchMsg, getMeId, readMsg, peers }: MessagesCtx) {
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
    // Платная ⭐-реакция применяется ЗДЕСЬ ЖЕ и отдельной строкой не требует:
    // она чип того же вектора (`reactionPaid`), а мой вклад звёздами —
    // `top_reactors` с `pFlags.my`, и он пер-зрительский ровно так же, как
    // chosen_order. Оба сохраняет mergeReactions.
    patchMsg(peerId, (m) => m.id === id, (m: MyMessage) => ({
      ...m,
      reactions: mergeReactions(m.reactions, evt.reactions),
    }))
  }

  // Платная ⭐-реакция → SSOT из ОТВЕТА ручки: там и агрегат, и свой вклад
  // (кадр несёт только агрегат — свой вклад в общем теле не поедет никогда).
  const applyStarToCache = (peerId: number, serverMsgId: number, total: number, mine: number): void => {
    const id = generateMessageId(serverMsgId)
    patchMsg(peerId, (m) => m.id === id, (m: MyMessage) => ({ ...m, reactions: setPaidReaction(m.reactions, total, mine) }))
  }

  return {
    // ── Live-кадры funnel'а (worker APPLY зовёт messages.cacheX) → SSOT ──
    // С counts (серверное эхо/catch-up) — АБСОЛЮТНЫЙ set; без counts (оптимистичный
    // клик до эха) — дельта.
    cacheReaction(evt: ReactionEvt): void {
      applyAbsoluteReactionToCache(evt)
    },

    // Выросло ли число реакций на МОЁМ сообщении — вопрос, на который отвечает
    // только владелец окна: кадр несёт абсолютный агрегат без «кто поставил» и
    // без пер-зрительских счётчиков, потому что тело одно на всех получателей.
    // Бейдж непрочитанных реакций бампится по этому ответу (порт tweb: дифф
    // выводит клиент), а авторитетное значение приезжает со строкой диалога.
    reactionsGrewOnMyMessage(peerId: number, serverMsgId: number, wire: ReactionEvt['reactions']): boolean {
      const m = readMsg(peerId, generateMessageId(serverMsgId))
      if (!m || m._ !== 'message' || !m.pFlags.out) return false
      return totalReactions(wire) > totalReactions(m.reactions)
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

    /**
     * Кто отреагировал (who-reacted попап). Член чата — проверяет бэк.
     *
     * Ответ — контейнер `messages.messageReactionsList`: строки это
     * `messagePeerReaction` (ссылка на пир + реакция), а КАРТОЧКИ едут вектором
     * `users`. Прежде карточка была вклеена в каждую строку — снимок вместо
     * ссылки, тот же дефект, что уже убирался у диалогов и чёрного списка.
     */
    async reactionUsers(peerId: number, msgId: number): Promise<ReactionUser[]> {
      const r = await rest.get<MessagesMessageReactionsList>(`/chats/${peerId}/messages/${getServerMessageId(msgId)}/reactions/users`)
      const byId = new Map((r.users ?? []).map((u) => [u.id, u]))
      return (r.reactions ?? []).flatMap((row) => {
        const user = row.peer_id._ === 'peerUser' ? byId.get(row.peer_id.user_id) : undefined
        if (!user || row.reaction._ !== 'reactionEmoji') return []
        return [{ user, emoji: row.reaction.emoticon }]
      })
    },

    /**
     * Теги-реакции «Избранного». Реакция тега — ОБЪЕДИНЕНИЕ `Reaction`, а не
     * строка эмодзи: тот же предмет, что в агрегате сообщения.
     */
    async getSavedTags(): Promise<SavedTag[]> {
      const r = await rest.get<MessagesSavedReactionTags>('/saved/tags')
      return (r.tags ?? []).flatMap((t) =>
        t.reaction._ === 'reactionEmoji'
          ? [{ reaction: t.reaction.emoticon, title: t.title ?? '', count: t.count }]
          : [])
    },
    // Задать/переименовать/очистить (пустой title) имя тега (updateSavedReactionTag).
    async renameSavedTag(reaction: string, title: string): Promise<void> {
      await rest.put(`/saved/tags/${encodeURIComponent(reaction)}`, { title })
    },

    // Платная ⭐-реакция: списать count звёзд, начислить автору, накопить вклад.
    // Ответ — тот же КАДР, что приходит живым (updateMessageReactions с чипом
    // reactionPaid); баланс приезжает своим кадром updateStarsBalance.
    async sendStarReaction(peerId: number, msgId: number, count: number, anonymous: boolean): Promise<StarReactionInfo> {
      const r = await rest.post<StarReactionWire>(
        `/chats/${peerId}/messages/${getServerMessageId(msgId)}/star_reaction`, { count, anonymous })
      peers?.saveApiPeers({ users: r.users })
      const info = mapStarReaction(r)
      applyStarToCache(peerId, getServerMessageId(msgId), info.total, info.mine)
      return info
    },
    // Агрегат платной ⭐-реакции сообщения (total + мой вклад + топ-отправители).
    async getStarReaction(peerId: number, msgId: number): Promise<StarReactionInfo> {
      const r = await rest.get<StarReactionWire>(
        `/chats/${peerId}/messages/${getServerMessageId(msgId)}/star_reaction`)
      peers?.saveApiPeers({ users: r.users })
      return mapStarReaction(r)
    },
  }
}
