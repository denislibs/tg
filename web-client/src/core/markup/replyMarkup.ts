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
//  • клиентские поля оригинала `mid`/`fromId`/`pFlags.hidden`/`pFlags.used`
//    (`schema_additional_params.json`) — их заполняет `mergeReplyKeyboard`
//    (tweb `appMessagesManager.ts:5854-5932`), ведущий `historyStorage
//    .replyMarkup`. Этого механизма у нас нет: клавиатуру над композером мы
//    ищем сканом окна (`Chat.tsx`), а не отдельным хранилищем. Порт
//    `mergeReplyKeyboard` — отдельная работа, до неё полям нечего хранить.
//  • остальные конструкторы `KeyboardButton` схемы (switch-inline, buy,
//    url-auth, game, request-peer/phone/poll/geo, copy, user-profile,
//    simple-web-view) — бэкенд их не производит; в отличие от вариантов
//    `PhotoSize`, объявленных «под кодек фазы 2», кнопка на провод попадает
//    только целиком со своим поведением, поэтому пустое объявление здесь ничего
//    не даёт.

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
}
/** replyKeyboardForceReply#86b40b08 flags:# single_use:flags.1?true
 * selective:flags.2?true placeholder:flags.3?string = ReplyMarkup;
 *
 * Бэкендом не производится (принудительного ответа у нас нет), но объявлен:
 * ветвление оригинала по `_` обязано его различать, иначе «клавиатуры нет»
 * и «форс-ответ» снова сольются в одну ветку. */
export interface ReplyKeyboardForceReply {
  _: 'replyKeyboardForceReply'
  pFlags?: Partial<{ single_use: true; selective: true }>
  placeholder?: string
}
/** replyKeyboardMarkup#85dd99d1 flags:# resize:flags.0?true single_use:flags.1?true
 * selective:flags.2?true persistent:flags.4?true rows:Vector<KeyboardButtonRow>
 * placeholder:flags.3?string = ReplyMarkup;
 *
 * `single_use` — то, что у нас звалось `oneTime`; `resize` так и остался
 * `resize`, но переехал в `pFlags`. */
export interface ReplyKeyboardMarkup {
  _: 'replyKeyboardMarkup'
  pFlags?: Partial<{ resize: true; single_use: true; selective: true; persistent: true }>
  rows: KeyboardButtonRow[]
  placeholder?: string
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
export function getInlineMarkupRows(markup: ReplyMarkup | undefined): KeyboardButtonRow[] | undefined {
  if (markup?._ !== 'replyInlineMarkup') return undefined
  return markup.rows.some((row) => row.buttons.length) ? markup.rows : undefined
}

/**
 * Клавиатура над композером: ряды последней подходящей разметки окна или `null`,
 * если её показывать не надо.
 *
 * Сведение двух мест оригинала в нашем периметре:
 *  • какую разметку считать текущей — `mergeReplyKeyboard`
 *    (tweb `appMessagesManager.ts:5854-5932`): `replyInlineMarkup` она
 *    ПРОПУСКАЕТ (:5867-5869) и оставляет прошлую клавиатуру, поэтому кнопки под
 *    баблом не гасят клавиатуру над строкой ввода;
 *  • показывать ли её — `ReplyKeyboard.checkAvailability`
 *    (tweb `replyKeyboard.tsx:145-149`): скрыто у `replyKeyboardHide` и у
 *    разметки без рядов.
 *
 * Отличие от оригинала одно: у нас нет `historyStorage.replyMarkup`, поэтому
 * «последняя разметка» ищется сканом окна, а не читается из хранилища. Порт
 * самого хранилища (вместе с `mid`/`fromId`/`single_use`-скрытием) — отдельная
 * работа.
 */
export function findReplyKeyboardRows(
  messages: readonly { replyMarkup?: ReplyMarkup }[],
): KeyboardButtonRow[] | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const markup = messages[i].replyMarkup
    if (!markup || markup._ === 'replyInlineMarkup') continue
    if (markup._ !== 'replyKeyboardMarkup' || !markup.rows.length) return null
    return markup.rows
  }
  return null
}
