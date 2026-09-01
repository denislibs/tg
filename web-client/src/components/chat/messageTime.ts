// Время бабла — порт tweb `MessageRender.setTime` (messageRender.ts:209-393).
//
// ДВОЙНОЙ РЕНДЕР — не избыточность, а способ раскладки, и он взят у оригинала
// (:344-392): части кладутся и в сам `span.time`, и ДУБЛЕМ внутрь
// `div.time-inner`. Первый занимает место в потоке текста (чтобы последняя
// строка подписи не налезала на время), второй позиционируется абсолютно и
// виден. CSS обеих ролей уже портирован (`styles/tweb/_chatBubble.scss`).
//
// ─── Чего здесь нет и почему ────────────────────────────────────────────────
//  • статус отправки (галочки) и счётчик ответов — оригинал добавляет их ПОЗЖЕ
//    и в оба узла (`setBubbleSendingStatus` :6382-6408, `setBubbleRepliesCount`
//    :6410-6431), потому что они меняются у уже отрисованного бабла; поэтому
//    оба живут отдельными функциями ниже (`setSendingStatus`,
//    `setRepliesCount`), а не внутри сборки времени.
//  • дайс, подпись автора поста, эффект сообщения, платные сообщения,
//    расписание повтора — таких сообщений наша модель не производит.
//  • `message_primary_edited_date` (время правки ВМЕСТО времени отправки) —
//    настройка приложения, которой у нас нет; показываем метку «edited», как
//    делает оригинал без этой настройки.
import type { MyMessage } from '@core/models'
import Icon from '@components/icon'
import type { IconName } from '@core/tgico-icons'
import { fmtViews } from '@core/format/fmtViews'
import { formatTime, getFullDate, isValidTimestamp } from '@helpers/date'
import { useI18nStore } from '../../i18n'

/**
 * «ЧЧ:ММ» — порт `makeTime` (tweb `chat/utils.ts:39-41`), которым `setTime`
 * строит время и в `span.time`, и в его дубле (`messageRender.ts:255`, `:386`).
 *
 * Возвращает УЗЕЛ, а не строку, и это здесь главное: `formatTime` отдаёт
 * `IntlDateElement`, который кладёт себя в `I18n.weakMap`, а дальше его ведёт
 * ядро — ветка `hour+minute` собирает часы и минуты РУКАМИ, мимо `Intl`
 * (`lib/langPack.ts:624-633`), потому что 12/24 часа берётся из настройки
 * пользователя, а `Intl` выбирает цикл по локали и спросить его неоткуда.
 * Прежняя сборка через `padStart` настройку не читала вовсе: `I18n.setTimeFormat`
 * переписывает `.i18n`-узлы, а строка в `textContent` остаётся на 24 часах
 * навсегда — это и была задача #124.
 *
 * Ветка `includeDate` оригинала (`utils.ts:40` → `formatFullSentTimeRaw(…,
 * {combined: true})`) здесь не воспроизводится: она включается условием
 * `message.peerId === rootScope.myId && !options.isOut` (`messageRender.ts:221`),
 * то есть только во ВХОДЯЩЕМ бабле «Избранного», а `createMessageTime` про
 * направление бабла не знает. Расхождение названо ЗАДАЧЕЙ #125.
 */
function makeTime(date: number): HTMLElement | null {
  return isValidTimestamp(date) ? formatTime(new Date(date * 1000)) : null
}

/**
 * Полная дата — `title` у `time-inner` (tweb `messageRender.ts:257`:
 * `getFullDate(new Date(message.date * 1000))`).
 *
 * Месяц здесь АНГЛИЙСКИЙ во всех языках, и это не недосмотр: `getFullDate`
 * оригинала берёт `months` из `helpers/date/common.ts` — константы, а не
 * `monthsLocalized`. Подсказка техническая. Прежний `toLocaleString()` без
 * аргументов брал локаль БРАУЗЕРА, то есть не совпадал ни с оригиналом, ни с
 * языком приложения.
 */
function fullDate(date: number): string {
  const d = new Date(date * 1000)
  return Number.isNaN(d.getTime()) ? '' : getFullDate(d)
}

/**
 * `span.time` со всеми частями и их дублем в `div.time-inner`.
 *
 * Порядок частей — оригинала: просмотры поста, метка правки, само время
 * последним (:340-342).
 */
