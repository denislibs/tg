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
//    :6410-6431), потому что они меняются у уже отрисованного бабла. Их место —
//    вместе с подпиской на ack и на кадр комментариев.
//  • дайс, подпись автора поста, эффект сообщения, платные сообщения,
//    расписание повтора — таких сообщений наша модель не производит.
//  • `message_primary_edited_date` (время правки ВМЕСТО времени отправки) —
//    настройка приложения, которой у нас нет; показываем метку «edited», как
//    делает оригинал без этой настройки.
import type { MyMessage } from '@core/models'
import Icon from '@components/icon'
import type { IconName } from '@core/tgico-icons'
import { useI18nStore } from '../../i18n'

/** «HH:MM» — тот же формат, что у витрины списка (`messageToConvMsg.hhmm`). */
function hhmm(date: number): string {
  const d = new Date(date * 1000)
  if (Number.isNaN(d.getTime())) return ''
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** Полная дата — `title` у `time-inner` (tweb `inner.title = title`). */
function fullDate(date: number): string {
  const d = new Date(date * 1000)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString()
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

    // Просмотры поста канала (:264 — `span.post-views`).
    if (real?.views) {
      const views = document.createElement('span')
      views.classList.add('post-views')
      views.textContent = String(real.views)
      out.push(views)
    }

    // «edited». Гейта `edit_hide` у оригинала здесь нет предмета: этого флага
    // наша модель сообщения не объявляет вовсе (его ставит бот, скрывая факт
    // правки, а ботов-редакторов у нас нет).
    if (real?.edit_date) {
      const edited = document.createElement('i')
      edited.classList.add('time-edited')
      edited.textContent = t('edited')
      out.push(edited)
    }

    const time = document.createElement('span')
    time.classList.add('time-inner-text')
    time.textContent = hhmm(message.date)
    out.push(time)

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
  // (:375-382). Наши части все простые, поэтому второй вызов сборки — тот же
  // ответ без разбора исключений.
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
