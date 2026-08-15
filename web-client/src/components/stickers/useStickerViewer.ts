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
//            на `document` — иначе удержание стикера ещё и отправляло бы его;
//            НО только если это был настоящий hold, а не обычный быстрый клик
//            (см. `HOLD_THRESHOLD_MS` ниже — критично: без порога свойство
//            «глушить после ЛЮБОГО mousedown→mouseup» глушило бы обычную
//            отправку/открытие модалки стикера кликом ВООБЩЕ ВСЕГДА, потому что
//            каждый клик физически и есть пара mousedown→mouseup, за которой
//            браузер сам шлёт click);
//   198-201,372-373 — пока предпросмотр открыт, играет ТОЛЬКО его группа
//            анимаций (`animationIntersector.setOnlyOnePlayableGroup`,
//            `checkAnimations2(true)`) — фон (лента/панель) замирает; на
//            закрытии/размонтировании во время удержания возвращается прежняя
//            группа, а не жёстко `''` — если предпросмотр открылся ПОВЕРХ уже
//            запертого экрана (например, модалки набора стикеров), нельзя
//            размораживать чужой фон вместо возврата ему его собственного лока.
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
import animationIntersector from '../animationIntersector'
import type { Sticker } from '../../core/managers/stickersManager'
import StickerViewer from './StickerViewer'

// tweb stickerViewer.ts:31 — `let hasViewer = false`, модульная (не per-hook)
// переменная: гарантирует единственный открытый предпросмотр на всю страницу,
// даже если этот хук подключён к нескольким гридам одновременно.
let hasViewer = false

// tweb stickerViewer.ts:243 — тот же порог (125мс), которым там задержан САМ
// показ оверлея (`timeout`/`onMousePreMove`): пока он не истёк, `container` не
// создаётся вовсе, и в `onMouseUp` `if(container)` не вешает click-swallow —
// обычный быстрый клик просто закрывает несостоявшийся предпросмотр и доходит
// как click до хоста (отправка/открытие модалки). У нас (см. докблок выше)
// показ оверлея НЕ отложен — упрощение принято сознательно. Но БЕЗ какого-то
// порога свойство «после mouseup глушить следующий click» становится
// безусловным: обычный клик — это те же самые mousedown→mouseup, так что
// глушился бы КАЖДЫЙ клик по стикеру, а не только настоящее удержание — то
// есть отправка/открытие набора отказывали бы всегда. Порог применяется не к
// показу (тот остаётся мгновенным), а только к решению «глушить ли клик»:
// мышь была прижата дольше порога — воспринимаем как намеренный hold.
const HOLD_THRESHOLD_MS = 125

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
    // tweb :83 — `previousGroup = animationIntersector.getOnlyOnePlayableGroup()`,
    // снятое ДО лока значение группы, которую нужно вернуть на закрытии (а не
    // жёсткий `''`) — предпросмотр мог открыться поверх уже запертого экрана.
    let previousGroup: ReturnType<typeof animationIntersector.getOnlyOnePlayableGroup> = ''
    // Момент mousedown — см. `HOLD_THRESHOLD_MS`: решает, было ли отпускание
    // настоящим удержанием (глушить click) или обычным быстрым кликом (не глушить).
    let downAt = 0
    // Одноразовый click-swallow (см. onMouseUp) — ссылка нужна, чтобы cleanup
    // мог снять его, если хост размонтировался ДО того, как браузер успел
    // прислать сам глушимый click (см. Minor 1 code review).
    let pendingClickSwallow: ((e: MouseEvent) => void) | null = null

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

    const unlockAnimations = () => {
      // tweb :372-373 — `setOnlyOnePlayableGroup(previousGroup)` +
      // `checkAnimations2(false)`: разморозка фона и возврат ИМЕННО прежней
      // группы, а не `''`.
      animationIntersector.setOnlyOnePlayableGroup(previousGroup)
      animationIntersector.checkAnimations2(false)
    }

    const onMouseUp = () => {
      if (!holding) return
      holding = false
      hasViewer = false
      document.removeEventListener('mousemove', onMouseMove)
      unlockAnimations()
      setSticker(null)

      // tweb :379 — глушим следующий `click`: это тот же клик, которым браузер
      // естественно завершает пару mousedown→mouseup на одном элементе. Без
      // этого удержание стикера ещё и отправляло бы его при отпускании. НО
      // только если удержание было настоящим (см. `HOLD_THRESHOLD_MS`) —
      // иначе глушился бы и обычный быстрый клик, которым стикер как раз и
      // отправляют/открывают.
      if (Date.now() - downAt >= HOLD_THRESHOLD_MS) {
        pendingClickSwallow = (e) => {
          pendingClickSwallow = null
          cancelEvent(e)
        }
        document.addEventListener('click', pendingClickSwallow, { capture: true, once: true })
      }
    }

    const onMouseDown = (e: MouseEvent) => {
      // tweb :58 — `hasViewer || e.buttons > 1 || e.button !== 0`: только левая
      // кнопка, и только если по странице ещё не открыт другой предпросмотр.
      if (hasViewer || e.button !== 0) return
      const found = findStickerRef.current(e.target as HTMLElement)
      if (!found) return

      hasViewer = true
      holding = true
      downAt = Date.now()
      setSticker(found)

      // tweb :199-200 — на время предпросмотра играет только его группа,
      // остальные анимации (лента/панель под затемнением) замирают.
      previousGroup = animationIntersector.getOnlyOnePlayableGroup()
      animationIntersector.setOnlyOnePlayableGroup('STICKER-VIEWER')
      animationIntersector.checkAnimations2(true)

      document.addEventListener('mousemove', onMouseMove)
      document.addEventListener('mouseup', onMouseUp, { capture: true, once: true })
    }

    root.addEventListener('mousedown', onMouseDown)
    return () => {
      root.removeEventListener('mousedown', onMouseDown)
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp, { capture: true })
      if (pendingClickSwallow) {
        document.removeEventListener('click', pendingClickSwallow, { capture: true })
        pendingClickSwallow = null
      }
      // Хост размонтировался, пока стикер удерживался (например, ушёл с экрана
      // вместе со своей вкладкой) — снимаем модульный флаг и возвращаем лок
      // анимаций, иначе следующий mousedown где угодно на странице считался бы
      // «уже есть предпросмотр», а фон навсегда остался бы замороженным.
      if (holding) {
        holding = false
        hasViewer = false
        unlockAnimations()
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
