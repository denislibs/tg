// Порт tweb `components/verticalVirtualList.tsx:15-112` (компонент
// `VerticalVirtualList`, читать целиком). Абсолютно спозиционированные строки
// внутри `ul` фиксированной высоты; в DOM живут только те индексы, что попадают
// в окно видимости, посчитанное арифметикой из `scrollTop` хоста.
//
// Формы порта, где React отличается от solid (спека
// `docs/superpowers/specs/2026-08-13-virtual-chatlist-design.md`, «Форма порта»):
//
// 1. Окно видимости — состояние родителя, а не `<Show>` на каждой строке:
//    в solid `<For>` + `<Show when={isVisible(idx())}>` (`:103-109`) — мелкозернистая
//    реактивность, перерисовывается одна строка. Наивный React-порт перерисовывал бы
//    весь список на каждом кадре скролла, поэтому здесь родитель рендерит только
//    строки окна, а `scrollAmount` обновляется не чаще одного измерения за кадр.
// 2. Анимация `top` не идёт через состояние React: `useAnimatedTop` (порт
//    `createAnimatedValue`, `:78`) пишет `top`/`--background` прямо в DOM по ref.
//    Поэтому `renderItem` получает не `top`/`animating` (как `ListItem` оригинала,
//    `:8-13`), а `itemRef` — ref-колбэк, который надо повесить на корневой узел строки.
// 3. `getKey` — ДОБАВЛЕННЫЙ проп, которого нет у оригинала. Solid'овский `<For>`
//    привязывает строку к элементу списка ПО ССЫЛКЕ, поэтому переехавший элемент
//    сохраняет свой узел и анимирует `top` к новому месту. React требует явный
//    `key`, и без него строки пришлось бы ключевать индексом — тогда `top` строки
//    никогда бы не менялся и анимация переезда исчезла бы вовсе.
import { memo, useEffect, useLayoutEffect, useMemo, useState, type Key, type ReactNode, type Ref } from 'react'

import { IS_OVERLAY_SCROLL_SUPPORTED } from '@environment/overlayScrollSupport'
import { useElementSize } from '@shared/lib/useElementSize'

import { useAnimatedTop } from './useAnimatedTop'
import { createScrollShiftCompensator, useShouldAnimate } from './useShouldAnimate'

// Троттлинг пересчёта окна — тот же приём, что у `components/scrollable.ts:94-109`
// (`SCROLL_THROTTLE = 24`, `throttleMeasurement`/`cancelMeasurement`, порт tweb):
// при overlay-скролле измерение откладывается таймером на 24 мс, иначе — на кадр
// rAF. Там эти функции модульно-приватные (как и в оригинале tweb) и не
// экспортируются, поэтому здесь повторён приём, а не заведён свой.
const SCROLL_THROTTLE = 24

function throttleMeasurement(callback: () => void): number {
  if (!IS_OVERLAY_SCROLL_SUPPORTED()) {
    return requestAnimationFrame(callback)
  }
  return window.setTimeout(callback, SCROLL_THROTTLE)
}

function cancelMeasurement(id: number): void {
  if (!IS_OVERLAY_SCROLL_SUPPORTED()) {
    cancelAnimationFrame(id)
  } else {
    window.clearTimeout(id)
  }
}

/**
 * `:65-74` — окно видимости с overscan (`thresholdPadding`). Формула дословная.
 */
function isVisible(
  idx: number,
  scrollAmount: number,
  hostHeight: number,
  itemHeight: number,
  padding: number,
): boolean {
  return (
    idx * itemHeight >= scrollAmount - padding &&
    (idx + 1) * itemHeight <= scrollAmount + hostHeight + padding
  )
}

