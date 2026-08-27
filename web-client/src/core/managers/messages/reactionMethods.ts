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
import type { MessageOp } from '../../realtime/messageOps'
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

// Реакции ЕДУТ ОПЕРАЦИЕЙ — и живой абсолютный агрегат кадра (cacheReaction), и
// свой клик (react/unreact), и ⭐-реакция (sendStarReaction). Прежде здесь
// стояло обратное решение (Stage 1B.3, Task 5) с двумя доводами; оба разобраны:
//
// 1) «`mine` — не значение поля, а поэлементное слияние массива двумя внешними
//    сигналами (свой ли user_id, add или remove)». Это было верно, пока слияние
//    делала ВИТРИНА: `messagesStore.applyReaction` получала кадр и досчитывала
//    `mine` у себя. Сегодня слияние делает ВЛАДЕЛЕЦ — `mergeReactions`
//    (core/reactions/messageReactions.ts) прямо здесь, в воркере, и наружу
//    уезжает уже ГОТОВЫЙ агрегат, включая `chosen_order`. Патч несёт значение
//    поля `reactions`, а не алгоритм: то, что алгоритм существует, не мешает
//    операции нести его результат.
// 2) «У реакций независимый оптимистичный путь вкладки, операция навяжет ей
//    чужую версию массива». Оптимистика вкладки идёт НЕ мимо воркера: клик
//    зовёт `messages.react/unreact` (ниже), а они двигают тот же SSOT воркера,
//    что и кадр. Воркер один на все вкладки одного пользователя, поэтому его
//    копия и есть та, где сведены клики всех вкладок; «своё» в ней — своё по
//    построению (`chosen_order` пер-зрительский, а зритель один). Второго
//    вычислителя операция не заводит — наоборот, снимает: main-сторный
//    `applyReaction` вместе с подпиской `RT.reaction` в storeProjection убран.
//
// Что кадр по-прежнему НЕ несёт — это `chosen_order` и мой вклад звёздами: тело
// одно на всех получателей (`pFlags.min`). Их сохраняет `mergeReactions` из
// предыдущего состояния SSOT — то есть ровно владелец, до порождения операции.
//
// Эталон семантики слияния — core/reactions/messageReactions.test.ts.
export function newReactionMethods({ rest, patchMsg, getMeId, opWindowsFor, emitOps, readMsg, peers }: MessagesCtx) {
  /** Операции `patch {reactions}` по всем окнам, где сообщение видно. Агрегат
   *  читается ИЗ SSOT после применения — операция несёт то же значение, что
   *  лежит у владельца, а не отдельно пересчитанное. */
  const reactionOps = (peerId: number, id: number): MessageOp[] => {
    const cur = readMsg(peerId, id)
    if (!cur) return []
    return opWindowsFor(peerId, id).map((key): MessageOp => ({ op: 'patch', key, msgId: id, fields: { reactions: cur.reactions } }))
  }

  // Дельта СВОЕГО клика (count±1 по emoji) → SSOT: оптимистика до сети.
  //
  // Кадром это больше не притворяется. Прежде функция принимала ReactionEvt и
  // вызывающие лепили фальшивый кадр со своим user_id — форма провода служила
  // внутренним протоколом менеджера. Кадр теперь несёт абсолютное состояние без
  // диффа, и собственный клик — единственное место, где дельта вообще
  // осмысленна.
  //
  // Зритель и чат уходят в дельту ПАРОЙ (`ReactionClick`): свой пир дописывается
  // в `recent_reactions` сразу, иначе чип мигнёт числом и лишь потом, с кадром,
  // сменится на аватарку, — но существует ли этот вектор в чате вообще, решает
  // право видеть список, и без ключа чата его не спросить.
  const applyLocalDelta = (peerId: number, msgId: number, emoji: string, action: 'add' | 'remove', me: PeerId): void => {
    const id = generateMessageId(msgId)
    let applied = false
    patchMsg(peerId, (m) => m.id === id, (m: MyMessage) => {
      const next = reactionDelta(m.reactions, emoji, action, true, { me, peerId })
      if (next === null) return null // эхо своего уже применённого действия
      applied = true
      return { ...m, reactions: next }
    })
    // Объявляем ТОЛЬКО состоявшееся изменение: окно правит операция, и «ничего
    // не изменилось» — не событие. Без этой строки клик по чипу двигал бы
    // только SSOT воркера, а окно (и зеркало, из которого рисует императивная
    // лента) не узнавало бы о нём вовсе.
    if (applied) emitOps(reactionOps(peerId, id))
  }
  // АБСОЛЮТНЫЙ агрегат кадра → SSOT. Свой выбор (`mine`) СОХРАНЯЕТСЯ: тело
  // кадра одно на всех получателей и потому помечено `pFlags.min` — моего
  // chosen_order в нём нет и быть не может. Прежде «моё» вычислялось из двух
  // внешних сигналов (свой ли user_id, add или remove), которых в самом
  // агрегате нет, — вместе с диффом они из кадра ушли.
  //
  // Идемпотентно на реплей (catch-up), поэтому дедуп по pts тут не нужен.
  const applyAbsoluteReactionToCache = (evt: ReactionEvt): MessageOp[] => {
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
    return reactionOps(peerId, id)
  }

  // Платная ⭐-реакция → SSOT из ОТВЕТА ручки: там и агрегат, и свой вклад
  // (кадр несёт только агрегат — свой вклад в общем теле не поедет никогда).
  const applyStarToCache = (peerId: number, serverMsgId: number, total: number, mine: number): void => {
    const id = generateMessageId(serverMsgId)
    patchMsg(peerId, (m) => m.id === id, (m: MyMessage) => ({ ...m, reactions: setPaidReaction(m.reactions, total, mine) }))
    // Свой вклад звёздами приезжает ТОЛЬКО ответом ручки (в кадре его нет и быть
    // не может), поэтому объявить окну изменение обязан этот путь — второго нет.
    emitOps(reactionOps(peerId, id))
  }

  return {
    // ── Live-кадры funnel'а (worker APPLY зовёт messages.cacheX) → SSOT ──
    // С counts (серверное эхо/catch-up) — АБСОЛЮТНЫЙ set; без counts (оптимистичный
    // клик до эха) — дельта.
    cacheReaction(evt: ReactionEvt): MessageOp[] {
      return applyAbsoluteReactionToCache(evt)
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
    // обязателен и для деривации `mine`, и для своего пира в `recent_reactions`;
    // пока не разрешён (старт) — ждём эхо.
    async react(peerId: number, msgId: number, emoji: string): Promise<void> {
      const me = getMeId?.() ?? null
      if (me != null) applyLocalDelta(peerId, getServerMessageId(msgId), emoji, 'add', me)
      try {
        await rest.post(`/chats/${peerId}/messages/${getServerMessageId(msgId)}/reactions`, { emoji })
      } catch (e) {
        if (me != null) applyLocalDelta(peerId, getServerMessageId(msgId), emoji, 'remove', me)
        throw e
      }
    },

    async unreact(peerId: number, msgId: number, emoji: string): Promise<void> {
      const me = getMeId?.() ?? null
      if (me != null) applyLocalDelta(peerId, getServerMessageId(msgId), emoji, 'remove', me)
      try {
        await rest.del(`/chats/${peerId}/messages/${getServerMessageId(msgId)}/reactions/${encodeURIComponent(emoji)}`)
      } catch (e) {
        if (me != null) applyLocalDelta(peerId, getServerMessageId(msgId), emoji, 'add', me)
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
