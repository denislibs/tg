// Разметка клавиатур сообщения в форме оригинала (MTProto): объединение
// конструкторов `ReplyMarkup` схемы с дискриминатором `_`.
//
// Зачем. Было `{inline?: InlineButton[][], keyboard?: string[][], resize?,
// oneTime?}` — наша выдумка, у которой нет ни одного соответствия в схеме.
// Из неё росли ровно те же болезни, что у плоского медиа: вид кнопки
// подделывался НАЛИЧИЕМ поля (`b.url ? … : b.callback ? …`) вместо ветвления по
// конструктору, «скрыть клавиатуру» выражалось пустым массивом вместо
// отдельного конструктора `replyKeyboardHide`, а reply-кнопка была голой
// строкой, у которой нет места ни под что, кроме текста. Портируемый код
// оригинала (`wrapKeyboardButton`, `ReplyKeyboard`, ветка `reply_markup` в
// `bubbles.ts`) написан против объединения — здесь модель совпадает.
//
// Имена конструкторов и полей взяты из схемы БУКВАЛЬНО (`schema/schema.json`);
// фаза 0 перехода на TL — модель уже TL-совместима, сериализация пока JSON.
// Булевы флаги (`flags.N?true`) живут в `pFlags` и всегда несут литерал `true`:
// «выключено» — это ОТСУТСТВИЕ ключа, не `false` и не `null`. Поля `flags` в
// объекте нет вовсе — битовая маска существует только на проводе.
//
// ── Чего в модели НЕТ и почему ───────────────────────────────────────────────
//  • `style:flags.10?KeyboardButtonStyle` — предмета нет: цвета/иконки кнопок
//    наш бэкенд не производит, а второй источник того же вида кнопки — это
//    ровно тот подделанный признак, который модель устраняет.
//  • флаг `force_reply` на `replyKeyboardMarkup`/`replyInlineMarkup` (слой 229
//    оригинала) — в нашей схеме его нет; «попросить ответ» умеет только
//    отдельный конструктор `replyKeyboardForceReply` (`isForceReplyMarkup`).
//
// Клиентские поля оригинала `mid`/`fromId`/`pFlags.hidden`/`pFlags.used`
// (`schema_additional_params.json`) — есть: их заполняет `mergeReplyKeyboard`
// (порт ниже), складывая «последнюю клавиатуру» окна. На проводе их нет.
//  • остальные конструкторы `KeyboardButton` схемы (switch-inline, buy,
//    url-auth, game, request-peer/phone/poll/geo, copy, user-profile,
//    simple-web-view) — бэкенд их не производит; в отличие от вариантов
//    `PhotoSize`, объявленных «под кодек фазы 2», кнопка на провод попадает
//    только целиком со своим поведением, поэтому пустое объявление здесь ничего
//    не даёт.

import type { MyMessage } from '../models'
import { isLocalMessageId } from '../history/messageId'
import { toPeerId } from '../peers/peerId'

// ── KeyboardButton: объединение схемы, конструктор за конструктором ─────────

/** keyboardButtonUrl#d80c25ec flags:# style:flags.10?KeyboardButtonStyle text:string url:string = KeyboardButton; */
export interface KeyboardButtonUrl { _: 'keyboardButtonUrl'; text: string; url: string }
/** keyboardButtonCallback#e62bc960 flags:# requires_password:flags.0?true style:flags.10?KeyboardButtonStyle text:string data:bytes = KeyboardButton;
 *
 * `data` в схеме — `bytes`. На проводе фазы 0 (JSON) байты едут base64-строкой,
 * ровно как `photoStrippedSize.bytes` у медиа; на фазе 2 тип станет
 * `Uint8Array` вместе с кодеком. */
export interface KeyboardButtonCallback {
  _: 'keyboardButtonCallback'
  pFlags?: Partial<{ requires_password: true }>
  text: string
  data: string
}
/** keyboardButtonWebView#e846b1a0 flags:# style:flags.10?KeyboardButtonStyle text:string url:string = KeyboardButton; */
export interface KeyboardButtonWebView { _: 'keyboardButtonWebView'; text: string; url: string }

/** Кнопка клавиатуры. Простой `keyboardButton#7d170cff flags:# style:… text:string`
 * (кнопка reply-клавиатуры, шлёт свой текст сообщением) объявлен здесь же. */
export type KeyboardButton =
  | { _: 'keyboardButton'; text: string }
  | KeyboardButtonUrl
  | KeyboardButtonCallback
  | KeyboardButtonWebView

/** keyboardButtonRow#77608b83 buttons:Vector<KeyboardButton> = KeyboardButtonRow; */
export interface KeyboardButtonRow { _: 'keyboardButtonRow'; buttons: KeyboardButton[] }

// ── ReplyMarkup: объединение схемы ─────────────────────────────────────────

