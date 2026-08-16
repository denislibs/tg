// Липкая дата в ленте — вся проводка поверх StickyIntersector, вынутая из
// Chat.tsx. Отдельным хуком по двум причинам: Chat нигде не рендерится в
// vitest (поэтому логика внутри его useEffect не ловилась никаким тестом), и
// сам файл — самый большой компонент клиента, куда нельзя добавлять
// непокрытую площадь (web-client/CLAUDE.md, «Тесты»).
//
// tweb bubbles.ts:1382-1408 (колбэк StickyIntersector) + 4867
// (observeStickyHeaderChanges на каждой `.bubbles-date-group`) — какая дата
// прилипла, считает портированный StickyIntersector по sentinel-узлам, а не
// обход `.bubble.is-date` с getBoundingClientRect на каждое событие скролла.
// ChatFeed рендерит секции `.bubbles-date-group` прямыми детьми contentRef;
// выбор «нижней» застрявшей секции и обвязка «наблюдать новую секцию ровно
// один раз» — в chatStickyDates.ts.
//
// Возвращается КЛЮЧ ДНЯ, а не класс: `.bubble.is-date.is-sticky` рендерит React
// в ChatFeed, иначе класс стёр бы ближайший ре-рендер ленты. Ровно тот случай,
// когда узлом владеет React и остров тут не при чём (docs/tweb/bubbles.md).
import { useEffect, useRef, useState, type RefObject } from 'react'
import StickyIntersector from '@components/stickyIntersector'
import { observeNewSections, pickStickyDateKey, pruneEvictedSections } from '@components/chatStickyDates'
import { useImperativeIsland } from './useImperativeIsland'

export function useChatStickyDates({
  scrollRef,
  contentRef,
  feedRevision,
  feedLoading,
  padTopPx,
  padBottomPx,
}: {
  /** скроллер ленты — root для IntersectionObserver */
  scrollRef: RefObject<HTMLDivElement | null>
  /** `.bubbles-inner`: прямые дети — секции дня */
  contentRef: RefObject<HTMLDivElement | null>
  /** что-нибудь, меняющееся при смене состава ленты (окно сообщений) */
  feedRevision: unknown
  feedLoading: unknown
  padTopPx: number
  padBottomPx: number
}): string | null {
  const [stickyDateKey, setStickyDateKey] = useState<string | null>(null)
  const intersectorRef = useRef<StickyIntersector | null>(null)
  const observedRef = useRef<Set<HTMLElement>>(new Set())
  const stuckRef = useRef<Set<HTMLElement>>(new Set())

  // Инстанс живёт на весь срок жизни узлов (как this.stickyIntersector в tweb —
  // заводится один раз в setListeners): пересоздание на каждый ререндер плодило
  // бы новые сентинелы поверх старых в каждой уже наблюдаемой секции
  // (observeStickyHeaderChanges не идемпотентна, см. chatStickyDates.test.ts).
  //
  // Остров, а не голый эффект: сентинелы досыпает StickyIntersector, а его
  // disconnect() чистит только свою Map element→sentinel. В tweb контейнер
  // одноразовый, поэтому убирать за собой не требовалось; у нас `.bubbles-inner`
  // постоянный, и без `strays` узлы копились бы при каждом ремаунте.
  useImperativeIsland((inner) => {
    const sc = scrollRef.current
    if (!sc) return
    const stuck = stuckRef.current
    const intersector = new StickyIntersector(sc, (isStuck, target) => {
      if (isStuck) stuck.add(target)
      else stuck.delete(target)
      setStickyDateKey((prev) => {
        const key = pickStickyDateKey(inner.children, stuck)
        return prev === key ? prev : key
      })
    })
    intersectorRef.current = intersector

    return () => {
      intersector.disconnect()
      intersectorRef.current = null
      stuck.clear()
      observedRef.current.clear()
    }
  }, [scrollRef, contentRef], { host: contentRef, strays: '.sticky_sentinel' })

  // Новые дата-секции (загрузка страницы истории, новое сообщение сменило день)
  // — наблюдаем только те, что ещё не видели; уже наблюдаемые трогать нельзя
  // (см. выше). Перед этим — секции, которых больше нет в DOM (jumpTo/reloadNewest
  // подменяют окно целиком): снять с обоих observer'ов и вычистить из реестров,
  // иначе они удерживаются бессрочно.
  useEffect(() => {
    const inner = contentRef.current
    const intersector = intersectorRef.current
    if (!inner || !intersector) return
    pruneEvictedSections(inner, intersector, observedRef.current, stuckRef.current)
    observeNewSections(inner, intersector, observedRef.current)
  }, [contentRef, feedRevision, feedLoading])

  // tweb bubbles.ts:4900-4905 (updateStickyIntersectorRootMargin) — тот же
  // паддинг топбара/инпута, что резервируют распорки `.bubbles-padding-top/bottom`;
  // меняется независимо от ленты, поэтому отдельный эффект и `setRootMargin`
  // (переподписывает существующие сентинелы, а не плодит новые).
  useEffect(() => {
    intersectorRef.current?.setRootMargin(`-${padTopPx}px 0px -${padBottomPx}px 0px`)
  }, [padTopPx, padBottomPx])

  return stickyDateKey
}

export default useChatStickyDates
