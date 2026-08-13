// Порт tweb `components/verticalVirtualList.tsx:114-189` (тип `UseShouldAnimateArgs`
// и функция `useShouldAnimate`, читать целиком). Если ВСЕ элементы, видимые в окне
// хоста и ДО, и ПОСЛЕ смены списка, сдвинулись на одинаковое число позиций — не
// анимируем их (`shouldAnimate = false`), а вместо анимации компенсируем скролл
// (`onScrollShift`, порт побочного эффекта `:49-53`). Иначе, например, при
// появлении нового чата над видимой областью, ВСЕ видимые строки дёргались бы
// анимацией `top` одновременно — вместо этого список визуально стоит на месте,
// двигаются только реально переехавшие строки.
//
// Видимость здесь — СВОЯ, БЕЗ overscan/thresholdPadding (тот, что использует сам
// список для окна рендера, — другая формула и другое место, `verticalVirtualList.tsx:65-74`):
//   (idx + 1) * itemHeight >= scrollAmount && idx * itemHeight <= scrollAmount + hostHeight   (:138-140)
//
// Сравнение элементов между старым и новым списком — ПО ССЫЛКЕ (`prev.indexOf(item)`,
// `:153-154`), не по id: у нас это работает, потому что зеркало (`stores/chatsStore`)
// сохраняет ссылки на элементы, значения которых не изменились (`reconcileById`), —
// в частности пересборка порядка (`reindex`) создаёт НОВЫЙ массив, но с ПРЕЖНИМИ
// ссылками на диалоги (см. тест «reindex», сценарий 6 в `useShouldAnimate.test.ts`).
import { useEffect, useRef } from 'react'

export type UseShouldAnimateArgs<T> = {
  list: readonly T[]
  scrollAmount: number
  hostHeight: number
  itemHeight: number
  onScrollShift: (amount: number) => void
}

/** `:132-141` — видимость для целей ЭТОГО хука, без overscan. */
function isActuallyVisible(idx: number, scrollAmount: number, hostHeight: number, itemHeight: number): boolean {
  return (idx + 1) * itemHeight >= scrollAmount && idx * itemHeight <= scrollAmount + hostHeight
}

/**
 * `:129-189`. Возвращает `false`, когда менять список не нужно анимировать
 * (все видимые элементы сдвинулись на одну и ту же величину — сдвиг вместо
 * этого компенсирован через `onScrollShift`), иначе `true`.
 */
export function useShouldAnimate<T>({
  list,
  scrollAmount,
  hostHeight,
  itemHeight,
  onScrollShift,
}: UseShouldAnimateArgs<T>): boolean {
  // Прежний список (`prev` из `on(list, (current, prev = []) => ...)`, `:143`).
  // Пересчёт ниже гейтится сравнением ССЫЛКИ на `list` — аналог того, что
  // `on(list, ...)` в оригинале реагирует ТОЛЬКО на смену ссылки `list`
  // (solid-сигнал по идентичности), а не на любое другое чтение внутри
  // (в частности — не на смену `scrollAmount`/`hostHeight`/`itemHeight` саму по
  // себе). Мутация рефов ниже во время рендера гейтится этим же сравнением —
  // тот самый паттерн «запомнить предыдущее значение пропа», который React
  // явно допускает для рендер-тела (идемпотентен при повторном вызове с теми
  // же пропами, в т.ч. под StrictMode-двойным рендером).
  const prevListRef = useRef<readonly T[]>([])
  // Последнее вычисленное значение сигнала `shouldAnimate` (`:130`, дефолт
  // solid-сигнала — `true`) — персистится между рендерами, на которых список
  // не менялся, ровно как реактивный сигнал, который просто не пересчитывался.
  const shouldAnimateRef = useRef(true)
  // Сдвиг, который должен уйти в `onScrollShift` СЛЕДУЮЩИМ эффектом — сам
  // побочный эффект не может идти из тела рендера. `null`, если в этот проход
  // список не менялся (гейт выше не сработал) или сдвиг был неравномерным.
  const pendingShiftRef = useRef<number | null>(null)

  const prev = prevListRef.current

  if (list !== prev) {
    const visiblePrev = prev.filter((_, i) => isActuallyVisible(i, scrollAmount, hostHeight, itemHeight))
    const visibleNow = list.filter((_, i) => isActuallyVisible(i, scrollAmount, hostHeight, itemHeight))

    // `:147` — Set гасит дубликаты между «было» и «стало»: элемент, оставшийся
    // видимым в обоих состояниях, не должен участвовать в проверке дважды.
    const visiblePrevAndNow = Array.from(new Set<T>([...visibleNow, ...visiblePrev]))

    let allChangedTheSameAmount = true
    let prevDiff = 0
    let diffAssigned = false

    for (const item of visiblePrevAndNow) {
      const prevIdx = prev.indexOf(item)
      const currentIdx = list.indexOf(item)

      // `:156-159` — элемент отсутствует в одном из списков (появился в видимой
      // области или пропал из неё/из списка вовсе) — единого сдвига нет, анимируем.
      if (prevIdx === -1 || currentIdx === -1) {
        allChangedTheSameAmount = false
        break
      }

      const diff = prevIdx - currentIdx

      if (!diffAssigned) {
        prevDiff = diff
        diffAssigned = true
        continue
      }

      // `:168-171` — разные элементы сдвинулись на разное число позиций.
      if (prevDiff !== diff) {
        allChangedTheSameAmount = false
        break
      }
    }

    // `:174-177` — пустое пересечение видимых «было» и «стало»: единого сдвига
    // нет по построению, анимируем.
    if (!visiblePrevAndNow.length) {
      allChangedTheSameAmount = false
      prevDiff = 0
    }

    shouldAnimateRef.current = !allChangedTheSameAmount
    // `:181-183` — сдвиг копится для эффекта, а не применяется сразу же здесь.
    pendingShiftRef.current = allChangedTheSameAmount ? prevDiff * itemHeight : null
    prevListRef.current = list
  }

  useEffect(() => {
    const shift = pendingShiftRef.current
    if (shift === null) return
    pendingShiftRef.current = null
    onScrollShift(shift)
  })

  return shouldAnimateRef.current
}

/**
 * Порт побочного эффекта `verticalVirtualList.tsx:49-53` — конкретная реализация
 * `onScrollShift` для реального DOM-хоста: компенсирующая запись `scrollTop`,
 * буквальный `-=` (не через `Scrollable`/`ScrollSaver` — список чатов не ходит
 * через них, см. `core/scrollWriters.test.ts`).
 *
 * Живёт рядом с `useShouldAnimate`, а не в `VerticalVirtualList` (где будет
 * подключена — Task 5), потому что это парный МЕХАНИЗМ: `useShouldAnimate`
 * решает, КОГДА компенсировать сдвиг, эта функция — КАК именно (порт `untrack`
 * оригинала не нужен: React, в отличие от solid, не отслеживает чтение
 * `host.scrollTop` как реактивную зависимость).
 */
export function createScrollShiftCompensator(host: HTMLElement): (amount: number) => void {
  return (amount: number) => {
    host.scrollTop -= amount
  }
}
