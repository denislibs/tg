/**
 * Порт tweb `src/components/chat/selection.ts` — режим выделения сообщений
 * (`AppSelection` + `ChatSelection`) в объёме, который живёт БЕЗ окружения
 * `Chat`: у императивной ленты пока нет ни композера, ни попапов.
 *
 * ── Что портировано ─────────────────────────────────────────────────────────
 *  • стейт `selectedMids: Map<peerId, Set<mid>>` + `isSelecting` (tweb :54-55);
 *  • drag-выделение мышью (:163-306) целиком, вместе с `processElement`
 *    (:196-252) и `getElementsBetween` (:308-336);
 *  • чекбоксы `toggleElementCheckbox` (:346-378) и `updateElementSelection`
 *    (:489-501);
 *  • `toggleSelection` (:423-473), `cancelSelection` (:475-482), `cleanup`
 *    (:484-489), `toggleMid` (:511-550), `deleteSelectedMids` (:552-578);
 *  • `updateContainer` (:385-403) — со срезанным `getStorageKey`, см. ниже;
 *  • `ChatSelection`: `canSelectBubble` (:999-1006), альбомы (:900-976),
 *    `toggleByElement` (:894-984), чекбокс группового контейнера,
 *    `appendCheckbox` (:824-832), обход отрисованной истории в
 *    `toggleSelection` (:866-885).
 *
 * Адреса выше — по tweb e52b5d931, на котором писан порт. ПОВЕРХ него
 * перенесены два коммита 812502980 (задача 14 shared media, выделение по
 * новому tweb), адреса у них — по 812502980:
 *  • 79b9c44c1 — протяжка по альбому раскрывает его ячейки
 *    (`chat/selectionRange.ts`), `toggleByElement(el, selected)` вместо
 *    удалённого `toggleByMid`, `seen` хранит сами элементы, а не миды,
 *    `getElementsBetween` стал protected-методом (:365-393);
 *  • d064fdb85 — альбом и группа документов — одна единица протяжки
 *    (`isSameSelectionUnit` :338-340, `dragAnchor` :198, :225-227, :236),
 *    первый move с `first === last` не раскрывает альбом (`ChatSelection
 *    .getElementsBetween` :904-917, `isSameSelectionUnit` :900-902).
 * Остальная дельта базы 812502980 сюда НЕ перенесена — у неё свой предмет:
 * ключ протяжки `getKeyFromElement`/`clearSelection`/`dragThreshold`/
 * `toggleElementSelected`/`ignoreMove` (60a83a6f1, выделение чатов в
 * чатлисте), aria-роли чекбокса (472e3e76b), эфемерные группы в
 * `canSelectBubble` (2117883fd), разметка
 * `.bubble-select-checkbox > .checkbox-field-input` (ef41b29db) и
 * `getSelectionElementFromTarget` (3d524908e). Выделяемые служебные
 * (e9428f2a9) перенесены позже — волной 1 дельты.
 *
 * ── Границы порта (у каждой — предмет, а не «у нас так») ────────────────────
 *  • ПАНЕЛЬ ДЕЙСТВИЙ (`onToggleSelection` :1008-1136, `onUpdateContainer`
 *    :1138-1157, `removeSelectionContainer` :1159-1173) — плашка вместо
 *    композера в `chat.input` — бэклог Б-23 (П-5): композер до К-4 — React-остров.
 *    Класс `is-selecting` на самой ленте (`listenElement`) — здесь.
 *  • ПОПАПЫ delete/forward/sendNow (:1085-1118) и report-режим
 *    (`enterReportSelection` :832-845, `showSelectedMessagesReport`) — вместе с
 *    плашкой (Б-23, Б-28).
 *  • ВХОД НА ТАЧЕ через long-press (:117-157) требует
 *    `helpers/dom/attachContextMenuListener`, которого в репо ещё нет. Ветка
 *    `IS_TOUCH_SUPPORTED` в `attachListeners` СОХРАНЕНА (иначе на таче
 *    заработала бы мышиная протяжка, которой у оригинала там нет) — в ней
 *    портирован только сбор `selectedText` по `touchend` (:118-121).
 *  • `getSelectedMessages` (:409-421) — в базе не заводится: у ленты
 *    выбранные сообщения собирает само меню (`chat/contextMenu.ts`,
 *    `getSelectedMessages` поверх окна зеркала), а у базы нет хранилища
 *    сообщений, из которого их брать (`getStorageKey` не портирован, ниже).
 *    Своя версия есть у `SearchSelection` — поверх кэша shared media.
 *  • `onCancelSelection` (:1177-1189) — в `ChatSelection` его тело это ровно
 *    сброс `reportSelectionData` (остальное закомментировано у самого tweb);
 *    без report-режима у хука нет ни одного реализатора.
 *
 * ── Адаптации (рантайм тот же) ──────────────────────────────────────────────
 *  • `PeerId`/`.toPeerId()` у нас нет — peerId это `number`;
 *  • `appNavigationController.pushItem({type: 'multiselect-…'})` (:456-465) —
 *    теперь ДОСЛОВНО (#108), вместе с фабрикацией уникального типа на
 *    экземпляр (`:99`). Раньше на месте одной записи стояли два механизма
 *    (`navigationStack.pushLayer` + `hotkeys.pushEsc`);
 *  • `getStorageKey` (:405-407, `${peerId}_${scheduled|history}`) не
 *    портирован: у нас ключ окна зеркала имеет другую форму
 *    (`core/history/messagesMirror.ts`, `winKey`) и не адресует scheduled.
 *    В порт менеджера уходят `peerId` + `isScheduled` раздельно;
 *  • `safeAssign(this, options)` (:98) заменён на явное присваивание —
 *    иначе под `strict` + `useDefineForClassFields` каждое поле опций
 *    требует `!`, а тип опций перестаёт проверяться;
 *  • `getAppWindow()` (окно Document PiP) → `window`/`document`, как уже
 *    сделано в `helpers/dom/clickEvent.ts`.
 */
