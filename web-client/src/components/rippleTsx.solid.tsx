/** @jsxImportSource solid-js */
/**
 * Порт tweb `src/components/rippleTsx.tsx` (812502980): волна нажатия на
 * ПЕРВОМ узле детей. Первый потребитель — кликабельная карточка превью ссылки
 * (`wrappers/webPage.solid.tsx`, tweb `webPage.tsx:156-158`). Отличие одно:
 * наш `ripple()` на узле, где волна уже стоит, возвращает `undefined`
 * (`components/ripple.ts:49`) — тогда снимать нечего.
 */
import { resolveFirst } from '@solid-primitives/refs'
import { createEffect, onCleanup, type JSX } from 'solid-js'
import ripple from '@components/ripple'

export interface RippleProps {
  children: JSX.Element
}

export const Ripple = (props: RippleProps) => {
  const element = resolveFirst(() => props.children)
  createEffect(() => {
    const ret = ripple(element() as HTMLElement)
    if(!ret) return
    const { dispose, element: rippleElement } = ret
    onCleanup(() => {
      dispose()
      rippleElement.remove()
    })
  })

  return props.children
}
