/**
 * Порт tweb `src/components/quizHint.ts` (812502980, 106 строк) — всплывающая
 * подсказка `div.quiz-hint.from-{top|bottom} > div.quiz-hint-container` поверх
 * своего контейнера (`appendTo`): въезжает классом `active`, по `duration`
 * уезжает и через 200 мс снимается; новая подсказка гасит предыдущую. Стили —
 * `styles/tweb/_quizHint.scss`. Первый потребитель — вкладка «Код-пароль»
 * («Код-пароль установлен/изменён/отключён», `passcodeLock/mainTab.tsx:34-42`);
 * у tweb её же зовут опросы.
 *
 * Расхождения с оригиналом:
 *  1. Нет закрытия по смене чата (`canCloseOnPeerChange`, слушатель
 *     `appImManager` `peer_changed`, `:94-103`): единственный вызывающий у нас
 *     передаёт `canCloseOnPeerChange: false`, а подсказки опросов (которым оно
 *     нужно) не портированы — опция вернётся вместе с ними.
 *  2. Строгие типы: предыдущая подсказка — `| null`, таймаут — `number | undefined`.
 */
import Icon from '@components/icon'
import setInnerHTML from '@helpers/dom/setInnerHTML'
import type { IconName } from '@core/tgico-icons'

const hideQuizHint = (element: HTMLElement, onHide: (() => void) | undefined, timeout: number | undefined) => {
  element.classList.remove('active')

  clearTimeout(timeout)
  setTimeout(() => {
    onHide?.()
    element.remove()

    if(prevQuizHint === element && prevQuizHintOnHide === onHide && prevQuizHintTimeout === timeout) {
      prevQuizHint = prevQuizHintOnHide = null
      prevQuizHintTimeout = 0
    }
  }, 200)
}

let prevQuizHint: HTMLElement | null = null
let prevQuizHintOnHide: (() => void) | undefined | null = null
let prevQuizHintTimeout: number | undefined = 0
export const setQuizHint = (options: {
  textElement: HTMLElement | DocumentFragment
  textRight?: HTMLElement | DocumentFragment
  title?: HTMLElement
  onHide?: () => void
  appendTo: HTMLElement
  from: 'top' | 'bottom'
  duration?: number
  icon?: IconName
  class?: string
}) => {
  if(prevQuizHint) {
    hideQuizHint(prevQuizHint, prevQuizHintOnHide ?? undefined, prevQuizHintTimeout)
  }

  const element = document.createElement('div')
  element.classList.add('quiz-hint', 'from-' + options.from)
  if(options.class) element.classList.add(options.class)

  const container = document.createElement('div')
  container.classList.add('quiz-hint-container')

  let titleEl: HTMLElement | undefined
  if(options.title) {
    titleEl = document.createElement('div')
    titleEl.classList.add('quiz-hint-title')
    titleEl.append(options.title)
    container.classList.add('has-title')
  }

  const textEl = document.createElement('div')
  textEl.classList.add('quiz-hint-text')

  let textRightEl: HTMLElement | undefined
  if(options.textRight) {
    textRightEl = document.createElement('div')
    textRightEl.classList.add('quiz-hint-text-right')
    textRightEl.append(options.textRight)
    container.classList.add('has-right-text')
  }

  container.append(...[
    options.icon && Icon(options.icon, 'quiz-hint-icon'),
    titleEl,
    textEl,
    textRightEl,
  ].filter((el): el is HTMLElement => !!el))
  element.append(container)

  setInnerHTML(textEl, options.textElement)
  options.appendTo.append(element)

  void element.offsetLeft // reflow
  element.classList.add('active')

  const hide = () => {
    hideQuizHint(element, options.onHide, timeout)
  }

  prevQuizHint = element
  prevQuizHintOnHide = options.onHide
  const timeout = prevQuizHintTimeout = options.duration ? window.setTimeout(hide, options.duration) : undefined

  return { hide }
}