import CheckboxField from '@components/checkboxField'
import { setTransition } from '@core/dom/setTransition'
import appNavigationController, { type NavigationItem, type NavigationItemType } from '@core/navigation/appNavigationController'
import { randomLong } from '@helpers/random'
import IS_TOUCH_SUPPORTED from '@environment/touchSupport'
import { IS_MOBILE_SAFARI } from '@environment/userAgent'
import blurActiveElement from '@helpers/dom/blurActiveElement'
import cancelEvent from '@helpers/dom/cancelEvent'
import cancelSelection from '@helpers/dom/cancelSelection'
import { attachClickEvent } from '@helpers/dom/clickEvent'
import findUpAsChild from '@helpers/dom/findUpAsChild'
import findUpClassName from '@helpers/dom/findUpClassName'
import {
  expandAlbumSelectionRange,
  isSameGroupedSelectionUnit,
  setAlbumItemsSelection,
} from './selectionRange'
import getSelectedText from '@helpers/dom/getSelectedText'
import isInDOM from '@helpers/dom/isInDOM'
import replaceContent from '@helpers/dom/replaceContent'
import EventListenerBase from '@helpers/eventListenerBase'
import ListenerSetter from '@helpers/listenerSetter'
import ButtonIcon from '@components/buttonIcon'
import { i18n } from '@lib/langPack'
import type { MyMessage } from '@core/models'
import type AppSearchSuper from '@components/appSearchSuper'
import { getSharedMediaMessage } from '@components/sharedMediaHistories'
import type Chat from './chat'
import type ChatInput from './reactChatInput'

/** tweb selection.ts:51-53 (812502980) — обобщён в 79b9c44c1 */
const accumulateMapSet = <T extends { size: number }>(map: Map<number, T>): number => {
  return [...map.values()].reduce((acc, v) => acc + v.size, 0)
}

/** Длительность перехода `is-selected`/`is-selecting` — tweb :372, :1016, :1022 */
const SELECTION_TRANSITION_DURATION = 200

/**
 * Узкий порт ЛЕНТЫ — ровно те члены tweb `ChatBubbles`, которые зовёт
 * `ChatSelection`. Реализует его `ChatBubbles` (`components/chat/bubbles.ts`);
 * заводит связку ведущий агент, здесь — только требование.
 */
export interface SelectionBubbles {
  /** tweb `ChatBubbles.getRenderedHistory` (bubbles.ts:2895) — уже есть у нас */
  getRenderedHistory(sort: 'asc' | 'desc'): string[]
  /** tweb `ChatBubbles.getBubble` (bubbles.ts:6167) — уже есть у нас */
  getBubble(fullMid: string): HTMLElement | undefined
  /** tweb `ChatBubbles.getBubbleGroupedItems` (bubbles.ts:3921) */
  getBubbleGroupedItems(bubble: HTMLElement): HTMLElement[]
  /** tweb `ChatBubbles.skippedMids` (bubbles.ts:531) — мид, отрисованный
   *  ВНУТРИ чужого бабла (альбом, группа документов) и потому не имеющий
   *  своего узла. Опционален: у нашей ленты своего набора пока нет, и без
   *  него обход истории просто не отсеивает ничего. */
  skippedMids?: Set<string>
}

/**
 * Узкий порт МЕНЕДЖЕРА — tweb `appMessagesManager.cantForwardDeleteMids`
 * (зовётся из `updateContainer`, :396).
 *
 * ОПЦИОНАЛЕН, и это честная граница, а не удобство. Права «нельзя переслать»
 * (`pFlags.noforwards`) и «нельзя удалить» (свои права в чате) у нашего
 * приложения не живут НИГДЕ: `noforwards` не читает ни один потребитель, а
 * владельца прав на удаление чужого сообщения нет. Пока факта нет, плашка
 * ничего не узнаёт — и НЕ дизейблит кнопки; оригинал их дизейблит (:396-402).
 * Придёт факт — порт станет обязательным, `updateContainer` уже написан под
 * него. Задача #73.
 */
export interface SelectionManagers {
  messages: {
    cantForwardDeleteMids?(
      peerId: number,
      mids: number[],
      isScheduled: boolean,
    ): Promise<{ cantForward: boolean, cantDelete: boolean }>
  }
}

export type AppSelectionOptions = {
  managers: SelectionManagers
  getElementFromTarget: (target: HTMLElement) => HTMLElement | null
  verifyTarget?: (e: MouseEvent, target: HTMLElement | null) => boolean
  verifyMouseMoveTarget?: (e: MouseEvent, element: HTMLElement, selecting: boolean | undefined) => boolean
  targetLookupClassName: string
  lookupBetweenParentClassName: string
  lookupBetweenElementsQuery: string
}

