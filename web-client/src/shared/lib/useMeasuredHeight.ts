import { useCallback, useRef } from 'react'

/**
 * Callback-ref, который сообщает высоту узла и держит её актуальной через
 * ResizeObserver. Нужен там, где размер элемента — вход для раскладки соседей
 * (в tweb эти величины меряет императивный код: `topbar.setFloating`,
 * `chat.setChatInputSurplus`).
 *
 * `onHeight(0)` вызывается, когда узел размонтирован, — потребитель может
 * трактовать это как «блока нет».
 */
export default function useMeasuredHeight(onHeight: (px: number) => void) {
  const onHeightRef = useRef(onHeight)
  onHeightRef.current = onHeight
  const roRef = useRef<ResizeObserver | null>(null)

  return useCallback((el: HTMLElement | null) => {
    roRef.current?.disconnect()
    roRef.current = null
    if (!el) {
      onHeightRef.current(0)
      return
    }
    const apply = () => onHeightRef.current(Math.round(el.offsetHeight))
    apply()
    const ro = new ResizeObserver(apply)
    ro.observe(el)
    roRef.current = ro
  }, [])
}
