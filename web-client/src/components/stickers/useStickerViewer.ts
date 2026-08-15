// useStickerViewer — предпросмотр стикера по зажатию ЛКМ, порт механики tweb
// `components/stickerViewer.ts` (attachStickerViewerListeners). Референс —
// строки файла:
//   40-42  — на тач-устройствах хук вообще не подключается (см. ниже);
//   57-58  — триггер: `mousedown`, только левая кнопка (`e.button !== 0`);
//   31     — модульный флаг `hasViewer`: на всей странице одновременно открыт
//            только один предпросмотр, даже если хук используется в
//            нескольких местах разом (лента + панель стикеров);
//   289-336— `mousemove` на `document` переключает стикер под курсором, пока
//            кнопка держится;
//   358-385— `mouseup`(один раз, capture) закрывает предпросмотр и снимает все
//            слушатели;
//   379    — после отпускания следующий `click` (тот же жест mousedown→mouseup
//            рождает его сам браузер) глушится одноразовым capture-слушателем
//            на `document` — иначе удержание стикера ещё и отправляло бы его.
//
// Хост не обязан знать разметку ячеек: он передаёт `findSticker(el)`, которая
// сама поднимается по DOM (`closest`) до своей ячейки и возвращает стикер —
// хук делегирует `mousedown` на `rootRef`, а не заводит слушатель на каждую
// ячейку по отдельности (как tweb делает через `listenTo`/`selector`).
//
// Упрощения против tweb (см. также StickerViewer.tsx):
//   — нет 125мс-задержки перед показом (stickerViewer.ts:245-290, `timeout`)
//     — предпросмотр открывается сразу по mousedown, без промежуточной фазы
//     "premove" (`onMousePreMove`, которая в tweb ещё и не даёт открыться,
//     если курсор уполз с ячейки до истечения задержки);
//   — нет опроса `isInDOM` (tweb :389-393, `unmountInterval`) — ячейка,
//     исчезнувшая из DOM во время удержания (например, скролл виртуального
//     списка снял её), в React-модели снимается размонтированием хоста, а не
//     таймером; хук всё равно не потеряет корректность — `mouseup` на
//     `document` ловит отпускание где угодно.
import { createElement, useEffect, useRef, useState } from 'react'
import type { ReactElement, RefObject } from 'react'
import IS_TOUCH_SUPPORTED from '@environment/touchSupport'
import cancelEvent from '@helpers/dom/cancelEvent'
import type { Sticker } from '../../core/managers/stickersManager'
import StickerViewer from './StickerViewer'

// tweb stickerViewer.ts:31 — `let hasViewer = false`, модульная (не per-hook)
// переменная: гарантирует единственный открытый предпросмотр на всю страницу,
// даже если этот хук подключён к нескольким гридам одновременно.
let hasViewer = false

export interface UseStickerViewerOptions {
  /** Делегирующий контейнер — `mousedown` слушается на нём, не на ячейках. */
  rootRef: RefObject<HTMLElement | null>
  /**
   * Сопоставление DOM-узла (обычно `e.target`) со стикером: хост сам решает,
   * как поднимается от произвольного потомка до своей ячейки (`closest`) и
   * как из неё достаётся `Sticker`. `undefined` — узел не относится ни к
   * одной ячейке (или сама ячейка не несёт стикера).
   */
  findSticker: (el: HTMLElement) => Sticker | undefined
}

export function useStickerViewer({ rootRef, findSticker }: UseStickerViewerOptions): ReactElement | null {
  const [sticker, setSticker] = useState<Sticker | null>(null)

  // findSticker/rootRef хоста может пересоздаваться на каждый рендер (инлайновая
  // стрелка) — эффект ниже должен вешать слушатели ровно один раз на смонтированный
  // root, а не пересобирать их при каждом чужом ре-рендере.
  const findStickerRef = useRef(findSticker)
  findStickerRef.current = findSticker

  useEffect(() => {
    // tweb stickerViewer.ts:40-42 — на тач-устройствах хук не подключается
    // вовсе: удержание пальцем открывает системное контекстное меню/скролл, а
    // не предпросмотр — это жест только для мыши.
    if (IS_TOUCH_SUPPORTED) return

    const root = rootRef.current
    if (!root) return

    let holding = false

    const onMouseMove = (e: MouseEvent) => {
      const target = e.target as Node | null
      // tweb :293 — `findTarget(e, true)` проверяет принадлежность listenTo
      // (`findUpAsChild`): переключение работает только внутри ТОГО ЖЕ грида,
      // где начался жест, а не по любому совпавшему узлу на странице.
      if (!target || !root.contains(target)) return
      const next = findStickerRef.current(target as HTMLElement)
      if (!next) return
      setSticker((prev) => (prev && prev.id === next.id ? prev : next))
    }

    const onMouseUp = () => {
      if (!holding) return
      holding = false
      hasViewer = false
      document.removeEventListener('mousemove', onMouseMove)
      setSticker(null)

      // tweb :379 — глушим следующий `click`: это тот же клик, которым браузер
      // естественно завершает пару mousedown→mouseup на одном элементе. Без
      // этого удержание стикера ещё и отправляло бы его при отпускании.
      document.addEventListener('click', cancelEvent as EventListener, { capture: true, once: true })
    }

    const onMouseDown = (e: MouseEvent) => {
      // tweb :58 — `hasViewer || e.buttons > 1 || e.button !== 0`: только левая
      // кнопка, и только если по странице ещё не открыт другой предпросмотр.
      if (hasViewer || e.button !== 0) return
      const found = findStickerRef.current(e.target as HTMLElement)
      if (!found) return

      hasViewer = true
      holding = true
      setSticker(found)

      document.addEventListener('mousemove', onMouseMove)
      document.addEventListener('mouseup', onMouseUp, { capture: true, once: true })
    }

    root.addEventListener('mousedown', onMouseDown)
    return () => {
      root.removeEventListener('mousedown', onMouseDown)
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp, { capture: true } as EventListenerOptions)
      // Хост размонтировался, пока стикер удерживался (например, ушёл с экрана
      // вместе со своей вкладкой) — снимаем модульный флаг, иначе следующий
      // mousedown где угодно на странице считался бы «уже есть предпросмотр».
      if (holding) {
        holding = false
        hasViewer = false
      }
    }
  }, [rootRef])

  // Реальный React-элемент (не прямой вызов компонента) — хук лишь ВОЗВРАЩАЕТ
  // разметку, монтирует/размонтирует её React по обычному дереву хоста
  // (`{overlay}` в JSX хоста), со своим фибером и собственными хуками внутри
  // StickerViewer — прямой вызов StickerViewer(...) как функции подвесил бы
  // её хуки на фибер ХОСТА и ломался бы при условном null/элемент между рендерами.
  return sticker ? createElement(StickerViewer, { sticker }) : null
}