/** Порт tweb `AppSelection` (selection.ts:51-580). */
export class AppSelection extends EventListenerBase<{
  toggle: (isSelecting: boolean) => void
}> {
  public selectedMids: Map<number, Set<number>> = new Map()
  public isSelecting = false

  public selectedText?: string

  protected listenerSetter?: ListenerSetter
  public isScheduled = false
  protected listenElement?: HTMLElement

  protected onToggleSelection?: (forwards: boolean, animate: boolean) => void | Promise<void>
  protected onUpdateContainer?: (cantForward: boolean, cantDelete: boolean, cantSend: boolean) => void
  protected toggleByElement?: (bubble: HTMLElement, selected?: boolean) => void

  /**
   * tweb :69, :99 — тип записи навигации, УНИКАЛЬНЫЙ НА ЭКЗЕМПЛЯР:
   * `'multiselect-' + randomLong()`. Экземпляров выделения в приложении
   * несколько (лента, поиск), и общий тип `'multiselect'` дал бы им общую
   * запись — `removeByType` одного снял бы чужую.
   *
   * Приведение к `NavigationItemType` — то же самое, что `as any` в оригинале
   * (:99): фабрикуемое имя в словарь типов по построению не входит, словарь
   * перечисляет ФИКСИРОВАННЫЕ типы. Контроллер сравнивает типы строкой и на
   * это не смотрит.
   */
  protected navigationType = ('multiselect-' + randomLong()) as NavigationItemType
  private navigationItem?: NavigationItem

  protected getElementFromTarget: AppSelectionOptions['getElementFromTarget']
  protected verifyTarget?: AppSelectionOptions['verifyTarget']
  protected verifyMouseMoveTarget?: AppSelectionOptions['verifyMouseMoveTarget']
  protected targetLookupClassName: string
  protected lookupBetweenParentClassName: string
  protected lookupBetweenElementsQuery: string

  protected doNotAnimate?: boolean
  protected managers: SelectionManagers

  constructor(options: AppSelectionOptions) {
    super(false)

    this.managers = options.managers
    this.getElementFromTarget = options.getElementFromTarget
    this.verifyTarget = options.verifyTarget
    this.verifyMouseMoveTarget = options.verifyMouseMoveTarget
    this.targetLookupClassName = options.targetLookupClassName
    this.lookupBetweenParentClassName = options.lookupBetweenParentClassName
    this.lookupBetweenElementsQuery = options.lookupBetweenElementsQuery
  }

  /** tweb :100-160 */
  public attachListeners(listenElement: HTMLElement | undefined, listenerSetter: ListenerSetter | undefined) {
    if (this.listenElement) {
      this.listenerSetter?.removeAll()
    }

    this.listenElement = listenElement
    this.listenerSetter = listenerSetter

    if (!listenElement || !listenerSetter) {
      this.removeNavigationItem()
      return
    }

    if (IS_TOUCH_SUPPORTED) {
      listenerSetter.add(listenElement)('touchend', () => {
        if (!this.isSelecting) return
        this.selectedText = getSelectedText()
      })

      // ! Здесь у tweb стоит вход в режим по long-press (:123-156,
      // ! `attachContextMenuListener`). Хелпера в репо ещё нет — вход на таче
      // ! не заведён; `return` сохранён, чтобы протяжка мышью не включалась
      // ! там, где у оригинала её нет.
      return
    }

    listenerSetter.add(listenElement)('mousedown', this.onMouseDown)
  }

  /** tweb :163-306 — drag-выделение мышью */
  private onMouseDown = (e: MouseEvent) => {
    const element = findUpClassName(e.target as HTMLElement, this.targetLookupClassName)
    if (e.button !== 0) {
      return
    }

    if (this.verifyTarget && !this.verifyTarget(e, element)) {
      return
    }

    const listenElement = this.listenElement
    const listenerSetter = this.listenerSetter
    if (!listenElement || !listenerSetter) {
      return
    }

    // 79b9c44c1: `seen` держит сами элементы — вторым элементом протяжки они
    // уходят в `toggleByElement` как есть, без поиска узла по миду
    const seen = new Map<number, Map<number, HTMLElement>>()
    let selecting: boolean | undefined
    // * the first element the drag has actually processed — everything belonging to its selection
    // * unit is not a second element (d064fdb85)
    let dragAnchor: HTMLElement | undefined

    let firstTarget = element

    // tweb :196-252
    const processElement = (element: HTMLElement, checkBetween = true) => {
      const mid = +(element.dataset.mid ?? '')
      if (!mid || !element.dataset.peerId) return
      const peerId = +element.dataset.peerId

      // Первый бабл протяжки мог уехать из DOM (подрезка вьюпорта) — тогда
      // якорем «между чем и чем» становится текущий (tweb :200-202)
      if (!firstTarget || !isInDOM(firstTarget)) {
        firstTarget = element
      }

      let seenElements = seen.get(peerId)
      if (!seenElements) {
        seen.set(peerId, seenElements = new Map())
      }

      if (seenElements.has(mid)) {
        return
      }

      if (dragAnchor && this.isSameSelectionUnit(dragAnchor, element)) {
        return
      }

      const isSelected = this.isMidSelected(peerId, mid)
      if (selecting === undefined) {
        selecting = !isSelected
      }

      seenElements.set(mid, element)
      dragAnchor ??= element

      if ((selecting && !isSelected) || (!selecting && isSelected)) {
        const seenLength = accumulateMapSet(seen)
        if (this.toggleByElement && checkBetween) {
          if (seenLength < 2) {
            if (firstTarget && findUpAsChild(element, firstTarget)) {
              firstTarget = element
            }
          }

          const elementsBetween = firstTarget ? this.getElementsBetween(firstTarget, element) : []
          if (elementsBetween.length) {
            elementsBetween.forEach((element) => {
              processElement(element, false)
            })
          }
        }

        // Реальный тоггл начинается со ВТОРОГО бабла (tweb :240-247): пока
        // выделения нет, одиночный клик-протяжка режим не включает. Положение
        // `selecting` едет явно (79b9c44c1): альбом из диапазона встаёт в него
        // целиком, а не переключается поштучно.
        if (!this.selectedMids.size) {
          if (seenLength === 2 && this.toggleByElement) {
            for (const elements of seen.values()) {
              for (const element of elements.values()) {
                this.toggleByElement(element, selecting)
              }
            }
          }
        } else if (this.toggleByElement) {
          this.toggleByElement(element, selecting)
        }
      }
    }

    let canceledSelection = false
    const onMouseMove = (e: MouseEvent) => {
      if (!canceledSelection) {
        cancelSelection()
        canceledSelection = true
        document.body.classList.add('no-select')
      }

      const element = this.getElementFromTarget(e.target as HTMLElement)
      if (!element) {
        return
      }

      if (this.verifyMouseMoveTarget && !this.verifyMouseMoveTarget(e, element, selecting)) {
        listenerSetter.removeManual(listenElement, 'mousemove', onMouseMove)
        listenerSetter.removeManual(document, 'mouseup', onMouseUp, documentListenerOptions)
        return
      }

      processElement(element)
    }

    const onMouseUp = () => {
      document.body.classList.remove('no-select')

      // Клик, которым закончилась протяжка, гасим — иначе он ещё и откроет
      // медиа/ссылку под курсором (tweb :286-288)
      if (seen.size) {
        attachClickEvent(window, cancelEvent, { capture: true, once: true, passive: false })
      }

      listenerSetter.removeManual(listenElement, 'mousemove', onMouseMove)

      cancelSelection()
    }

    const documentListenerOptions = { once: true }
    listenerSetter.add(listenElement)('mousemove', onMouseMove)
    listenerSetter.add(document)('mouseup', onMouseUp, documentListenerOptions)
  }

  /**
   * tweb :338-340 (812502980, d064fdb85). Whether `element` is a part of the same selectable unit
   * the drag has started on, and so must not count as another element of the range
   */
  protected isSameSelectionUnit(_anchor: HTMLElement, _element: HTMLElement): boolean {
    return false
  }

  /** tweb :365-393 (812502980) — все элементы ленты между первым и текущим;
   *  метод, а не поле-стрелка (79b9c44c1): `ChatSelection` его переопределяет */
  protected getElementsBetween(first: HTMLElement, last: HTMLElement): HTMLElement[] {
    if (first === last) {
      return []
    }

    const firstRect = first.getBoundingClientRect()
    const lastRect = last.getBoundingClientRect()
    const difference = (firstRect.top - lastRect.top) || (firstRect.left - lastRect.left)
    const isHigher = difference < 0

    const parent = findUpClassName(first, this.lookupBetweenParentClassName)
    if (!parent) {
      return []
    }

    const elements = Array.from(parent.querySelectorAll<HTMLElement>(this.lookupBetweenElementsQuery))
    let firstIndex = elements.indexOf(first)
    let lastIndex = elements.indexOf(last)

    if (!isHigher) {
      [lastIndex, firstIndex] = [firstIndex, lastIndex]
    }

    return elements.slice(firstIndex + 1, lastIndex)
  }

  /** tweb :338-340 */
  protected isElementShouldBeSelected(element: HTMLElement): boolean {
    return this.isMidSelected(+(element.dataset.peerId ?? ''), +(element.dataset.mid ?? ''))
  }

  /** tweb :342-344 */
  protected appendCheckbox(element: HTMLElement, checkboxField: CheckboxField) {
    element.prepend(checkboxField.label)
  }

  /** tweb :346-378 */
  public toggleElementCheckbox(element: HTMLElement, show: boolean): boolean {
    const hasCheckbox = !!this.getCheckboxInputFromElement(element)
    if (show) {
      if (hasCheckbox) {
        return false
      }

      const checkboxField = new CheckboxField({
        name: element.dataset.mid,
        round: true,
      })

      // Бабл может приехать уже в режиме выделения (дорисовка истории) — тогда
      // чекбокс сразу встаёт в нужное положение, БЕЗ перехода (tweb :364-370)
      if (this.isSelecting) {
        if (this.isElementShouldBeSelected(element)) {
          checkboxField.input.checked = true
          element.classList.add('is-selected')
        }
      }

      this.appendCheckbox(element, checkboxField)
    } else if (hasCheckbox) {
      this.getCheckboxInputFromElement(element)?.parentElement?.remove()
      setTransition({
        element,
        className: 'is-selected',
        forwards: false,
        duration: SELECTION_TRANSITION_DURATION,
      })
    }

    return true
  }

  /**
   * tweb HEAD 812502980 :444-452 — поле узнаётся по классам, а не по тегу:
   * корень `CheckboxField` с ef41b29db — `span`, а не `label` (волна 2D,
   * задача 2 перевела наш класс на HEAD).
   */
  protected getCheckboxInputFromElement(element: HTMLElement): HTMLInputElement | undefined {
    const field = element.firstElementChild
    const input = field?.firstElementChild
    if (!field?.classList.contains('checkbox-field') || !input?.classList.contains('checkbox-field-input')) {
      return
    }

    return input as HTMLInputElement
  }

  /** tweb :385-403 */
  protected async updateContainer(forceSelection = false) {
    const size = this.selectedMids.size
    if (!size && !forceSelection) return

    let cantForward = !size
    let cantDelete = !size
    const cantSend = !size

    for (const [peerId, mids] of this.selectedMids) {
      const r = await this.managers.messages.cantForwardDeleteMids?.(peerId, Array.from(mids), this.isScheduled)
      if (!r) break // факта нет — см. докблок `SelectionManagers`
      cantForward ||= r.cantForward
      cantDelete ||= r.cantDelete

      if (cantForward && cantDelete) break
    }

    this.onUpdateContainer?.(cantForward, cantDelete, cantSend)
  }

  /** tweb :405-407 в применимой части (см. шапку про `getStorageKey`) */
  public getSelectedMids(): number[] {
    return [...this.selectedMids.values()].flatMap((set) => [...set]).sort((a, b) => a - b)
  }

  /** tweb :423-473. `toggleCheckboxes` база не читает (как и tweb) — его
   *  смотрит только `ChatSelection`; под `noUnusedParameters` имя с `_`. */
  public toggleSelection(_toggleCheckboxes = true, forceSelection = false): boolean {
    const wasSelecting = this.isSelecting
    const size = this.selectedMids.size
    this.isSelecting = !!size || forceSelection

    if (wasSelecting === this.isSelecting) return false

    this.dispatchEvent('toggle', this.isSelecting)

    if (!IS_TOUCH_SUPPORTED) {
      this.listenElement?.classList.toggle('no-select', this.isSelecting)

      if (wasSelecting) {
        // ! CANCEL USER SELECTION !
        cancelSelection()
      }
    }

    blurActiveElement()

    const forwards = !!size || forceSelection
    const toggleResult = this.onToggleSelection?.(forwards, !this.doNotAnimate)

    if (!IS_MOBILE_SAFARI) {
      if (forwards) {
        this.pushNavigationItem()
      } else {
        this.removeNavigationItem()
      }
    }

    if (forceSelection) {
      void Promise.resolve(toggleResult).then(() => this.updateContainer(forceSelection))
    }

    return true
  }

  // tweb :456-465 — Back/Esc выходят из режима выделения
  private pushNavigationItem() {
    if (this.navigationItem) return
    this.navigationItem = appNavigationController.pushItem({
      type: this.navigationType,
      onPop: () => {
        this.navigationItem = undefined
        this.cancelSelection()
      },
    })
  }

  private removeNavigationItem() {
    // tweb :111-113 — снятие ПО ТИПУ, а не по ссылке: свои записи выделения
    // уникальны по построению, и это тот же вызов, каким оригинал чистит их
    // при отвязке от элемента.
    this.navigationItem = undefined
    appNavigationController.removeByType(this.navigationType)
  }

  /** tweb :475-482 */
  public cancelSelection = (doNotAnimate?: boolean) => {
    if (doNotAnimate) this.doNotAnimate = true
    this.selectedMids.clear()
    this.toggleSelection()
    cancelSelection() // ! это модульный хелпер (снять выделение текста), не метод
    if (doNotAnimate) this.doNotAnimate = undefined
  }

  /** tweb :484-489 */
  public cleanup() {
    this.doNotAnimate = true
    this.selectedMids.clear()
    this.toggleSelection(false)
    this.doNotAnimate = undefined
  }

  /** tweb :491-501 */
  protected updateElementSelection(element: HTMLElement, isSelected: boolean) {
    this.toggleElementCheckbox(element, true)
    const input = this.getCheckboxInputFromElement(element)
    if (input) input.checked = isSelected

    this.toggleSelection()
    void this.updateContainer()
    setTransition({
      element,
      className: 'is-selected',
      forwards: isSelected,
      duration: SELECTION_TRANSITION_DURATION,
    })
  }

  /** tweb :503-506 */
  public isMidSelected(peerId: number, mid: number): boolean {
    const set = this.selectedMids.get(peerId)
    return !!set?.has(mid)
  }

  /** tweb :508-510 */
  public length(): number {
    return accumulateMapSet(this.selectedMids)
  }

  /**
   * tweb :512-550. Числового лимита нет — старый `forwarded_count_max`
   * закомментирован у самого tweb (:526-543), фактический предел это дизейбл
   * Forward при непересылаемых.
   */
  public toggleMid(peerId: number, mid: number, unselect?: boolean): boolean {
    let set = this.selectedMids.get(peerId)
    if (unselect || (unselect === undefined && set?.has(mid))) {
      if (set) {
        set.delete(mid)

        if (!set.size) {
          this.selectedMids.delete(peerId)
        }
      }
    } else {
      if (!set) {
        set = new Set()
        this.selectedMids.set(peerId, set)
      }

      set.add(mid)
    }

    return true
  }

  /**
   * tweb :552-578.
   * ! Звать ТОЛЬКО на удаление сообщений.
   */
  public deleteSelectedMids(peerId: number, mids: number[], batch?: boolean) {
    const set = this.selectedMids.get(peerId)
    if (!set) {
      return
    }

    mids.forEach((mid) => {
      set.delete(mid)
    })

    if (!set.size) {
      this.selectedMids.delete(peerId)
    }

    const after = () => {
      void this.updateContainer()
      this.toggleSelection()
    }

    if (!batch) after()
    return after
  }
}

