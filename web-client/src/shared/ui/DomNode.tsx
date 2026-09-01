import { useLayoutEffect, useRef, type ElementType } from 'react'

/**
 * Дети узла — СПИСКОМ и один раз на узел. Снимок берётся до первой вставки:
 * после неё фрагмент пуст, и повторный `Array.from` дал бы пустой список — тот
 * же дефект, только тише. Ключ — сам узел, поэтому снимок переживает
 * перемонтирование хоста; см. докблок `DomNode`.
 */
const takenChildren = new WeakMap<Node, Node[]>()

function childrenOf(node: Node): Node[] {
  let children = takenChildren.get(node)
  if (!children) {
    children = node.nodeType === Node.DOCUMENT_FRAGMENT_NODE ? Array.from(node.childNodes) : [node]
    takenChildren.set(node, children)
  }
  return children
}

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
 * ── ПОЧЕМУ ХРАНИТСЯ СПИСОК ДЕТЕЙ, А НЕ САМ УЗЕЛ ─────────────────────────────
 * `DocumentFragment` — РАСХОДУЕМЫЙ контейнер: вставка переносит его детей в
 * хост, и фрагмент остаётся ПУСТЫМ. Прямой `replaceChildren(node)` поэтому
 * срабатывает ровно один раз, а любой повторный прогон эффекта вставляет
 * пустоту и стирает уже показанную подпись.
 *
 * Повторный прогон — не экзотика. `React.StrictMode` (`main.tsx:33`) в dev
 * вызывает эффекты ДВАЖДЫ, и это стирало дату на шести экранах, где подпись
 * собирает `formatFullSentTime` (он возвращает фрагмент): `ChannelStats`,
 * `ScheduledView`, `SuggestedPostsView`, `GiftInfoPopup`, `InviteLinkScreens`,
 * `StoryViewer`. Прод-сборка молчала — там `StrictMode` no-op, — поэтому ни
 * `vite build`, ни стенд дефекта не показывали. Fast Refresh даёт то же самое.
 *
 * Чинится это не обещанием «эффект зовут один раз», а ПО ПОСТРОЕНИЮ: дети
 * снимаются в СПИСОК при первой же вставке (пока фрагмент ещё полон), и
 * `replaceChildren(...children)` тем же списком идемпотентен — узлы живые, те
 * же самые, их записи в `I18n.weakMap` целы, а повторная вставка лишь
 * переносит их обратно в хост. Узел-элемент (`i18n()`, `IntlDateElement`)
 * расходуемым не был никогда — он идёт тем же путём списком из одного
 * элемента, поэтому ветка в рантайме одна на оба случая.
 *
 * Снимок лежит в МОДУЛЬНОЙ `WeakMap`, ключом — сам узел, а не в `ref`
 * компонента. Разница не косметическая: `ref` живёт с ИНСТАНСОМ, и повторное
 * монтирование того же узла (ремонт хоста, Fast Refresh, второй `render` в
 * тесте) заводит инстанс с пустым `ref` — снимать уже нечего, фрагмент
 * опустошён первым монтированием. Ключ-узел переживает и это. Приём не наш:
 * оригинал в том же положении раскладывает фрагмент в момент вставки
 * (`documentFragmentToNodes(formatFullSentTime(...))`, tweb
 * `stories/viewer.tsx:1985`) — ровно потому, что фрагмент одноразовый.
 * `WeakMap` не течёт: запись живёт, пока жив сам узел.
 */
export default function DomNode({ node, className, tag: Tag = 'span', title }: {
  /** Готовый узел ИЛИ фрагмент — строит вызывающий, обычно через `useMemo`. */
  node: Node
  className?: string
  /** Тег хоста — тот, что несёт узел в разметке оригинала. */
  tag?: Extract<ElementType, 'span' | 'div'>
  title?: string
}) {
  const ref = useRef<HTMLElement>(null)

  useLayoutEffect(() => {
    ref.current!.replaceChildren(...childrenOf(node))
  }, [node])

  return <Tag ref={ref as React.Ref<HTMLSpanElement & HTMLDivElement>} className={className} title={title} />
}