/** replyKeyboardHide#a03e5b85 flags:# selective:flags.2?true = ReplyMarkup; */
export interface ReplyKeyboardHide {
  _: 'replyKeyboardHide'
  pFlags?: Partial<{ selective: true }>
  /** клиентский: сообщение, которое сняло клавиатуру (`mergeReplyKeyboard`) */
  mid?: number
}
/** replyKeyboardForceReply#86b40b08 flags:# single_use:flags.1?true
 * selective:flags.2?true placeholder:flags.3?string = ReplyMarkup;
 *
 * Бэкендом не производится (принудительного ответа у нас нет), но объявлен:
 * ветвление оригинала по `_` обязано его различать, иначе «клавиатуры нет»
 * и «форс-ответ» снова сольются в одну ветку. */
export interface ReplyKeyboardForceReply {
  _: 'replyKeyboardForceReply'
  /** `hidden`/`used` — клиентские (`mergeReplyKeyboard`, `ReplyKeyboard.checkForceReply`) */
  pFlags?: Partial<{ single_use: true; selective: true; hidden: true; used: true }>
  placeholder?: string
  /** клиентские: сообщение с разметкой и его автор (`mergeReplyKeyboard`) */
  mid?: number
  fromId?: PeerId
}
/** replyKeyboardMarkup#85dd99d1 flags:# resize:flags.0?true single_use:flags.1?true
 * selective:flags.2?true persistent:flags.4?true rows:Vector<KeyboardButtonRow>
 * placeholder:flags.3?string = ReplyMarkup;
 *
 * `single_use` — то, что у нас звалось `oneTime`; `resize` так и остался
 * `resize`, но переехал в `pFlags`. */
export interface ReplyKeyboardMarkup {
  _: 'replyKeyboardMarkup'
  /** `hidden` — клиентский (`mergeReplyKeyboard`: одноразовую клавиатуру уже использовали) */
  pFlags?: Partial<{ resize: true; single_use: true; selective: true; persistent: true; hidden: true }>
  rows: KeyboardButtonRow[]
  placeholder?: string
  /** клиентские: сообщение с разметкой и его автор — бот (`mergeReplyKeyboard`) */
  mid?: number
  fromId?: PeerId
}
/** replyInlineMarkup#48a30254 rows:Vector<KeyboardButtonRow> = ReplyMarkup; */
export interface ReplyInlineMarkup { _: 'replyInlineMarkup'; rows: KeyboardButtonRow[] }

export type ReplyMarkup =
  | ReplyKeyboardHide
  | ReplyKeyboardForceReply
  | ReplyKeyboardMarkup
  | ReplyInlineMarkup

/**
 * Порт условия tweb, по которому под баблом появляется инлайн-клавиатура:
 * `bubbles.ts:7732-7745` рисует её только для `replyInlineMarkup` и вешает
 * класс `with-reply-markup`, лишь если в контейнере оказались кнопки
 * (`containerDiv.childElementCount`). Тот же предикат стоит у оригинала в
 * `bubbleGroups.ts:50-55` (`canHaveReplyMarkup`).
 */
/** Порт tweb `components/chat/bubbleParts/filterReplyMarkupRows.ts` (eedb2b74e):
 *  ряды инлайн-клавиатуры, в которых есть хоть одна кнопка. */
export function filterReplyMarkupRows(rows: KeyboardButtonRow[]): KeyboardButtonRow[] {
  return rows.filter((row) => row.buttons.length)
}

export function getInlineMarkupRows(markup: ReplyMarkup | undefined): KeyboardButtonRow[] | undefined {
  if (markup?._ !== 'replyInlineMarkup') return undefined
  return markup.rows.some((row) => row.buttons.length) ? markup.rows : undefined
}

/**
 * Порт tweb `appManagers/utils/messages/isForceReplyMarkup.ts`. У оригинала
 * (слой 229) «попросить ответ» может и клавиатура с флагом `force_reply`; в
 * нашей схеме флага нет, остаётся отдельный конструктор.
 */
export function isForceReplyMarkup(replyMarkup: ReplyMarkup | undefined): replyMarkup is ReplyKeyboardForceReply {
  return replyMarkup?._ === 'replyKeyboardForceReply'
}

/**
 * Последняя клавиатура окна — поля `HistoryStorage` оригинала, которые ведёт
 * `mergeReplyKeyboard`: `replyMarkup` и `maxOutId` (номер последнего своего
 * сообщения, по нему гасится одноразовая клавиатура).
 */
export interface ReplyKeyboardState {
  replyMarkup?: ReplyMarkup
  maxOutId?: number
}

type MarkupMessage = Pick<MyMessage, '_' | 'id' | 'pFlags' | 'peerId' | 'fromId'> & {
  reply_markup?: ReplyMarkup
  message?: string
  reply_to?: { reply_to_msg_id?: number }
  action?: { _: string, user_id?: number }
}

/** tweb `appMessagesManager.ts:8419-8434`. Эфемерных номеров у нас нет —
 *  остаётся сравнение номеров. */