/**
 * Порт tweb `SearchSelection` (`chat/selection.ts:662-839`, 812502980) —
 * выделение элементов shared media (`AppSearchSuper`). Плашка действий
 * `.search-super-selection-container` встаёт В РЯД ВКЛАДОК
 * (`navScrollableContainer`), а `is-selecting` — на ряд и на весь контейнер
 * (`_searchSuper.scss`, правила `is-selecting`).
 *
 * ── Адаптации ────────────────────────────────────────────────────────────────
 *  • действия плашки — колбэки хоста у `AppSearchSuper` (расхождение 51 в
 *    шапке класса): `appImManager.setInnerPeer` → `searchSuper.setInnerPeer`,
 *    `showForwardPopup` → `searchSuper.showForwardPopup`,
 *    `showDeleteMessagesPopup` → `searchSuper.showDeleteMessagesPopup`;
 *    обратный вызов «снять выделение по подтверждению» едет тем же аргументом,
 *    что у оригинала;
 *  • `ariaLabel` кнопок плашки (472e3e76b, a11y) не переносится — своя задача;
 *  • `getSelectedMessages` (у tweb — базовый, `:482-490`, из хранилища
 *    сообщений менеджера) — здесь, поверх кэша shared media
 *    (`getSharedMediaMessage`): из него же нарисованы элементы, и другого
 *    хранилища этих сообщений на главном потоке нет;
 *  • менеджер прав (`cantForwardDeleteMids`) не передаётся — факта нет
 *    (докблок `SelectionManagers`), кнопки не прячутся по правам.
 */
