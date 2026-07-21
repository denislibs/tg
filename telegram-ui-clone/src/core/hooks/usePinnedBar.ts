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
import { useEffect, useState } from 'react'
import { usePinsStore } from '../../stores/pinsStore'
import { clampPinIndex, nextPinIndex } from '../pinnedCycle'
import { useEvent } from './useEvent'
import type { Message } from '../models'

interface PinManagers {
  messages: { listPins(chatId: number): Promise<Message[]> }
}

export interface PinnedBarState {
  /** пины чата, новейший первым */
  pins: Message[]
  /** индекс пина, который показывает плашка (к нему прыгнет следующий клик) */
  index: number
  /** клик по плашке: вернуть текущий пин (для прыжка) и перелистнуть дальше */
  follow: () => Message | undefined
}

const NO_PINS: Message[] = []

export function usePinnedBar(numericChatId: number, isRealChat: boolean, managers: PinManagers): PinnedBarState {
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

  const index = clampPinIndex(rawIndex, pins.length)
  const follow = useEvent(() => {
    const cur = pins[index]
    setRawIndex(nextPinIndex(index, pins.length))
    return cur
  })

  return { pins, index, follow }
}
