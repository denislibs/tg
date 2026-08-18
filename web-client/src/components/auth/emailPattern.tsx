// wrapEmailPattern — маска почты восстановления (`d****@e******.com`) ровно как в
// tweb: порт `components/popups/emailSetup.tsx:wrapEmailPattern`.
//
// Никакой собственной разметки здесь нет: каждый ПРОГОН звёздочек описывается
// сущностью-спойлером, а `wrapRichText(..., {noTextFormat: true})` строит по ней
// `span.bluff-spoiler > span.bluff-spoiler-letter…`, подменяет символы брайлем
// (`lib/richtext/spoiler.ts`) и подключает элемент к симуляции частиц
// (`DotRenderer.attachBluffTextSpoilerTarget`). Стили — глобальные
// (`styles/tweb/_spoiler.scss`), маска — за `lib/spoiler/bluffSpoilerController`.
import { useEffect, useMemo, useRef } from 'react'

import wrapRichText from '@lib/richtext/wrapRichText'
import type { WrapEntity } from '@lib/richtext/entities'

/**
 * `d****@e******.com` → фрагмент с блеф-спойлерами. Как в tweb: строка без «*»
 * (или с пробелом) отдаётся как есть.
 */
export function wrapEmailPattern(pattern: string): string | DocumentFragment {
  if (pattern.includes(' ') || !pattern.includes('*')) return pattern

  const entities: WrapEntity[] = []
  for (let i = 0; i < pattern.length; ) {
    const idx = pattern.indexOf('*', i)
    if (idx === -1) break
    let endIdx = idx + 1
    while (pattern[endIdx] === '*') endIdx++

    entities.push({
      type: 'spoiler',
      offset: idx,
      length: endIdx - idx,
    })

    i = endIdx
  }

  return wrapRichText(pattern, { entities, noTextFormat: true })
}

/**
 * Тонкая React-обёртка: `wrapEmailPattern` отдаёт ГОТОВЫЕ DOM-узлы (иначе к ним
 * не подключить симуляцию), поэтому компонент только вносит их в свой `<b>`.
 * Узлы строятся один раз на паттерн — повторный `append` их лишь переносит,
 * второго подключения к симуляции не происходит.
 */
export default function EmailPattern({ pattern }: { pattern: string }) {
  const nodes = useMemo(() => {
    const wrapped = wrapEmailPattern(pattern)
    return typeof wrapped === 'string' ? [document.createTextNode(wrapped)] : [...wrapped.childNodes]
  }, [pattern])

  const ref = useRef<HTMLElement>(null)

  useEffect(() => {
    const element = ref.current
    if (!element) return

    element.append(...nodes)
    return () => element.replaceChildren()
  }, [nodes])

  return <b ref={ref} />
}