export class SearchSelection extends AppSelection {
  protected selectionContainer?: HTMLElement
  protected selectionCountEl?: HTMLElement
  public selectionForwardBtn?: HTMLElement
  public selectionDeleteBtn?: HTMLElement
  public selectionGotoBtn?: HTMLElement

  private isPrivate: boolean

  // * plate-scoped: the tab's listenerSetter outlives every selection session,
  // * so plate button listeners must not accumulate there
  private containerListenerSetter?: ListenerSetter

  constructor(
    private searchSuper: AppSearchSuper,
    managers: SelectionManagers,
    listenerSetter: ListenerSetter,
  ) {
    super({
      managers,
      verifyTarget: (_e, target) => !!target && this.isSelecting,
      getElementFromTarget: (target) => findUpClassName(target, 'search-super-item'),
      targetLookupClassName: 'search-super-item',
      lookupBetweenParentClassName: 'tabs-tab',
      lookupBetweenElementsQuery: '.search-super-item',
    })

    this.isPrivate = !searchSuper.showSender
    if (!IS_TOUCH_SUPPORTED) this.attachListeners(searchSuper.container, listenerSetter)
  }

  /** tweb :703-714 */
  public override toggleSelection(toggleCheckboxes = true, forceSelection = false): boolean {
    const ret = super.toggleSelection(toggleCheckboxes, forceSelection)

    if (ret && toggleCheckboxes) {
      const elements = Array.from(this.searchSuper.tabsContainer.querySelectorAll<HTMLElement>('.search-super-item'))
      elements.forEach((element) => {
        this.toggleElementCheckbox(element, this.isSelecting)
      })
    }

    return ret
  }

