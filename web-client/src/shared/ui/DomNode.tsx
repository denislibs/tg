import { useLayoutEffect, useRef, type ElementType } from 'react'

/**
 * ХОСТ ДЛЯ ЧУЖОГО DOM-УЗЛА В REACT-ДЕРЕВЕ.
 *
 * Ядро локализации отдаёт не строку, а ЖИВОЙ узел: `i18n(key)` и
 * `I18n.IntlDateElement` кладут созданный `span.i18n` в `I18n.weakMap`, и
 * дальше ядро само переписывает его текст — на смену языка (`applyLangPack`
 * обходит все `.i18n`, `lib/langPack.ts:568-572`) и на смену настройки 12/24
 * часа (`I18n.setTimeFormat`, `:490`). JSX такой узел выразить не может:
 * `{node}` React отрендерить не умеет, а `String(node)` даёт
 * `[object HTMLSpanElement]`.
 *
 * Поэтому узел вставляется императивно, а React владеет только хостом. Приём не
 * новый — он уже стоял по месту в `conversation/TopbarSearch.tsx::EmptyResults`
 * и `auth/CountryInput.tsx`; здесь он один на всех, чтобы у каждого экрана не
 * заводилась своя копия пары `useMemo` + `useLayoutEffect`.
 *
 * ── Узел строит ВЫЗЫВАЮЩИЙ, и обязательно мемоизированно ────────────────────
 * `node` меняется — узел пересоздаётся; `node` тот же — React о нём больше не
 * вспоминает. Это не оптимизация, а условие работы: живой узел обновляет СЕБЯ
 * САМ, и пересоздавать его на смену языка не только незачем, но и вредно —
 * пересозданный узел теряет всё, что ядро успело на него навесить. Поэтому
 * вызывающий обязан обернуть постройку в `useMemo` с зависимостями от ДАННЫХ
 * (таймстамп, ключ), а не от языка.
 *
 * ── Почему хост — обычный элемент, а не фрагмент ────────────────────────────
 * Вставить узел без обёртки некуда: React должен знать, куда его класть, а
 * ссылку он даёт только на настоящий элемент. Разметка от этого не растёт —
 * хост И ЕСТЬ тот элемент, который в tweb несёт узел (`span.message-time`,
 * `div.topbar-search-left-results-empty`), поэтому `className` передаётся ему.
 */
export default function DomNode({ node, className, tag: Tag = 'span', title }: {
  /** Готовый узел (или фрагмент) — строит вызывающий, обычно через `useMemo`. */
  node: Node
  className?: string
  /** Тег хоста — тот, что несёт узел в разметке оригинала. */
  tag?: Extract<ElementType, 'span' | 'div'>
  title?: string
}) {
  const ref = useRef<HTMLElement>(null)

  useLayoutEffect(() => {
    ref.current!.replaceChildren(node)
  }, [node])

  return <Tag ref={ref as React.Ref<HTMLSpanElement & HTMLDivElement>} className={className} title={title} />
}
