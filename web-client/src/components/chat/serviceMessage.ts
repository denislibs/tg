// src/components/chat/serviceMessage.ts
//
// Сервисные сообщения ленты УЗЛАМИ. Порт трёх мест tweb:
//   • фраза  — `components/wrappers/messageActionTextNewUnsafe.ts`
//     (`wrapLinkToMessage`, `wrapSomeText`, `getNameDivHTML` → `PeerTitle`)
//     плюс сборка результата в `span.i18n` (`lib/langPack.ts::IntlElement`);
//   • каркас экшен-бабла — `chat/bubbles.ts:6725-7270` (ветка `bubble.className =
//     'bubble service'`: `.bubble-content-wrapper > .bubble-content > .service-msg`);
//   • дата-разделитель — `chat/bubbles.ts:4780-4812` (`createDateBubble`).
//
// Сверено с живым DOM tweb (`docs/tweb/dom/dumps/03-service-round.json`, §«service
// action bubble», и `20-cm-05-service.json`): у ЭКШЕН-бабла обёртка
// `.bubble-content-wrapper` ЕСТЬ, у ДАТА-разделителя (`03-bubbles-123.json`,
// `.bubble.service.is-date > .bubble-content > .service-msg > span.i18n`) её НЕТ.
//
// ─── Расхождения с tweb (осознанные) ──────────────────────────────────────────
//  • Разбор экшена — наш `core/serviceMsg.ts::serviceMsgSegs` (сегменты
//    text/peer/msg), а не `switch` по TL-конструктору + langPack: у нас сервисное
//    действие приезжает конструктором `action`, а словаря langPack нет. Здесь — только
//    УЗЛЫ по готовым сегментам, второго разбора не заводим.
//  • tweb различает текст шаблона фразы (кладётся строкой) и текст-АРГУМЕНТ
//    (`wrapSomeText` → `htmlToSpan`, т.е. лишний `<span>` без класса). В
//    `ServiceSeg` этого различия нет — оба приезжают `kind:'text'`, поэтому оба
//    кладутся текстовыми узлами (`wrapEmojiText`), без обёртки. Разница
//    невидимая: тот `<span>` в tweb без класса и без стилей.
//  • Никаких inline-обработчиков (правило `web-client/CLAUDE.md`, «Безопасность»).
//    tweb тоже не вешает их на эти узлы — он делегирует клик с контейнера ленты,
//    читая `data-peer-id` / `data-saved-from` (`bubbles.ts:3360-3395`); мы держим
//    ту же схему (как `lib/richtext/url.ts` держит её для `data-anchor-action`).
//  • Медиа сервисного бабла (`wrapServiceMediaBubble`: аватар-кружок нового фото
//    чата, кнопка «Установить фото» у `suggest_photo`) и solid-компоненты
//    (подарки, giveaway, NoForwardsRequest) НЕ портированы — это отдельные
//    подсистемы, здесь была бы заглушка.
//  • `is-group-first`/`is-group-last` на бабл не вешаются: как и в tweb, их
//    владелец — группировка (`components/chat/bubbleGroups.ts`).
import { wrapEmojiText } from '@lib/richtext'
import { serviceMsgSegs, type ServiceSeg } from '@core/serviceMsg'
import type { MessageService } from '@core/models'
import PeerTitle, { type PeerTitleOptions } from './peerTitle'

/** Порт tweb `helpers/dom/setInnerHTML.ts::setDirection` (тот же приём, что в
 *  `lib/richtext/wrapRichText.ts` у цитаты). */
function setDirection(element: Element) {
  element.setAttribute('dir', 'auto')
}

/** Имя пира в сервисной фразе — ТОТ ЖЕ узел `PeerTitle`, что у автора бабла.
 *
 *  Своей копии здесь больше нет. Прежняя печатала имя, пришедшее в JSON
 *  действия, — а бэкенд перестал его слать (порт пиров, `serviceText`), и
 *  фолбэк «Пользователь» стал единственным, что видел пользователь. Настоящий
 *  `PeerTitle` берёт имя из зеркала карточек синхронно, объявляет пробел
 *  зеркала и перерисовывается, когда карточка приезжает. */
function createPeerTitle(
  seg: Extract<ServiceSeg, { kind: 'peer' }>,
  { middleware, managers }: Pick<PeerTitleOptions, 'middleware' | 'managers'>,
): HTMLElement {
  // Ссылки нет вовсе — сообщение из истории, записанное до перехода на ссылки.
  // Карточки для него не существует, поэтому имя идёт `fromName`, как у send-as,
  // а ключ — NULL_PEER_ID: узел остаётся целью делегированного клика, и тот
  // молча его игнорирует (`bubbles.ts:3398`), вместо того чтобы вести в «чат 0».
  return new PeerTitle(
    seg.peerId != null
      ? { peerId: seg.peerId, middleware, managers }
      : { peerId: NULL_PEER_ID, fromName: seg.fallback, middleware, managers },
  ).element
}

/** tweb `@appManagers/constants.ts::NULL_PEER_ID` — «пир неизвестен». */
const NULL_PEER_ID = 0

/**
 * Ссылка на сообщение (закреплённое) — порт tweb `wrapLinkToMessage`
 * (`messageActionTextNewUnsafe.ts:31-42`): узел `<i>` с адресом в
 * `data-saved-from`, клик по которому лента разбирает делегированием.
 *
 * Адрес — `peerId_mid`, как в оригинале. `seq` из сегмента здесь не участвует:
 * он нужен был React-ленте (`jumpToSeq`), а императивная адресует сообщения по
 * `id` (см. докблок `FullMid` в `bubbles.ts`) и `seq` при надобности берёт из
 * зеркала окна.
 */