  /** tweb :716-729 */
  public override toggleByElement = (element: HTMLElement, selected?: boolean): void => {
    const mid = +(element.dataset.mid ?? '')
    const peerId = +(element.dataset.peerId ?? '')
    const isSelected = this.isMidSelected(peerId, mid)
    if (selected !== undefined && selected === isSelected) {
      return
    }

    if (!this.toggleMid(peerId, mid)) {
      return
    }

    this.updateElementSelection(element, this.isMidSelected(peerId, mid))
  }

  /** tweb :482-490 — см. «Адаптации» в докблоке класса */
  public getSelectedMessages(): MyMessage[] {
    const messages: MyMessage[] = []
    this.selectedMids.forEach((mids, peerId) => {
      mids.forEach((mid) => {
        const message = getSharedMediaMessage(peerId, mid)
        if (message) messages.push(message)
      })
    })
    return messages
  }

  /** tweb :731-737 */
  protected override onUpdateContainer = (cantForward: boolean, cantDelete: boolean) => {
    const length = this.length()
    replaceContent(this.selectionCountEl!, i18n('messages', [length]))
    this.selectionGotoBtn!.classList.toggle('hide', length !== 1)
    this.selectionForwardBtn!.classList.toggle('hide', cantForward)
    this.selectionDeleteBtn?.classList.toggle('hide', cantDelete)
  }

