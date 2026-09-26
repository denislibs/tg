/**
 * Порт tweb `src/components/popups/pickUser.tsx:325-424` (`createFolderTabs`) —
 * ряд папок попапа пересылки. У оригинала его ставит `showPickUserPopup` при
 * `showTopPeers` сразу за «недавними» (`:497-509`), а `showTopPeers: true`
 * передаёт `showForwardPopup` (`popups/forward.tsx:360-376`). Сам ряд — тот же
 * Solid-`FoldersTabs`, что в колонке (`components/foldersTabs.solid.tsx`), с
 * пропами попапа (`:391-419`); клик по вкладке — `selectTarget` полосы
 * (`components/horizontalMenu.ts`), затем прокрутка списка к началу и скоуп
 * селектора (`selector.setFolderId`, `appSelectPeers.ts:1358-1366`). План —
 * задача 9 `docs/superpowers/plans/2026-09-07-solid-wave-3-folders-tabs.md`.
 *
 * ОБЪЯВЛЕННЫЕ РАСХОЖДЕНИЯ С ОРИГИНАЛОМ
 *
 *  1. Узел `mount` создаёт и держит React (`ForwardPicker`,
 *     `components/messages/ChatDialogs.tsx`), а не эта функция
 *     (`:326-330`, `afterElement.after(mount)`): соседей рендерит React, и
 *     вставка чужого узла в его дерево разъехалась бы на первом же рендере.
 *     По той же причине `is-collapsed` на запросе (`selector.onSearchChange`,
 *     `:421-423`) ставит React — он владеет `className` узла; здесь узлу
 *     пишется только `style.top`.
 *  2. Узлы селектора (`selector.selectorSearch.section.container`,
 *     `selector.scrollable.container`, `selector.section.container`) ищутся от
 *     `mount` по классам: наш селектор — React-`PeerSelector`, инстанса с этими
 *     полями у него нет, а классы у узлов те же (`shared/ui/PeerSelector/PeerSelector.tsx`).
 *  3. Лимита папок нет (`:370-377`: `REAL_FOLDERS`/`isFilterIdAvailable` →
 *     `showLimitPopup('folders')`) — отложенная задача 10 плана; как и у
 *     владельца колонки, доступна любая папка.
 *  4. `deferred` (`:337`, `:398-399`) не заводится: у оригинала им ждёт
 *     `selector.loadFirst()` (`:560-562`), чтобы первая страница пришла уже со
 *     скоупом папки. Наш список синхронный — фильтр по пропу `dialogs` на
 *     каждом рендере, ждать нечего. Вместо `lateMiddleware.onClean`
 *     (`:334-335`, `:420`) — возвращаемая уборка: её зовёт остров
 *     (`useImperativeIsland`) на размонтировании попапа.
 *  5. `useFolders().hydrate()` перед рядом: у оригинала стор гидрирует
 *     старт приложения, у нас — первый потребитель проекции (идемпотентно,
 *     `stores/folders.solid.ts`); попап не должен зависеть от того, что колонка
 *     уже поднялась.
 *  6. Клик по ряду ловит нативный слушатель на `menu`, а не проп
 *     `menuProps.onClick` (`:406-412`). Solid ДЕЛЕГИРУЕТ `onClick` на `document`
 *     (`Tabs.Menu` в `components/tabs.solid.tsx`), а React-`Popup` гасит
 *     всплытие на `.popup-container` (`shared/ui/Popup/Popup.tsx:144`,
 *     `e.stopPropagation()`) — до `document` клик не доходит, и делегированный
 *     обработчик не срабатывает НИКОГДА (проверено пином «клик по папке»
 *     `messages/ForwardPicker.test.tsx`). У оригинала попап — Solid-`PopupElement`,
 *     такой преграды нет. Тело обработчика — дословное. Узел `menu` уходит вместе
 *     с деревом на `dispose`, слушатель — с ним.
 */
import FoldersTabs from '@components/foldersTabs.solid'
import { selectTarget } from '@components/horizontalMenu'
import { observeResize } from '@components/resizeObserver'
import type { ScrollableContextValue } from '@components/scrollable2.solid'
import cancelEvent from '@helpers/dom/cancelEvent'
import findUpAttribute from '@helpers/dom/findUpAttribute'
import whichChild from '@helpers/dom/whichChild'
import fastSmoothScroll from '@helpers/fastSmoothScroll'
import { mountSolid } from '@shared/solid/mountSolid.solid'
import useFolders from '@stores/folders.solid'

export default function createFolderTabs({ mount, setFolderId }: {
  /** `div.popup-forward-folder-tabs-container.collapsable` — расхождение 1 */
  mount: HTMLElement
  /** `selector.setFolderId` — скоуп списка; 0 — «Все чаты» */
  setFolderId: (filterId: number) => void
}): () => void {
  let menu: HTMLElement
  let prevId = -1
  let scrollableContext: ScrollableContextValue | undefined

  // Расхождение 2.
  const scrollableContainer = mount.closest<HTMLElement>('.selector-scrollable')!
  const sectionContainer = scrollableContainer.querySelector<HTMLElement>('.selector-search-section-container')!
  const unobserve = observeResize(sectionContainer, () => {
    mount.style.top = sectionContainer.offsetHeight + 'px'
  })

  const scrollToStart = (callback: () => void) => {
    let clicked = false
    const onFinish = () => {
      if (!clicked) {
        clicked = true
        callback()
      }
    }

    void fastSmoothScroll({
      container: scrollableContainer,
      element: scrollableContainer.querySelector<HTMLElement>('.selector-list-section-container')!,
      position: 'start',
      getElementPosition: ({ elementPosition }) => elementPosition -
        mount.offsetHeight -
        sectionContainer.offsetHeight,
      startCallback: ({ duration, path }) => {
        if (path >= 0) onFinish()
        else setTimeout(onFinish, Math.max(0, duration / 2))
      },
    }).finally(callback)
  }

  const onTabClick = (target: HTMLElement, id: number) => {
    return selectTarget({
      target,
      id,
      tabs: menu,
      onClick: async () => {
        const filterId = +(target.dataset.filterId || 0)
        // Расхождение 3: проверки доступности папки нет.

        if (prevId !== -1) {
          await new Promise<void>((resolve) => scrollToStart(resolve))
        }

        setFolderId(filterId)
        prevId = id
      },
      prevId,
      scrollableX: scrollableContext,
    })
  }

  const onMenuClick = (e: MouseEvent) => {
    cancelEvent(e)
    const target = findUpAttribute(e.target!, 'data-filter-id')
    if (!target) return
    const id = whichChild(target)
    void onTabClick(target, id)
  }

  // Расхождение 5.
  useFolders().hydrate()

  const { dispose } = mountSolid(mount, FoldersTabs, {
    scrollableProps: {
      class: 'popup-forward-folder-tabs',
      scrollableProps: {
        contextRef: (ref: ScrollableContextValue) => scrollableContext = ref,
      },
    },
    menuProps: {
      ref: (ref: HTMLDivElement) => {
        menu = ref
        queueMicrotask(async () => {
          const first = ref.firstElementChild as HTMLElement | null
          if (first) await onTabClick(first, 0)
        })
        // Расхождение 6: нативный слушатель вместо `menuProps.onClick`.
        ref.addEventListener('click', onMenuClick)
      },
    },
    gradientProps: {
      color: 'background',
      className: 'popup-forward-folder-tabs-gradient',
    },
  })

  return () => {
    unobserve()
    dispose()
  }
}