function createLinkToMessage(seg: Extract<ServiceSeg, { kind: 'msg' }>, peerId: number): HTMLElement {
  const element = document.createElement('i')
  if (seg.msgId !== undefined) {
    element.dataset.savedFrom = `${peerId}_${seg.msgId}`
  }
  element.append(wrapEmojiText(seg.text))
  setDirection(element)
  return element
}

/** Общее для фразы и бабла: чей это чат (адрес ссылки на сообщение) и что
 *  разбирать. */
export interface ServiceActionOptions {
  /** САМО служебное сообщение: фраза строится из `action` (объединение
   *  конструкторов), а не из JSON внутри текста. Формулировки «Вы …» решает
   *  `pFlags.out` самого сообщения. */
  message: MessageService
  /** превью ЗАКРЕПЛЁННОГО, разрешённое вызывающим по `reply_to` (у
   *  `messageActionPinMessage` параметров нет вовсе) */
  pinnedPreview?: string
  /** peerId чата — первая половина адреса в `data-saved-from` */
  peerId: number
  /** нужны узлу имени: жизненный цикл подписки на зеркало и объявление пробела */
  middleware: PeerTitleOptions['middleware']
  managers: PeerTitleOptions['managers']
}

/**
 * Фраза сервисного сообщения узлами — аналог tweb `wrapMessageActionTextNew`.
 * Результат тот же, что у оригинала: `span.i18n` c текстом, `span.peer-title`
 * и `i[data-saved-from]` внутри (tweb собирает его `_i18n(element, key, args)`,
 * `langPack.ts:652`, и так же зовёт `normalize()` при наличии аргументов).
 */
export function wrapMessageActionText({ message, pinnedPreview, peerId, middleware, managers }: ServiceActionOptions): HTMLSpanElement {
  const element = document.createElement('span')
  element.classList.add('i18n')

  for (const seg of serviceMsgSegs(message, pinnedPreview)) {
    if (seg.kind === 'peer') {
      element.append(createPeerTitle(seg, { middleware, managers }))
    } else if (seg.kind === 'msg') {
      element.append(createLinkToMessage(seg, peerId))
    } else {
      element.append(wrapEmojiText(seg.text))
    }
  }

  element.normalize()
  return element
}

export interface ServiceBubbleOptions extends ServiceActionOptions {
  /** `Message.id` — `data-mid` бабла (у tweb там `mid`) */
  mid?: number
  /** время сообщения в СЕКУНДАХ unix — `data-timestamp` бабла */
  timestamp?: number
}

/**
 * Сервисный экшен-бабл целиком: `.bubble.service > .bubble-content-wrapper >
 * .bubble-content > .service-msg > span.i18n` (tweb `bubbles.ts:6620-6628` даёт
 * каркас, `:6725-7270` — ветку service; живой DOM — `03-service-round.json`).
 *
 * Классы группировки (`is-group-first`/`is-group-last`) вешает не он, а
 * `bubbleGroups.ts` — как и в tweb.
 */
export function createServiceBubble({ message, pinnedPreview, peerId, mid, timestamp, middleware, managers }: ServiceBubbleOptions): HTMLDivElement {
  const bubble = document.createElement('div')
  bubble.className = 'bubble service'
  if (mid !== undefined) {
    bubble.dataset.mid = '' + mid
  }
  bubble.dataset.peerId = '' + peerId
  if (timestamp !== undefined) {
    bubble.dataset.timestamp = '' + timestamp
  }

  const contentWrapper = document.createElement('div')
  contentWrapper.classList.add('bubble-content-wrapper')

  const bubbleContainer = document.createElement('div')
  bubbleContainer.classList.add('bubble-content')

  const serviceMsg = document.createElement('div')
  serviceMsg.classList.add('service-msg')
  serviceMsg.append(wrapMessageActionText({ message, pinnedPreview, peerId, middleware, managers }))

  bubbleContainer.append(serviceMsg)
  contentWrapper.append(bubbleContainer)
  bubble.append(contentWrapper)

  return bubble
}

/**
 * Дата-разделитель — порт tweb `ChatBubbles.createDateBubble`
 * (`bubbles.ts:4780-4812`): `.bubble.service.is-date > .bubble-content >
 * .service-msg > span.i18n`, БЕЗ `.bubble-content-wrapper` (живой DOM —
 * `03-bubbles-123.json`).
 *
 * Готовую подпись дня («Сегодня», «19 июля») считает вызывающий
 * (`core/format/dayLabel`) — в tweb на этом месте `i18n(...)`/`formatDate(...)`,
 * то есть тоже узел `span.i18n` с готовым текстом.
 *
 * Секцию `.bubbles-date-group`, второй («фейковый», `.is-fake`) экземпляр этого
 * же бабла и его позицию делает владелец контейнеров дня
 * (tweb `getDateContainerByTimestamp`, bubbles.ts:4822-4841) — не этот модуль.
 */
export function createDateBubble(label: string): HTMLDivElement {
  const bubble = document.createElement('div')
  bubble.className = 'bubble service is-date'

  const bubbleContent = document.createElement('div')
  bubbleContent.classList.add('bubble-content')

  const serviceMsg = document.createElement('div')
  serviceMsg.classList.add('service-msg')

  const dateElement = document.createElement('span')
  dateElement.classList.add('i18n')
  dateElement.textContent = label

  serviceMsg.append(dateElement)
  bubbleContent.append(serviceMsg)
  bubble.append(bubbleContent)

  return bubble
}