  /** tweb :739-838 */
  protected override onToggleSelection = (forwards: boolean, animate: boolean) => {
    setTransition({
      element: this.searchSuper.navScrollableContainer,
      className: 'is-selecting',
      forwards,
      duration: animate ? SELECTION_TRANSITION_DURATION : 0,
      onTransitionEnd: () => {
        if (!this.isSelecting) {
          this.containerListenerSetter?.removeAll()
          this.containerListenerSetter = undefined
          this.selectionContainer?.remove()
          this.selectionContainer =
            this.selectionForwardBtn =
            this.selectionDeleteBtn =
            undefined
          this.selectedText = undefined
        }
      },
    })

    setTransition({
      element: this.searchSuper.container,
      className: 'is-selecting',
      forwards,
      duration: SELECTION_TRANSITION_DURATION,
    })

    if (this.isSelecting) {
      if (!this.selectionContainer) {
        const BASE_CLASS = 'search-super-selection'
        this.selectionContainer = document.createElement('div')
        this.selectionContainer.classList.add(BASE_CLASS + '-container')

        const containerListenerSetter = this.containerListenerSetter = new ListenerSetter()

        const btnCancel = ButtonIcon(`close ${BASE_CLASS}-cancel`, { noRipple: true })
        attachClickEvent(btnCancel, () => this.cancelSelection(), { listenerSetter: containerListenerSetter, once: true })

        this.selectionCountEl = document.createElement('div')
        this.selectionCountEl.classList.add(BASE_CLASS + '-count')

        const attachClickOptions = { listenerSetter: containerListenerSetter }

        this.selectionGotoBtn = ButtonIcon(`message ${BASE_CLASS}-goto`)
        attachClickEvent(this.selectionGotoBtn, () => {
          const peerId = [...this.selectedMids.keys()][0]
          const mid = [...this.selectedMids.get(peerId)!][0]
          this.cancelSelection()

          this.searchSuper.setInnerPeer?.({
            peerId,
            lastMsgId: mid,
            threadId: this.searchSuper.mediaTab.type === 'saved' ? this.searchSuper.searchContext.peerId : this.searchSuper.searchContext.threadId,
          })
        }, attachClickOptions)

        this.selectionForwardBtn = ButtonIcon(`forward ${BASE_CLASS}-forward`)
        attachClickEvent(this.selectionForwardBtn, () => {
          const obj: { [fromPeerId: PeerId]: number[] } = {}
          for (const [fromPeerId, mids] of this.selectedMids) {
            obj[fromPeerId] = Array.from(mids).sort((a, b) => a - b)
          }

          this.searchSuper.showForwardPopup?.(obj, () => {
            this.cancelSelection()
          })
        }, attachClickOptions)

        if (this.isPrivate) {
          this.selectionDeleteBtn = ButtonIcon(`delete danger ${BASE_CLASS}-delete`)
          attachClickEvent(this.selectionDeleteBtn, () => {
            const peerId = this.searchSuper.searchContext.peerId
            this.searchSuper.showDeleteMessagesPopup?.(
              peerId,
              this.getSelectedMids(),
              () => {
                this.cancelSelection()
              },
            )
          }, attachClickOptions)
        }

        this.selectionContainer.append(...[
          btnCancel,
          this.selectionCountEl,
          this.selectionGotoBtn,
          this.selectionForwardBtn,
          this.selectionDeleteBtn,
        ].filter((element): element is HTMLElement => !!element))

        const transitionElement = this.selectionContainer
        transitionElement.style.opacity = '0'
        this.searchSuper.navScrollableContainer.append(transitionElement)

        void transitionElement.offsetLeft // reflow
        transitionElement.style.opacity = ''
      }
    }
  }
}

/** Порт tweb `ChatSelection` (selection.ts:764-1189). */
export default class ChatSelection extends AppSelection {
  private bubbles: SelectionBubbles

  /** tweb `new ChatSelection(chat, bubbles, input, managers)` (chat.ts:620); `input`
   *  нужен оригиналу ради плашки действий — у нас она в бэклоге (Б-23). */
  constructor(public chat: Chat, bubbles: SelectionBubbles, _input: ChatInput, managers: SelectionManagers) {
    super({
      managers,
      // tweb :798
      getElementFromTarget: (target) => findUpClassName(target, 'grouped-item') || findUpClassName(target, 'bubble'),
      // tweb :799-807: не включать протяжку, если нажали на потомка бабла
      verifyTarget: (e, target) => {
        const bad = !this.selectedMids.size &&
          !(e.target as HTMLElement).classList.contains('bubble') &&
          !(e.target as HTMLElement).classList.contains('document-selection') &&
          !!target

        return !bad
      },
      // tweb :808-814
      verifyMouseMoveTarget: (e, element, selecting) => {
        const bad = e.target !== element &&
          !(e.target as HTMLElement).classList.contains('document-selection') &&
          selecting === undefined &&
          !this.selectedMids.size
        return !bad
      },
      // tweb :816-818
      targetLookupClassName: 'bubble',
      lookupBetweenParentClassName: 'bubbles-inner',
      lookupBetweenElementsQuery: '.bubble:not(.is-multiple-documents), .grouped-item',
    })

    this.bubbles = bubbles
  }

  /** tweb :900-902 (812502980, d064fdb85) */
  protected override isSameSelectionUnit(anchor: HTMLElement, element: HTMLElement): boolean {
    return isSameGroupedSelectionUnit(anchor, element)
  }

  /** tweb :904-917 (812502980, 79b9c44c1 + d064fdb85) — диапазон, задевший
   *  альбом, раскрывается по его ячейкам */
  protected override getElementsBetween(first: HTMLElement, last: HTMLElement): HTMLElement[] {
    const elements = super.getElementsBetween(first, last)
    if (first === last) {
      // * there is no range yet — expanding the endpoints here would pull in the whole album
      return elements
    }

    return expandAlbumSelectionRange({
      first,
      last,
      elements,
      getGroupedItems: (bubble) => this.bubbles.getBubbleGroupedItems(bubble),
    })
  }

  /** tweb :824-832 */
  protected override appendCheckbox(bubble: HTMLElement, checkboxField: CheckboxField) {
    checkboxField.label.classList.add('bubble-select-checkbox')

    if (bubble.classList.contains('document-container')) {
      bubble.querySelector('.document, audio-element')?.append(checkboxField.label)
    } else {
      super.appendCheckbox(bubble, checkboxField)
    }
  }

  /** tweb :862-885 */
  public override toggleSelection(toggleCheckboxes = true, forceSelection = false): boolean {
    const ret = super.toggleSelection(toggleCheckboxes, forceSelection)

    if (ret && toggleCheckboxes) {
      const history = this.bubbles.getRenderedHistory('asc')
      for (const fullMid of history) {
        if (this.bubbles.skippedMids?.has(fullMid)) {
          continue
        }

        const bubble = this.bubbles.getBubble(fullMid)
        if (bubble) {
          this.toggleElementCheckbox(bubble, this.isSelecting)
        }
      }
    }

    return ret
  }

  /** tweb :887-899 — чекбокс группового контейнера тянет за собой чекбоксы ячеек */
  public override toggleElementCheckbox(bubble: HTMLElement, show: boolean): boolean {
    if (!this.canSelectBubble(bubble)) return false

    const ret = super.toggleElementCheckbox(bubble, show)
    if (ret) {
      const isGrouped = bubble.classList.contains('is-grouped')
      if (isGrouped) {
        this.bubbles.getBubbleGroupedItems(bubble).forEach((item) => this.toggleElementCheckbox(item, show))
      }
    }

    return ret
  }