function isAfterReplyMarkup(message: MarkupMessage, replyMarkup: ReplyMarkup): boolean {
  const mid = (replyMarkup as { mid?: number }).mid
  if (message.id === mid) {
    return false
  }

  return message.id > (mid ?? 0)
}

/**
 * Порт tweb `mergeReplyKeyboard` (`appMessagesManager.ts:8436-8532`): свести
 * сообщение в «последнюю клавиатуру» окна; `true` — клавиатура сменилась
 * (у оригинала по этому сигналу летит `history_reply_markup`).
 *
 * Расхождения:
 *  • оригинал ПИШЕТ клиентские поля в разметку самого сообщения
 *    (`messageReplyMarkup.mid = message.mid`, `pFlags.hidden = true`); у нас
 *    сообщение лежит в зеркале окна, которое правит только проектор, поэтому
 *    в состояние кладётся КОПИЯ разметки с этими полями;
 *  • эфемерных сообщений нет (`isEphemeralMessageId`), «ещё не отправлено»
 *    (`pFlags.is_outgoing`) — дробный номер (`isLocalMessageId`);
 *  • `isBot` — предикат вызывающего (у оригинала `appUsersManager.isBot`).
 */
export function mergeReplyKeyboard(
  state: ReplyKeyboardState,
  message: MarkupMessage | undefined,
  isBot: (userId: number) => boolean,
): boolean {
  if (!message) {
    return false
  }

  const messageReplyMarkup = message.reply_markup
  const isService = message._ === 'messageService'
  if (!messageReplyMarkup && !message.pFlags?.out && !isService) {
    return false
  }

  // инлайн-разметка живёт целиком в своём бабле (флага `force_reply` у нас нет)
  if (messageReplyMarkup?._ === 'replyInlineMarkup') {
    return false
  }

  const lastReplyMarkup = state.replyMarkup
  if (messageReplyMarkup) {
    if (lastReplyMarkup && !isAfterReplyMarkup(message, lastReplyMarkup)) {
      return false
    }

    if (messageReplyMarkup.pFlags?.selective) {
      return false
    }

    let hidden: true | undefined
    if (state.maxOutId &&
      message.id < state.maxOutId &&
      (messageReplyMarkup._ === 'replyKeyboardMarkup' || messageReplyMarkup._ === 'replyKeyboardForceReply') &&
      messageReplyMarkup.pFlags?.single_use) {
      hidden = true
    }

    if (messageReplyMarkup._ === 'replyKeyboardHide') {
      state.replyMarkup = { ...messageReplyMarkup, mid: message.id }
    } else {
      state.replyMarkup = {
        ...messageReplyMarkup,
        pFlags: { ...messageReplyMarkup.pFlags, ...(hidden && { hidden }) },
        mid: message.id,
        fromId: message.fromId ?? message.peerId,
      } as ReplyKeyboardMarkup | ReplyKeyboardForceReply
    }

    return true
  }

  if (message.pFlags?.out) {
    if (lastReplyMarkup) {
      const last = lastReplyMarkup as ReplyKeyboardMarkup | ReplyKeyboardForceReply
      // одноразовую клавиатуру тратит следующее сообщение, форс-ответ — ответ на него
      const answersForceReply = isForceReplyMarkup(last) &&
        message.reply_to?.reply_to_msg_id === last.mid
      if ((last.pFlags?.single_use || answersForceReply) &&
        !last.pFlags?.hidden &&
        (answersForceReply || isAfterReplyMarkup(message, last) || isLocalMessageId(message.id)) &&
        message.message) {
        state.replyMarkup = {
          ...last,
          pFlags: { ...last.pFlags, hidden: true },
        } as ReplyKeyboardMarkup | ReplyKeyboardForceReply
        return true
      }
    } else if (!state.maxOutId || message.id > state.maxOutId) {
      state.maxOutId = message.id
    }
  }

  const action = isService ? message.action : undefined
  if (action?._ === 'messageActionChatDeleteUser' &&
    (lastReplyMarkup ?
      toPeerId(action.user_id!, false) === (lastReplyMarkup as ReplyKeyboardMarkup).fromId :
      isBot(action.user_id!)
    )
  ) {
    state.replyMarkup = {
      _: 'replyKeyboardHide',
      mid: message.id,
      pFlags: {},
    }
    return true
  }

  return false
}

/**
 * «Последняя клавиатура» окна — свёртка `mergeReplyKeyboard` по окну в
 * порядке номеров. У оригинала она копится в `historyStorage.replyMarkup` по
 * мере доезда сообщений; у нас окно — зеркало (`core/history/messagesMirror`),
 * и состояние выводится из него целиком.
 */
export function getHistoryReplyMarkup(
  messages: readonly MarkupMessage[],
  isBot: (userId: number) => boolean,
): ReplyMarkup | undefined {
  const state: ReplyKeyboardState = {}
  for (const message of messages) {
    mergeReplyKeyboard(state, message, isBot)
  }

  return state.replyMarkup
}
