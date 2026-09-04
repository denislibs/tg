/** @jsxImportSource solid-js */
// wrapEmailPattern — маска почты восстановления (`d****@e******.com`) ровно как в
// tweb: порт `components/popups/emailSetup.tsx:wrapEmailPattern`.
//
// Solid-версия нашего React `auth/emailPattern.tsx` (перенесена СМЫСЛОМ, вместе
// с её пинами — `emailPattern.test.tsx`). `wrapEmailPattern` сама по себе не
// завязана ни на один UI-рантайм (строит DOM-узлы напрямую, как и остальной
// `lib/richtext/*`) — она ДУБЛИРОВАНА здесь, а не импортирована из React-файла:
// тот целиком уходит под React-плагин Vite (`.tsx`, не `.solid.tsx`) и несёт
// импортирует `useEffect`/`useMemo`/`useRef` из React-рантайма в СОСЕДНЕМ экспорте
// (`EmailPattern` по умолчанию) — граница рантаймов (`shared/solid/boundary.
// test.ts`) держит это на уровне ИМПОРТОВ файла, а не «какой конкретно экспорт
// использован». Тот же приём уже есть у `cards/SignInCard.solid.tsx` (см. её
// докблок про `applyPattern`) — маленький чистый кусок дублируется, а не тянет
// весь React-файл целиком.
//
// Никакой собственной разметки здесь нет: каждый ПРОГОН звёздочек описывается
// сущностью-спойлером, а `wrapRichText(..., {noTextFormat: true})` строит по ней
// `span.bluff-spoiler > span.bluff-spoiler-letter…`, подменяет символы брайлем
// (`lib/richtext/spoiler.ts`) и подключает элемент к симуляции частиц
// (`DotRenderer.attachBluffTextSpoilerTarget`). Стили — глобальные
// (`styles/tweb/_spoiler.scss`), маска — за `lib/spoiler/bluffSpoilerController`.
import { onMount, type JSX } from 'solid-js'
import wrapRichText from '@lib/richtext/wrapRichText'
import type { MessageEntity } from '@layer'

/**
 * `d****@e******.com` → фрагмент с блеф-спойлерами. Как в tweb: строка без «*»
 * (или с пробелом) отдаётся как есть.
 */
export function wrapEmailPattern(pattern: string): string | DocumentFragment {
  if (pattern.includes(' ') || !pattern.includes('*')) return pattern

  const entities: MessageEntity[] = []
  for (let i = 0; i < pattern.length; ) {
    const idx = pattern.indexOf('*', i)
    if (idx === -1) break
    let endIdx = idx + 1
    while (pattern[endIdx] === '*') endIdx++

    entities.push({
      _: 'messageEntitySpoiler',
      offset: idx,
      length: endIdx - idx,
    })

    i = endIdx
  }

  return wrapRichText(pattern, { entities, noTextFormat: true })
}

/**
 * Тонкая Solid-обёртка: `wrapEmailPattern` отдаёт ГОТОВЫЕ DOM-узлы (иначе к ним
 * не подключить симуляцию), поэтому компонент только вносит их в свой `<b>` на
 * маунте — `onMount`, а не JSX-детьми, ровно по той же причине, что и у
 * React-версии (`useEffect`, не `{nodes}`).
 */
export default function EmailPattern(props: { pattern: string }): JSX.Element {
  let el: HTMLElement | undefined

  onMount(() => {
    if (!el) return
    const wrapped = wrapEmailPattern(props.pattern)
    const nodes = typeof wrapped === 'string' ? [document.createTextNode(wrapped)] : [...wrapped.childNodes]
    el.append(...nodes)
  })

  return <b ref={el} />
}
