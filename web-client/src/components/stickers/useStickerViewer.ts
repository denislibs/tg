// useStickerViewer — предпросмотр стикера по зажатию ЛКМ, порт механики tweb
// `components/stickerViewer.ts` (attachStickerViewerListeners). Референс —
// строки файла:
//   40-42  — на тач-устройствах хук вообще не подключается (см. ниже);
//   57-58  — триггер: `mousedown`, только левая кнопка (`e.button !== 0`);
//   31     — модульный флаг `hasViewer`: на всей странице одновременно открыт
//            только один предпросмотр, даже если хук используется в
//            нескольких местах разом (лента + панель стикеров);
//   243-290— показ ОТЛОЖЕН на `HOLD_THRESHOLD_MS` (`timeout`): пока порог не
//            истёк, оверлей не создаётся вовсе — это и есть критерий
//            «клик vs удержание», а не отдельный отсчёт времени. `hasViewer`
//            выставляется В МОМЕНТ открытия (внутри таймера), а не на
//            mousedown — до открытия конкурирующий mousedown в другом месте
//            странице не блокируется (как и в tweb).
//   289-336— `mousemove` на `document` переключает стикер под курсором, пока
//            кнопка держится, — но только ПОСЛЕ открытия (слушатель вешается
//            внутри таймера, не на mousedown).
//   358-385— `mouseup`(один раз, capture) закрывает предпросмотр (если он был
//            открыт) и снимает все слушатели;
//   364,379— критерий глушения следующего `click` — `if(container)`, то есть
//            «оверлей реально был показан», а НЕ отдельный расчёт длительности
//            удержания. Без этого (первая версия этого хука до ревью V2)
//            обычный клик — та же самая пара mousedown→mouseup, которой
//            браузер и рождает сам click, — глушился бы ВСЕГДА, а не только
//            настоящее удержание;
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
//   — нет фазы "premove" (`onMousePreMove`, stickerViewer.ts:349-352) — в tweb
//     курсор, ушедший с исходной ячейки ДО истечения порога, обрывает жест
//     целиком (эквивалент раннего mouseup, без показа и без глушения клика).
//     У нас до открытия движение мыши просто игнорируется (слушатель включается
//     только внутри таймера открытия) — жест не обрывается, а просто ждёт
//     истечения порога независимо от того, где сейчас курсор; практическая
//     разница мала (сам показ и переключение всё равно недоступны до открытия);
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

