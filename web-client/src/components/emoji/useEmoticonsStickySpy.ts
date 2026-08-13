// Scroll-spy ленты категорий эмодзи-дропдауна — порт tweb
// `EmoticonsDropdown.menuOnClick` (emoticonsDropdown/index.ts:570-594):
// активную категорию ведёт StickyIntersector, он же добавляет в каждую
// категорию сентинел `div.sticky_sentinel.sticky_sentinel--top`
// (tab.ts:259 observeStickyHeaderChanges → stickyIntersector.ts addSentinel),
// а не ручной перебор offsetTop по scroll-событию.
//
// Гарды из tweb перенесены оба:
//   • `scrollingToContent` (index.ts:569, 632-643) — пока играет программный
//     скролл к категории, spy молчит;
//   • `jumpedTo` (index.ts:577-581) — прибытие в точку клика не перетирает
//     выбор, сделанный самим кликом.
import { useEffect, useRef, type RefObject } from 'react'
import StickyIntersector from '../stickyIntersector'

export default function useEmoticonsStickySpy({
  scrollRef,
  catEls,
  count,
  onActive,
}: {
  scrollRef: RefObject<HTMLDivElement | null>
  /** key → элемент `.emoji-category` (те же, что в реестре меню) */
  catEls: RefObject<Map<string, HTMLDivElement>>
  /** число категорий — пересоздать наблюдатель, когда состав изменился */
  count: number
  onActive: (key: string) => void
}) {
  const onActiveRef = useRef(onActive)
  onActiveRef.current = onActive
  const jumpedToRef = useRef(-1)
  const scrollingRef = useRef(false)
  const settleTimerRef = useRef(0)

  useEffect(() => {
    const sc = scrollRef.current
    // happy-dom без IntersectionObserver — spy просто не поднимается (как и
    // остальные IO-механики дропдауна)
    if (!sc || typeof IntersectionObserver === 'undefined') return
    const si = new StickyIntersector(sc, (stuck, target) => {
      if (scrollingRef.current) return
      // tweb index.ts:577-581
      if (Math.abs(jumpedToRef.current - sc.scrollTop) <= 1) return
      jumpedToRef.current = -1
      const key = target.dataset.catKey
      if (!key) return
      // tweb index.ts:588-591: `if(!stuck && (which || tab.menuScroll)) return` —
      // «отлипание» активирует только первую категорию списка (which === 0);
      // единственная категория с which === 0 у нас без menuScroll (recent)
      const which = Array.prototype.indexOf.call(target.parentElement!.children, target)
      if (!stuck && which > 0) return
      onActiveRef.current(key)
    })
    const observed = [...catEls.current.values()]
    for (const el of observed) si.observeStickyHeaderChanges(el)

    // Снятие scrollingToContent: у tweb это `.finally()` промиса
    // scrollIntoViewNew (index.ts:637-643); у нативного scrollTo({smooth})
    // промиса нет — считаем скролл доигранным по прибытию в точку markJump
    // (пользовательский срыв smooth-скролла добивает страховочный таймер).
    const onScroll = () => {
      if (scrollingRef.current && Math.abs(sc.scrollTop - jumpedToRef.current) <= 1) {
        scrollingRef.current = false
      }
    }
    sc.addEventListener('scroll', onScroll, { passive: true })

    return () => {
      si.disconnect()
      sc.removeEventListener('scroll', onScroll)
      // сентинелы добавлял observeStickyHeaderChanges — убрать, иначе
      // пересоздание наблюдателя (изменился состав категорий) их дублирует
      for (const el of observed) el.querySelector(':scope > .sticky_sentinel')?.remove()
    }
  }, [scrollRef, catEls, count])

  useEffect(() => () => window.clearTimeout(settleTimerRef.current), [])

  /** объявить программный скролл к позиции top (tweb jumpedTo = offsetTop,
   *  scrollingToContent = true — index.ts:632-635) */
  const markJump = (top: number) => {
    jumpedToRef.current = top
    scrollingRef.current = true
    window.clearTimeout(settleTimerRef.current)
    settleTimerRef.current = window.setTimeout(() => {
      scrollingRef.current = false
    }, 1000)
  }

  return { markJump }
}