export function createMessageTime(message: MyMessage): HTMLElement {
  const t = useI18nStore.getState().t
  const real = message._ === 'message' ? message : undefined

  const parts = (): HTMLElement[] => {
    const out: HTMLElement[] = []

    // Просмотры поста канала (:264-276 — `span.post-views`). Формат — КОМПАКТНЫЙ
    // (`formatNumber(message.views, 1)`, :276): «9200» пишется как «9.2K». Тот же
    // `fmtViews` пишет сюда и живое обновление счётчика (`messages_views` в
    // `chat/bubbles.ts`) — иначе первый же кадр менял бы не только число, но и
    // его формат.
    if (real?.views) {
      const views = document.createElement('span')
      views.classList.add('post-views')
      views.textContent = fmtViews(real.views)
      out.push(views)
    }

    // «edited». Гейта `edit_hide` у оригинала здесь нет предмета: этого флага
    // наша модель сообщения не объявляет вовсе (его ставит бот, скрывая факт
    // правки, а ботов-редакторов у нас нет).
    if (real?.edit_date) {
      const edited = document.createElement('i')
      edited.classList.add('time-edited')
      edited.textContent = t('EditedMessage')
      out.push(edited)
    }

    // Время — последним (:340-342). Узел СВОЙ на каждый вызов `parts()`: у
    // оригинала `makeTime` тоже зовётся дважды (:255 и :386), потому что один и
    // тот же узел не может лежать в двух местах DOM, а клонировать `.i18n`
    // нельзя — клон в `weakMap` не записан (:375-382 исключает такие узлы из
    // клонирования поимённо).
    const time = makeTime(message.date)
    if (time) out.push(time)

    return out
  }

  const timeSpan = document.createElement('span')
  timeSpan.classList.add('time')
  timeSpan.append(...parts())

  const inner = document.createElement('div')
  inner.classList.add('time-inner')
  inner.title = fullDate(message.date)
  // Дубль строится ЗАНОВО, а не клонированием: у оригинала часть узлов
  // клонировать нельзя (i18n, реакции, эффект), и он выбирает поэлементно
  // (:375-382), а время пересобирает отдельной строкой (:383-386) именно
  // потому, что оно `.i18n`. У нас `.i18n` среди частей ровно одна — время, —
  // и второй вызов `parts()` даёт ей новый узел сам, без разбора исключений.
  inner.append(...parts())

  timeSpan.append(inner)
  return timeSpan
}

/** Иконка статуса по его имени — тот же выбор, что у оригинала (:6394-6398). */
function statusIcon(status: SendingStatus): IconName {
  switch (status) {
    case 'error': return 'sendingerror'
    case 'sending': return 'sending'
    case 'sent': return 'check'
    case 'read': return 'checks'
  }
}

/** Статусы отправки своего сообщения — имена оригинала. */
export type SendingStatus = 'sending' | 'error' | 'sent' | 'read'

/**
 * Значок отправки — порт `setBubbleSendingStatus` (tweb bubbles.ts:6382-6408).
 *
 * Значок ставится в ОБА узла (`.time` и `.time-inner`) — по той же причине, по
 * которой части времени дублируются: видимая копия одна, но занимать место
 * должны обе. Оригинал ищет их запросом `bubble.querySelectorAll('.time,
 * .time-inner')`, и здесь то же самое.
 *
 * ЗАМЕНА, А НЕ ДОБАВЛЕНИЕ: если значок уже стоит первым, он заменяется
 * (:6402-6406). Иначе смена «отправляется» → «доставлено» оставила бы оба.
 *
 * Классы бабла (`is-sending`/`is-sent`/`is-read`/`is-error`) здесь НЕ ставятся:
 * их считает общий с React-лентой `bubbleClasses` по тому же правилу
 * оригинала (:6384). Второй ответ на тот же вопрос разъехался бы с первым.
 */
export function setSendingStatus(timeSpan: HTMLElement, status: SendingStatus | undefined): void {
  const targets: HTMLElement[] = [timeSpan]
  const inner = timeSpan.querySelector<HTMLElement>('.time-inner')
  if (inner) targets.push(inner)

  for (const target of targets) {
    const existing = target.querySelector('.time-sending-status')
    const isReplacingFirst = !!existing && target.firstElementChild === existing

    if (!status) {
      if (isReplacingFirst) existing.remove()
      continue
    }

    const icon = Icon(statusIcon(status), 'time-sending-status')
    if (isReplacingFirst) existing.replaceWith(icon)
    else target.prepend(icon)
  }
}

/** Порт `numberThousandSplitter` (tweb `helpers/number/numberThousandSplitter.ts`)
 *  с разделителем по умолчанию — неразрывным он в оригинале не делается.
 *  Копия локальная: ванильный потребитель у него ровно один — счётчик ниже. */
function numberThousandSplitter(x: number): string {
  return String(x).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
}

/**
 * Счётчик ответов В ВРЕМЕНИ — порт `setBubbleRepliesCount`
 * (tweb bubbles.ts:6410-6431).
 *
 * Это ДРУГАЯ ветка, чем футер «N комментариев»: футер рисуется у поста канала с
 * привязанным обсуждением (`replies.pFlags.comments` + `channel_id`), а этот
 * счётчик — у сообщения ГРУППЫ, у которого есть ответы и ничего из этих двух
 * ключей нет (гейт развилки — bubbles.ts:9682/9698, данные —
 * `usecase/chat/messagescontainer.go::hydrateThreads`).
 *
 * Ставится в ОБА узла времени (`.time` и `.time-inner`) — по той же причине,
 * что значок отправки: видимая копия одна, но занимать место должны обе.
 * `count === 0` СНИМАЕТ счётчик (:6415-6418): ответы можно удалить.
 *
 * Гейт `if(this.chat.threadId) return` (:6411) живёт у вызывающего — внутри
 * треда счётчик не показывается, а знание «мы в треде» принадлежит ленте.
 */
export function setRepliesCount(bubble: HTMLElement, count: number): void {
  for (const element of bubble.querySelectorAll<HTMLElement>('.time, .time-inner')) {
    const previous = element.querySelector<HTMLElement>('.time-replies')
    if (!count) {
      previous?.remove()
      continue
    }

    const span = previous ?? document.createElement('span')
    if (!previous) {
      span.classList.add('time-replies')
      // tweb :6422 — текстовый узел ПЕРВЫМ, иконка за ним: число пишется в
      // `firstChild`, не переписывая иконку.
      span.append(document.createTextNode(''), Icon('reply_filled', 'time-replies-icon', 'time-icon'))
    }

    span.firstChild!.textContent = numberThousandSplitter(count)

    if (!span.parentElement) element.prepend(span)
  }
}