/** Аналог `VerticalVirtualListItemProps` (`:8-13`); про `top`/`animating` — см. п.2 шапки. */
export type VirtualListItemProps<T> = {
  item: T
  idx: number
  /**
   * Вешать на КОРНЕВОЙ узел строки — и только его, СТАБИЛЬНОЙ ссылкой
   * (`ref={itemRef}`, не `ref={(el) => itemRef(el)}`). Нестабильный ref React
   * отцепляет и прицепляет заново на каждом рендере, а переприкрепление — это
   * повторная синхронизация узла с текущим `top`; анимация переезда строки при
   * этом молча исчезает. Сам `itemRef` стабилен между рендерами строки.
   */
  itemRef: (el: HTMLElement | null) => void
}

export type VerticalVirtualListProps<T> = {
  listRef?: Ref<HTMLUListElement>
  list: readonly T[]
  getKey: (item: T, idx: number) => Key
  /**
   * Обязан быть СТАБИЛЬНОЙ ссылкой (`useCallback`): строка обёрнута в `memo`, и
   * новый `renderItem` на каждом рендере родителя перерисовывает всё окно —
   * ровно то, ради избавления от чего список и виртуализируется.
   */
  renderItem: (p: VirtualListItemProps<T>) => ReactNode

  className?: string
  scrollableHost: HTMLElement | null

  itemHeight: number
  thresholdPadding: number

  animate: boolean

  forceHostHeight?: boolean
  extraPaddingBottom?: number
}

/** Хоста ещё нет (ref привяжется следующим рендером) — компенсировать нечего. */
const NO_SCROLL_SHIFT = (): void => {}

/**
 * Одна строка окна. Отдельный компонент, потому что `useAnimatedTop` — хук: в
 * цикле по видимым индексам его звать нельзя (число и порядок вызовов менялись бы
 * от рендера к рендеру). Аналог `Item` оригинала (`:77-88`).
 */
function VerticalVirtualListItemInner<T>({
  item,
  idx,
  itemHeight,
  canAnimate,
  renderItem,
}: {
  item: T
  idx: number
  itemHeight: number
  canAnimate: boolean
  renderItem: (p: VirtualListItemProps<T>) => ReactNode
}) {
  // `:78` — `createAnimatedValue(() => idx * itemHeight, 120, undefined, canAnimate)`.
  const itemRef = useAnimatedTop(idx * itemHeight, canAnimate)

  return <>{renderItem({ item, idx, itemRef })}</>
}

// В solid перерисовка одной строки на кадре скролла невозможна по построению:
// `<For>` + `<Show>` — мелкозернистая реактивность, при смене `scrollAmount`
// пересчитывается только предикат видимости. React же перерисовывает всё поддерево
// родителя, то есть КАЖДУЮ видимую строку на каждом кадре скролла (замер ревью:
// 16 вызовов `renderItem` на один кадр). `memo` возвращает нам поведение оригинала:
// строка перерисовывается, только когда у неё реально изменился `item`, `idx` или
// `canAnimate`. Цена — требование стабильности `renderItem` (см. тип пропа).
// Каст — стандартный обход того, что `memo` теряет дженерик-параметр.
const VerticalVirtualListItem = memo(VerticalVirtualListItemInner) as typeof VerticalVirtualListItemInner

