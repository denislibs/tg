// useLazyVisibility — React-форма роли tweb `LazyLoadQueue`
// (components/lazyLoadQueue.ts): ОДИН IntersectionObserver на весь список
// вместо своего наблюдателя (и, главное, вместо немедленной загрузки) у каждой
// ячейки. tweb создаёт по одной очереди на витрину — кладку GIF
// (gifsMasonry.ts), сетку попапа набора (popups/stickers.tsx:196) — и передаёт
// её в каждый wrap*; здесь ту же роль играет пара «набор видимых ключей +
// регистратор ячейки».
//
// Если IntersectionObserver в среде нет (happy-dom тестов; тот же гард стоит в
// animationIntersector.ts:162), зарегистрированная ячейка считается видимой
// сразу — витрина деградирует в неленивую, а не в пустую.
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'

export interface LazyVisibility {
  /** ключи ячеек, попавших во вьюпорт корня (с запасом rootMargin) */
  visible: ReadonlySet<string>
  /** ref-колбэк ячейки: register(key, el) при монтировании, register(key, null) при снятии */
  register: (key: string, el: HTMLElement | null) => void
}

/**
 * @param rootRef скроллер-корень наблюдения (кладка/тело попапа)
 * @param rootMargin запас предзагрузки за пределами корня (tweb — высота ряда)
 */
export function useLazyVisibility(rootRef: RefObject<HTMLElement | null>, rootMargin: string): LazyVisibility {
  const cellsRef = useRef(new Map<string, HTMLElement>())
  const ioRef = useRef<IntersectionObserver | null>(null)
  const [visible, setVisible] = useState<ReadonlySet<string>>(new Set())

  useEffect(() => {
    const root = rootRef.current
    if (!root || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver(
      (entries) => {
        setVisible((prev) => {
          const next = new Set(prev)
          for (const en of entries) {
            const key = (en.target as HTMLElement).dataset.lazyKey
            if (!key) continue
            if (en.isIntersecting) next.add(key)
            else next.delete(key)
          }
          // Ссылка меняется, ТОЛЬКО если состав изменился: иначе каждый отчёт
          // наблюдателя порождал бы перерисовку, та — переприкрепление ref'ов
          // ячеек, а оно — новый отчёт (бесконечный цикл).
          return next.size === prev.size && [...next].every((k) => prev.has(k)) ? prev : next
        })
      },
      { root, rootMargin },
    )
    ioRef.current = io
    for (const el of cellsRef.current.values()) io.observe(el)
    return () => { io.disconnect(); ioRef.current = null }
    // rootMargin — константа витрины; rootRef — стабильный ref-объект.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const register = useCallback((key: string, el: HTMLElement | null) => {
    const prev = cellsRef.current.get(key)
    if (el) {
      el.dataset.lazyKey = key
      cellsRef.current.set(key, el)
      if (typeof IntersectionObserver === 'undefined') {
        setVisible((cur) => (cur.has(key) ? cur : new Set(cur).add(key)))
        return
      }
      ioRef.current?.observe(el)
    } else if (prev) {
      ioRef.current?.unobserve(prev)
      cellsRef.current.delete(key)
    }
  }, [])

  return { visible, register }
}
