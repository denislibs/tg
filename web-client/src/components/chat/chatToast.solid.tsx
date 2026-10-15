/** @jsxImportSource solid-js */
/**
 * Порт tweb `src/components/chat/chatToast.tsx` (812502980, 78 строк) — плашка,
 * прикреплённая под топбаром чата (и плавающими закрепами). Монтируется в `.chat`
 * (соседа `.topbar` / `.bubbles`), а НЕ в `.bubbles`: тот — трансформируемый контекст
 * наложения `z-index:1`, который запер бы плашку под топбаром и вводом. Прикрепление
 * делает класс `chat-toast` (`styles/tweb/_chatToast.scss`). Показана одна плашка:
 * новая прячет предыдущую.
 *
 * Отличия от оригинала — только типовые: `icon` — наш `IconName` (`@core/tgico-icons`),
 * `showTooltip` — `@components/tooltip.solid`.
 */
import type { JSX } from 'solid-js'
import classNames from '@helpers/string/classNames'
import appImManager from '@lib/appImManager'
import showTooltip from '@components/tooltip.solid'
import type { IconName } from '@core/tgico-icons'

type CurrentToast = {
  hide: () => void,
  closeOnPeerChange: boolean
}

let current: CurrentToast | undefined
let isListenerSet = false

export default function showChatToast(options: {
  textElement: HTMLElement | DocumentFragment,
  title?: HTMLElement,
  rightElement?: JSX.Element,
  icon?: IconName,
  class?: string,
  duration?: number,
  // 'slide' выезжает из-за топбара, 'fade' поднимается на место, проявляясь
  animation?: 'slide' | 'fade',
  closeOnPeerChange?: boolean,
  onHide?: () => void
}) {
  current?.hide()

  if(!isListenerSet) {
    isListenerSet = true
    appImManager.addEventListener('peer_changed', () => {
      if(current?.closeOnPeerChange) {
        current.hide()
      }
    })
  }

  options.title?.classList.add('text-bold')

  const { close } = showTooltip({
    element: appImManager.chat.container,
    container: appImManager.chat.container,
    mountOn: appImManager.chat.container,
    relative: true,
    vertical: 'top',
    class: classNames('chat-toast', `chat-toast--${options.animation ?? 'slide'}`, options.class),
    icon: options.icon,
    textElement: options.title ?? options.textElement,
    subtitleElement: options.title && options.textElement,
    rightElement: options.rightElement,
    onClose: () => {
      if(current === entry) {
        current = undefined
      }

      options.onHide?.()
    },
  })

  const entry: CurrentToast = current = {
    hide: close,
    closeOnPeerChange: options.closeOnPeerChange ?? true,
  }

  if(options.duration) {
    setTimeout(close, options.duration)
  }

  return { hide: close }
}