function VerticalVirtualList<T>({
  listRef,
  list,
  getKey,
  renderItem,
  className,
  scrollableHost,
  itemHeight,
  thresholdPadding,
  animate,
  forceHostHeight,
  extraPaddingBottom,
}: VerticalVirtualListProps<T>) {
  const totalCount = list.length // `:31`

  const [scrollAmount, setScrollAmount] = useState(0) // `:33`
  const { ref: hostSizeRef, height: hostHeight } = useElementSize() // `:34`

  // `useElementSize` у нас — callback-ref (а не аксессор элемента, как solid-хук
  // оригинала), поэтому хост «подсовывается» ему эффектом; `scrollableHost === null`
  // на первом рендере — штатная ветка: размеры остаются нулевыми.
  //
  // Эффект именно layout-фазы: `useElementSize` меряет хост синхронно при
  // подстановке, и React успевает перерисовать список с настоящей высотой ДО
  // первой отрисовки. С обычным `useEffect` первый кадр уходил бы в браузер с
  // `hostHeight === 0` — то есть с 4 строками вместо окна, а при `forceHostHeight`
  // ещё и с `ul` нулевой высоты. Различить фазы в тестах нельзя: `act()` из RTL
  // прогоняет layout- и passive-эффекты одинаково, до любых утверждений.
  useLayoutEffect(() => {
    hostSizeRef(scrollableHost)
    return () => hostSizeRef(null)
  }, [hostSizeRef, scrollableHost])

  // `:36-46` — скролл слушается на самом хосте.
  useEffect(() => {
    if (!scrollableHost) return

    // Оригинал стартует сигнал с 0 и обновляет его только событием (`:33, :39-41`):
    // там список создаётся вместе со своим скроллером, и до первого события скролл
    // действительно 0. У нас хост приезжает пропом и может быть уже прокручен
    // (ref привязался вторым рендером, папка вернулась со своим `scrollTop`),
    // поэтому при подключении слушателя берём фактическое значение — ровно то,
    // которое дало бы первое же событие.
    setScrollAmount(scrollableHost.scrollTop)

    let measureId = 0
    const onScroll = () => {
      if (measureId) return
      measureId = throttleMeasurement(() => {
        measureId = 0
        setScrollAmount(scrollableHost.scrollTop)
      })
    }

    scrollableHost.addEventListener('scroll', onScroll, { passive: true })

    return () => {
      scrollableHost.removeEventListener('scroll', onScroll)
      if (measureId) cancelMeasurement(measureId)
    }
  }, [scrollableHost])

  // `:49-53` — компенсация скролла вместо анимации равномерного сдвига.
  const onScrollShift = useMemo(
    () => (scrollableHost ? createScrollShiftCompensator(scrollableHost) : NO_SCROLL_SHIFT),
    [scrollableHost],
  )

  const shouldAnimate = useShouldAnimate({ list, scrollAmount, hostHeight, itemHeight, onScrollShift }) // `:55-61`
  const canAnimate = shouldAnimate && animate // `:63`

  // Оригинал проходит по ВСЕМУ списку (`<For each={props.list}>` + `<Show>`), и в
  // solid это бесплатно — предикат пересчитывается точечно. У нас проход идёт на
  // каждом кадре скролла целиком, то есть 10k итераций на 10k диалогов, поэтому
  // нижняя граница окна берётся арифметикой из той же формулы
  // (`idx * itemHeight >= scrollAmount - padding` ⟺ `idx >= ceil((scrollAmount - padding) / itemHeight)`),
  // а решение о каждом индексе по-прежнему принимает дословный `isVisible`.
  // Выход из цикла по нему же: верхняя граница монотонна по `idx`, первый
  // не прошедший индекс — последний.
  const firstIdx = Math.max(0, Math.ceil((scrollAmount - thresholdPadding) / itemHeight))

  const children: ReactNode[] = []
  for (let idx = firstIdx; idx < list.length; ++idx) {
    if (!isVisible(idx, scrollAmount, hostHeight, itemHeight, thresholdPadding)) break

    const item = list[idx]
    children.push(
      <VerticalVirtualListItem
        key={getKey(item, idx)}
        item={item}
        idx={idx}
        itemHeight={itemHeight}
        canAnimate={canAnimate}
        renderItem={renderItem}
      />,
    )
  }

  // `:90` — высота под все элементы, включая ещё не отрендеренные.
  const computedItemsHeight = totalCount * itemHeight + Number(!!totalCount) * (extraPaddingBottom || 0)
  // `:92` — пока список ни разу не загружен, `ul` ростом с хост.
  const height = forceHostHeight ? hostHeight : computedItemsHeight

  return (
    <ul
      ref={listRef}
      className={className}
      style={{
        height: height + 'px',
        overflow: forceHostHeight ? 'hidden' : undefined, // `:100`
      }}
    >
      {children}
    </ul>
  )
}

export default VerticalVirtualList