  /** tweb :901-937; `selected` — 79b9c44c1 (812502980 :997-1051): протяжка
   *  ставит элемент в заданное положение, а не переключает его */
  public override toggleByElement = (bubble: HTMLElement, selected?: boolean): void => {
    if (!this.canSelectBubble(bubble)) return

    const mid = +(bubble.dataset.mid ?? '')
    const peerId = +(bubble.dataset.peerId ?? '')

    const isGrouped = bubble.classList.contains('is-grouped')
    if (isGrouped) {
      // Альбом в заданное положение встаёт целиком — каждой ячейкой
      // (812502980 :1005-1012)
      if (selected !== undefined && setAlbumItemsSelection({
        album: bubble,
        selected,
        getGroupedItems: (album) => this.bubbles.getBubbleGroupedItems(album),
        setElementSelection: (element, selected) => this.toggleByElement(element, selected),
      })) {
        return
      }

      // Контейнер альбома: если он выбран не целиком — сначала снимаем всё, что
      // в нём уже выбрано, чтобы дальше ячейки встали в ОДНО положение
      // (tweb :908-916)
      if (!this.isGroupedBubbleSelected(bubble)) {
        const set = this.selectedMids.get(peerId)
        if (set) {
          const mids = this.getMidsFromGroupContainer(bubble)
          mids.forEach(({ mid }) => set.delete(mid))
        }
      }

      this.bubbles.getBubbleGroupedItems(bubble).forEach((item) => this.toggleByElement(item))
      return
    }

    const isSelected = this.isMidSelected(peerId, mid)
    if (selected !== undefined && selected === isSelected) {
      return
    }

    if (!this.toggleMid(peerId, mid)) {
      return
    }

    // Ячейка альбома: чекбокс контейнера отражает «выбраны все» (tweb :924-934)
    const isGroupedItem = bubble.classList.contains('grouped-item')
    if (isGroupedItem) {
      const groupContainer = findUpClassName(bubble, 'bubble')
      if (groupContainer) {
        const isGroupedSelected = this.isGroupedBubbleSelected(groupContainer)
        const isGroupedMidsSelected = this.isGroupedMidsSelected(groupContainer)

        const willChange = isGroupedMidsSelected || isGroupedSelected
        if (willChange) {
          this.updateElementSelection(groupContainer, isGroupedMidsSelected)
        }
      }
    }

    this.updateElementSelection(bubble, this.isMidSelected(peerId, mid))
  }

  /** tweb :946-949 */
  protected override isElementShouldBeSelected(element: HTMLElement): boolean {
    const isGrouped = element.classList.contains('is-grouped')
    return super.isElementShouldBeSelected(element) && (!isGrouped || this.isGroupedMidsSelected(element))
  }

  /** tweb :951-954 */
  protected isGroupedBubbleSelected(bubble: HTMLElement): boolean {
    const groupedCheckboxInput = this.getCheckboxInputFromElement(bubble)
    return !!groupedCheckboxInput?.checked
  }

  /** tweb :956-968 */
  protected getMidsFromGroupContainer(groupContainer: HTMLElement): { mid: number, peerId: number }[] {
    const elements = this.bubbles.getBubbleGroupedItems(groupContainer)
    if (!elements.length) {
      elements.push(groupContainer)
    }

    return elements.map((element) => ({
      mid: +(element.dataset.mid ?? ''),
      peerId: +(element.dataset.peerId ?? ''),
    }))
  }

  /** tweb :970-974 */
  protected isGroupedMidsSelected(groupContainer: HTMLElement): boolean {
    const mids = this.getMidsFromGroupContainer(groupContainer)
    const selectedMids = mids.filter(({ peerId, mid }) => this.isMidSelected(peerId, mid))
    return mids.length === selectedMids.length
  }

  /** tweb :976-997 */
  protected override getCheckboxInputFromElement(bubble: HTMLElement): HTMLInputElement | undefined {
    return bubble.classList.contains('document-container') ?
      (bubble.querySelector('label input') as HTMLInputElement | null) ?? undefined :
      super.getCheckboxInputFromElement(bubble)
  }

  /** tweb :999-1006 */
  public canSelectBubble(bubble: HTMLElement | null | undefined): boolean {
    return !!bubble &&
      // * tweb e9428f2a9 (812502980 :1037-1046): a service message IS selectable
      // * (it can be deleted just like a regular one) — only the bubbles that stand
      // * for no message at all are not: date separators. Two more exclusions of the
      // * original have no subject here: the admin log (`ChatType.Logs`) and the
      // * choose-messages report flow (`isReportSelection`) are not ported.
      !bubble.classList.contains('is-date') &&
      !bubble.classList.contains('is-outgoing') &&
      !bubble.classList.contains('is-error') &&
      !bubble.classList.contains('bubble-first') &&
      !bubble.classList.contains('avoid-selection')
  }

  /** tweb :1008-1136 в части, которая принадлежит ленте (см. шапку) */
  protected override onToggleSelection = (forwards: boolean, animate: boolean) => {
    const listenElement = this.listenElement
    if (!listenElement) return

    setTransition({
      element: listenElement,
      className: 'is-selecting',
      forwards,
      duration: animate ? SELECTION_TRANSITION_DURATION : 0,
      onTransitionEnd: () => {
        if (!this.isSelecting) {
          this.selectedText = undefined
        }
      },
    })
  }
}
