// src/core/hooks/usePinnedBar.ts
// View-model hook for a chat's pinned messages. Reads the pins from pinsStore (the
// single source of truth) and triggers the initial load on open. Live updates are
// applied by realtimeBridge (the only socket subscriber) on rt:pin_message — this
// hook never listens to the socket, per the "only realtimeBridge subscribes" rule.
// The initial listPins() here is a fetch (read path), not a socket subscription.
//
// Держит и индекс перелистывания плашки (tweb pinnedMessage): бар показывает
// пин pins[index], follow() отдаёт его для прыжка и переводит индекс на
// следующий (более старый, циклически). Сброс — при смене чата и любом
// изменении списка пинов (pin/unpin перезаписывает массив в pinsStore).
import { useEffect, useState, type RefObject } from 'react'
import { usePinsStore } from '../../stores/pinsStore'
import { clampPinIndex, nextPinIndex, pinIndexForVisibleMid } from '../pinnedCycle'
import { useEvent } from './useEvent'
import { useManagers } from './useManagers'
import type { Message } from '../models'

/** throttle скролл-трекинга — tweb `throttle(setCorrectIndex, 100, false)` */
const SCROLL_THROTTLE_MS = 100

export interface PinnedBarState {
  /** пины чата, новейший первым */
  pins: Message[]
  /** индекс пина, который показывает плашка (к нему прыгнет следующий клик) */
  index: number
  /** клик по плашке: вернуть текущий пин (для прыжка) и перелистнуть дальше */
  follow: () => Message | undefined
}

const NO_PINS: Message[] = []

export function usePinnedBar(
  numericChatId: number,
  isRealChat: boolean,
  /** скролл-контейнер ленты — по нему бар выбирает актуальный пин (tweb setCorrectIndex) */
  scrollRef?: RefObject<HTMLElement | null>,
): PinnedBarState {
  const managers = useManagers()
  const pins = usePinsStore((s) => s.byChat[numericChatId]) ?? NO_PINS
  const [rawIndex, setRawIndex] = useState(0)

  useEffect(() => {
    const setPins = usePinsStore.getState().setPins
    if (!isRealChat) { setPins(numericChatId, NO_PINS); return }
    let alive = true
    void managers.messages.listPins(numericChatId).then((p) => { if (alive) setPins(numericChatId, p) })
    return () => { alive = false }
  }, [isRealChat, numericChatId, managers])

  // Сброс перелистывания на новейший пин при смене чата или изменении списка
  // (realtimeBridge на rt:pin_message перезаписывает массив — новая ссылка).
  useEffect(() => { setRawIndex(0) }, [numericChatId, pins])

  // tweb pinnedMessage.setCorrectIndex: показанный пин выбирается по САМОМУ
  // НИЖНЕМУ видимому баблу — плашка всегда показывает пин, действующий для той
  // части истории, что сейчас на экране. Throttle 100ms, как в оригинале.
  useEffect(() => {
    const el = scrollRef?.current
    if (!el || pins.length === 0) return
    let last = 0
    let timer: ReturnType<typeof setTimeout> | undefined
    const apply = () => {
      last = Date.now()
      const bottom = el.getBoundingClientRect().bottom
      // getBubbleByPoint('bottom') — последний бабл, чей верх ещё выше нижней кромки.
      const bubbles = el.querySelectorAll<HTMLElement>('.bubble[data-mid]')
      let mid: number | undefined
      for (const b of bubbles) {
        if (b.getBoundingClientRect().top >= bottom) break
        const v = Number(b.dataset.mid)
        if (Number.isFinite(v)) mid = v
      }
      if (mid === undefined) return
      setRawIndex(pinIndexForVisibleMid(pins, mid))
    }
    const onScroll = () => {
      const wait = SCROLL_THROTTLE_MS - (Date.now() - last)
      if (wait <= 0) { apply(); return }
      if (timer === undefined) timer = setTimeout(() => { timer = undefined; apply() }, wait)
    }
    apply()
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => { el.removeEventListener('scroll', onScroll); clearTimeout(timer) }
  }, [scrollRef, pins])

  const index = clampPinIndex(rawIndex, pins.length)
  const follow = useEvent(() => {
    const cur = pins[index]
    setRawIndex(nextPinIndex(index, pins.length))
    return cur
  })

  return { pins, index, follow }
}
