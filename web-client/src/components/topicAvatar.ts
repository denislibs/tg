// Порт tweb `src/components/topicAvatar.ts` (812502980, 64 строки) — значок темы
// форума: «облачко» `#topic-icon` из `#svg-defs` с градиентом по цвету темы и
// инициалом названия. Плюс `wrapTopicIcon` — tweb
// `components/wrappers/messageActionTextNewUnsafe.ts:101-141`: какой значок у темы.
// Файла-обёртки служебных сообщений у нас нет, функция живёт рядом со значком.
//
// Расхождения с оригиналом:
//  1. `icon_color` у нас — номер цвета (0…5, его пишет бэкенд из формы темы,
//     `forum_topics.icon_color`), у tweb — сам цвет (`0x6FB9F0`). Номер
//     переводится в цвет `TOPIC_COLORS`, всё прочее берётся как цвет.
//  2. Значок-эмодзи темы у нас — эмодзи строкой (`icon_emoji_emoticon`,
//     клиентский параметр схемы), а не документ кастом-эмодзи (`icon_emoji_id`
//     → `wrapCustomEmojiAwaited`): рендерера кастом-эмодзи нет. Эмодзи —
//     `wrapEmojiText` в `.topic-icon`.
//  3. General (`id === GENERAL_TOPIC_ID`, `:108`) у tweb — кастом-эмодзи
//     `5390854796011906616`; у нас его нет, поэтому — решётка
//     `.topic-icon-general` из закомментированной ветки оригинала (`:116-127`).
import { TOPIC_COLORS } from '@core/forumTopicConstants'
import { GENERAL_TOPIC_ID } from '@core/history/messageId'
import { hexaToHsla } from '@shared/lib/color'
import { wrapAbbreviation } from '@lib/richtext/abbreviation'
import { wrapEmojiText } from '@lib/richtext'

let svg: SVGSVGElement | undefined
let span: HTMLElement | undefined
let defs: HTMLElement | undefined
const hadColors: Map<number, string> = new Map()

/** Расхождение 1. */
function getTopicColor(color: number) {
  return color >= 0 && color < TOPIC_COLORS.length ? TOPIC_COLORS[color] : color
}

/** tweb `:7-63` */
export default function topicAvatar(color: number, content: string) {
  if(!svg || !span || !defs?.isConnected) {
    defs = document.getElementById('svg-defs') as HTMLElement

    const ns = 'http://www.w3.org/2000/svg'

    svg = document.createElementNS(ns, 'svg')
    svg.setAttributeNS(null, 'width', '26')
    svg.setAttributeNS(null, 'height', '26')
    svg.setAttributeNS(null, 'viewBox', '0 0 26 26')
    svg.classList.add('topic-icon-svg')

    const use = document.createElementNS(ns, 'use')
    use.setAttributeNS(null, 'href', '#topic-icon')
    svg.append(use)

    span = document.createElement('span')
    span.classList.add('topic-icon', 'avatar-like')

    const contentSpan = document.createElement('span')
    contentSpan.classList.add('topic-icon-content')
    span.append(svg, contentSpan)
    hadColors.clear()
  }

  color = getTopicColor(color)
  if(!color) {
    color = TOPIC_COLORS[0]
  }

  if(!content) {
    content = ''
  }

  const hex = color.toString(16).padStart(6, '0')

  const gradientId = `topic-icon-gradient-${color}`
  let strokeColor = hadColors.get(color)
  if(!strokeColor) {
    const { h, s, l, a } = hexaToHsla('#' + hex)
    defs?.insertAdjacentHTML('beforeend', `
      <linearGradient id="${gradientId}" x1="0" x2="0" y1="0" y2="1">
        <stop style="stop-color: #${hex};" offset="0%" />
        <stop style="stop-color: hsla(${h}, ${s}%, ${Math.max(0, l - 30)}%, ${a});" offset="100%" />
      </linearGradient>
    `)

    hadColors.set(color, strokeColor = `hsla(${h}, ${s}%, ${Math.max(0, l - 40)}%, ${a})`)
  }

  const clone = span.cloneNode(true) as HTMLElement
  ;(clone.firstElementChild as SVGElement).style.fill = `url(#${gradientId})`
  ;(clone.firstElementChild as SVGElement).style.stroke = strokeColor
  clone.lastElementChild!.append(wrapAbbreviation(content, true))
  return clone
}

/** Тема в объёме значка: то, что читает `wrapTopicIcon`. */
export type TopicIconSource = {
  /** номер темы — General узнаётся по нему (расхождение 3) */
  id: number,
  title: string,
  icon_color: number,
  /** расхождение 2 */
  icon_emoji?: string,
}

/** Решётка General — закомментированная ветка tweb `:116-127` (расхождение 3). */
function wrapGeneralTopicIcon() {
  const span = document.createElement('span')
  span.innerHTML = `
      <svg class="topic-icon-general" width="22" height="22" viewBox="0 0 22 22" xmlns="http://www.w3.org/2000/svg">
        <path fill-rule="evenodd" clip-rule="evenodd" d="M11.2788 4.3654C11.4806 3.65912 11.0717 2.92299 10.3654 2.72119C9.65911 2.5194 8.92297 2.92836 8.72118 3.63464L7.85393 6.67H6C5.26546 6.67 4.67 7.26546 4.67 8C4.67 8.73454 5.26546 9.33 6 9.33H7.09393L6.13965 12.67H4C3.26546 12.67 2.67 13.2655 2.67 14C2.67 14.7345 3.26546 15.33 4 15.33H5.37965L4.72118 17.6346C4.51938 18.3409 4.92835 19.0771 5.63463 19.2788C6.3409 19.4806 7.07704 19.0717 7.27883 18.3654L8.14609 15.33H11.3796L10.7212 17.6346C10.5194 18.3409 10.9283 19.0771 11.6346 19.2788C12.3409 19.4806 13.077 19.0717 13.2788 18.3654L14.1461 15.33H16C16.7345 15.33 17.33 14.7345 17.33 14C17.33 13.2655 16.7345 12.67 16 12.67H14.9061L15.8604 9.33H18C18.7345 9.33 19.33 8.73454 19.33 8C19.33 7.26546 18.7345 6.67 18 6.67H16.6204L17.2788 4.3654C17.4806 3.65912 17.0717 2.92299 16.3654 2.72119C15.6591 2.5194 14.923 2.92836 14.7212 3.63464L13.8539 6.67H10.6204L11.2788 4.3654ZM9.86037 9.33L8.90609 12.67H12.1396L13.0939 9.33H9.86037Z"/>
      </svg>
      `
  span.classList.add('topic-icon')
  return span
}

/** tweb `messageActionTextNewUnsafe.ts:105-141` (расхождения 2, 3). */
export function wrapTopicIcon(topic: TopicIconSource): HTMLElement {
  if(topic.id === GENERAL_TOPIC_ID) {
    return wrapGeneralTopicIcon()
  }

  if(topic.icon_emoji) {
    const span = document.createElement('span')
    span.classList.add('topic-icon')
    span.append(wrapEmojiText(topic.icon_emoji))
    return span
  }

  return topicAvatar(topic.icon_color, topic.title)
}