// tweb stickerViewer.ts:243 — тот же порог (125мс), которым там отложен САМ
// показ оверлея. Единственный смысл константы: сколько ждать перед тем, как
// считать нажатие удержанием, а не кликом. (До ревью V2 порог по ошибке решал
// ДВЕ разные вещи одновременно — отдельно от показа ещё и глушение клика по
// сырому `Date.now()`-таймеру, из-за чего оверлей мелькал на каждом обычном
// клике — StickerMedia 360×360 монтировался и тут же размонтировался. Теперь,
// как в оригинале, порог отвечает только за показ, а глушение решается по
// факту «оверлей открыт», см. `shown` ниже.)
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

    // Мышь зажата после успешного mousedown (найдена ячейка) — держится, пока
    // не пришёл mouseup, независимо от того, успел ли открыться оверлей.
    let holding = false
    // Оверлей РЕАЛЬНО показан (таймер открытия сработал раньше mouseup) — это
    // и есть критерий tweb `if(container)`: только тогда клик после отпускания
    // нужно глушить и только тогда лок анимаций/подписку на mousemove нужно снимать.
    let shown = false
    let openTimer: ReturnType<typeof setTimeout> | null = null
    // Стикер, найденный на mousedown, — то, что покажет таймер открытия, если
    // мышь не отпустят раньше порога.
    let pendingSticker: Sticker | null = null
    // tweb :83 — `previousGroup = animationIntersector.getOnlyOnePlayableGroup()`,
    // снятое ДО лока значение группы, которую нужно вернуть на закрытии (а не
    // жёсткий `''`) — предпросмотр мог открыться поверх уже запертого экрана.
    let previousGroup: ReturnType<typeof animationIntersector.getOnlyOnePlayableGroup> = ''
    // Одноразовый click-swallow (см. onMouseUp) — ссылка нужна, чтобы cleanup
    // мог снять его, если хост размонтировался ДО того, как браузер успел
    // прислать сам глушимый click (см. Minor 1 code review Task 1).
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

    // tweb :199-200,372-373 — показ оверлея сам по себе, вызывается ТОЛЬКО из
    // таймера открытия (см. onMouseDown) — то есть только когда порог реально
    // истёк, пока кнопка ещё зажата.
    const openNow = () => {
      openTimer = null
      shown = true
      hasViewer = true
      previousGroup = animationIntersector.getOnlyOnePlayableGroup()
      animationIntersector.setOnlyOnePlayableGroup('STICKER-VIEWER')
      animationIntersector.checkAnimations2(true)
      setSticker(pendingSticker)
      document.addEventListener('mousemove', onMouseMove)
    }

    // Закрытие УЖЕ показанного оверлея — разморозка анимаций (см. `openNow`) и
    // снятие подписки на переключение. Вызывается и из штатного mouseup, и из
    // cleanup-ветки «размонтировались во время показа».
    const closeShown = () => {
      document.removeEventListener('mousemove', onMouseMove)
      animationIntersector.setOnlyOnePlayableGroup(previousGroup)
      animationIntersector.checkAnimations2(false)
      setSticker(null)
      hasViewer = false
      shown = false
    }

    const onMouseUp = () => {
      if (!holding) return
      holding = false

      if (openTimer) {
        // Порог ещё не истёк — оверлей ни разу не показывался: это обычный
        // быстрый клик. Отменяем отложенное открытие и НЕ трогаем ни лок
        // анимаций (он ещё не ставился), ни следующий click (глушить нечего).
        clearTimeout(openTimer)
        openTimer = null
        return
      }

      if (shown) {
        closeShown()
        // tweb :379 — глушим следующий `click`: это тот же клик, которым
        // браузер естественно завершает пару mousedown→mouseup на одном
        // элементе. Без этого удержание стикера ещё и отправляло бы его при
        // отпускании. Достигаем этой ветки, только если оверлей РЕАЛЬНО был
        // показан (`shown`) — обычный клик сюда не попадает вовсе (см. выше).
        pendingClickSwallow = (e) => {
          pendingClickSwallow = null
          cancelEvent(e)
        }
        document.addEventListener('click', pendingClickSwallow, { capture: true, once: true })
      }
    }

    const onMouseDown = (e: MouseEvent) => {
      // tweb :58 — `hasViewer || e.buttons > 1 || e.button !== 0`: только левая
      // кнопка, и только если по странице уже ОТКРЫТ другой предпросмотр (не
      // просто ожидает открытия — см. докблок про `hasViewer`).
      if (hasViewer || e.button !== 0) return
      const found = findStickerRef.current(e.target as HTMLElement)
      if (!found) return

      holding = true
      pendingSticker = found
      document.addEventListener('mouseup', onMouseUp, { capture: true, once: true })
      // tweb :243 — показ отложен на HOLD_THRESHOLD_MS; если mouseup придёт
      // раньше (обычный клик), таймер будет отменён в onMouseUp и оверлей
      // так и не будет создан.
      openTimer = setTimeout(openNow, HOLD_THRESHOLD_MS)
    }

    root.addEventListener('mousedown', onMouseDown)
    return () => {
      root.removeEventListener('mousedown', onMouseDown)
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp, { capture: true })
      if (openTimer) {
        clearTimeout(openTimer)
        openTimer = null
      }
      if (pendingClickSwallow) {
        document.removeEventListener('click', pendingClickSwallow, { capture: true })
        pendingClickSwallow = null
      }
      // Хост размонтировался, пока оверлей был реально показан (например, ушёл
      // с экрана вместе со своей вкладкой) — снимаем модульный флаг, лок
      // анимаций И состояние `sticker` (иначе оверлей остался бы смонтирован
      // поверх уже отвязанных слушателей — правка по ревью V2, Minor 3).
      if (shown) {
        closeShown()
      }
      holding = false
    }
  }, [rootRef])

  // Реальный React-элемент (не прямой вызов компонента) — хук лишь ВОЗВРАЩАЕТ
  // разметку, монтирует/размонтирует её React по обычному дереву хоста
  // (`{overlay}` в JSX хоста), со своим фибером и собственными хуками внутри
  // StickerViewer — прямой вызов StickerViewer(...) как функции подвесил бы
  // её хуки на фибер ХОСТА и ломался бы при условном null/элемент между рендерами.
  return sticker ? createElement(StickerViewer, { sticker }) : null
}
