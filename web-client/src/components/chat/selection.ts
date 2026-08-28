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
 *    `toggleByElement`/`toggleByMid` (:894-984), чекбокс группового
 *    контейнера, `appendCheckbox` (:824-832), обход отрисованной истории в
 *    `toggleSelection` (:866-885).
 *
 * ── Границы порта (у каждой — предмет, а не «у нас так») ────────────────────
 *  • ПАНЕЛЬ ДЕЙСТВИЙ (`onToggleSelection` :1008-1136, `onUpdateContainer`
 *    :1138-1157, `removeSelectionContainer` :1159-1173) — плашка вместо
 *    композера. Её носитель у tweb — `chat.input` (`ChatInputPlate`,
 *    `inputContainer`), у императивной ленты композера нет вовсе. Плашка
 *    вынесена в узкий порт `SelectionPlate` (ниже); класс `is-selecting` на
 *    самой ленте (`listenElement`) остаётся здесь — это узел ленты, а не
 *    композера.
 *  • ПОПАПЫ delete/forward/sendNow (:1085-1118) и report-режим
 *    (`enterReportSelection` :832-845, `showSelectedMessagesReport`) — их
 *    носители (`PopupDeleteMessages`, `showForwardPopup`, `PopupSendNow`,
 *    `PopupElement`) не портированы; действия принадлежат реализации
 *    `SelectionPlate`, ей же принадлежит и вызов `cancelSelection()` после.
 *  • ВХОД НА ТАЧЕ через long-press (:117-157) требует
 *    `helpers/dom/attachContextMenuListener`, которого в репо ещё нет. Ветка
 *    `IS_TOUCH_SUPPORTED` в `attachListeners` СОХРАНЕНА (иначе на таче
 *    заработала бы мышиная протяжка, которой у оригинала там нет) — в ней
 *    портирован только сбор `selectedText` по `touchend` (:118-121).
 *  • `SearchSelection` (:580-762) — выделение в shared media; носитель
 *    (`AppSearchSuper`) вне периметра ленты.
 *  • `getSelectedMessages` (:409-421) — её единственные вызывающие у tweb это
 *    `contextMenu.ts:492` и `appSearchSuper.ts:208`; обоих в порте нет,
 *    заводить метод без вызывающего = мёртвый код.
 *  • `onCancelSelection` (:1177-1189) — в `ChatSelection` его тело это ровно
 *    сброс `reportSelectionData` (остальное закомментировано у самого tweb);
 *    без report-режима у хука нет ни одного реализатора.
 *
 * ── Адаптации (рантайм тот же) ──────────────────────────────────────────────
 *  • `PeerId`/`.toPeerId()` у нас нет — peerId это `number`;
 *  • `appNavigationController.pushItem({type: 'multiselect-…'})` (:456-465)
 *    заменён на наш эквивалент: `navigationStack.pushLayer` (Back) +
 *    `hotkeys.pushEsc` (Esc). В tweb оба факта даёт один контроллер, у нас
 *    они разведены по двум владельцам — поведение то же: Back/Esc =
 *    `cancelSelection`;
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
import { pushEsc } from '@core/hotkeys'
import { pushLayer, removeLayer, type Layer } from '@core/navigation/navigationStack'
import IS_TOUCH_SUPPORTED from '@environment/touchSupport'
import { IS_MOBILE_SAFARI } from '@environment/userAgent'
import blurActiveElement from '@helpers/dom/blurActiveElement'
import cancelEvent from '@helpers/dom/cancelEvent'
import cancelSelection from '@helpers/dom/cancelSelection'
import { attachClickEvent } from '@helpers/dom/clickEvent'
import findUpAsChild from '@helpers/dom/findUpAsChild'
import findUpClassName from '@helpers/dom/findUpClassName'
import getSelectedText from '@helpers/dom/getSelectedText'
import isInDOM from '@helpers/dom/isInDOM'
import EventListenerBase from '@helpers/eventListenerBase'
import type ListenerSetter from '@helpers/listenerSetter'

/** tweb selection.ts:45-47 */
const accumulateMapSet = (map: Map<number, Set<number>>): number => {
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
  /** tweb `ChatBubbles.getMountedBubble` (bubbles.ts:3925) */
  getMountedBubble(fullMid: string): Promise<{ bubble: HTMLElement } | undefined>
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

/**
 * Узкий порт ПЛАШКИ действий (tweb `onToggleSelection`/`onUpdateContainer`/
 * `removeSelectionContainer`, :1008-1173). Реализация владеет и разметкой
 * плашки, и попапами delete/forward/sendNow; ссылку на `ChatSelection` она
 * получает от хоста — оттуда ей доступны `getSelectedMids()`, `selectedMids`,
 * `length()` и `cancelSelection()`.
 */
export interface SelectionPlate {
  /** Показать/скрыть плашку вместо композера. Возвращённый промис ждут перед
   *  переходом самой ленты — у tweb это `await chat.input.center(animate)`. */
  toggle(forwards: boolean, animate: boolean): void | Promise<void>
  /** Пересчитать счётчик и дизейбл кнопок (tweb :1138-1157). Число выбранных
   *  реализация берёт у `ChatSelection.length()` — ровно как tweb. */
  update(cantForward: boolean, cantDelete: boolean, cantSend: boolean): void
  /** Снести плашку по концу обратного перехода (tweb :1159-1173). */
  remove(): void
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
  protected toggleByMid?: (peerId: number, mid: number) => void
  protected toggleByElement?: (bubble: HTMLElement) => void

  // Наш эквивалент `navigationType` + `appNavigationController` (tweb :96, :456-465)
  private navigationLayer?: Layer
  private removeEsc?: () => void

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

    const seen: AppSelection['selectedMids'] = new Map()
    let selecting: boolean | undefined

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

      let seenSet = seen.get(peerId)
      if (!seenSet) {
        seen.set(peerId, seenSet = new Set())
      }

      if (seenSet.has(mid)) {
        return
      }

      const isSelected = this.isMidSelected(peerId, mid)
      if (selecting === undefined) {
        selecting = !isSelected
      }

      seenSet.add(mid)

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
        // выделения нет, одиночный клик-протяжка режим не включает
        if (!this.selectedMids.size) {
          if (seenLength === 2 && this.toggleByMid) {
            for (const [peerId, mids] of seen) {
              for (const mid of mids) {
                this.toggleByMid(peerId, mid)
              }
            }
          }
        } else if (this.toggleByElement) {
          this.toggleByElement(element)
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

  /** tweb :308-336 — все элементы ленты между первым и текущим */
  private getElementsBetween = (first: HTMLElement, last: HTMLElement): HTMLElement[] => {
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

  /** tweb :380-383 */
  protected getCheckboxInputFromElement(element: HTMLElement): HTMLInputElement | undefined {
    const first = element.firstElementChild
    return first?.tagName === 'LABEL' ? (first.firstElementChild as HTMLInputElement) : undefined
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
    if (this.navigationLayer) return
    this.navigationLayer = pushLayer(() => {
      this.navigationLayer = undefined
      this.cancelSelection()
    })
    this.removeEsc = pushEsc(() => this.cancelSelection())
  }

  private removeNavigationItem() {
    if (this.navigationLayer) {
      const layer = this.navigationLayer
      this.navigationLayer = undefined
      removeLayer(layer)
    }

    this.removeEsc?.()
    this.removeEsc = undefined
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

/** Порт tweb `ChatSelection` (selection.ts:764-1189). */
export default class ChatSelection extends AppSelection {
  private bubbles: SelectionBubbles
  private plate?: SelectionPlate

  constructor(bubbles: SelectionBubbles, managers: SelectionManagers, plate?: SelectionPlate) {
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
    this.plate = plate
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

  /** tweb :901-937 */
  public override toggleByElement = (bubble: HTMLElement): void => {
    if (!this.canSelectBubble(bubble)) return

    const mid = +(bubble.dataset.mid ?? '')
    const peerId = +(bubble.dataset.peerId ?? '')

    const isGrouped = bubble.classList.contains('is-grouped')
    if (isGrouped) {
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

      this.bubbles.getBubbleGroupedItems(bubble).forEach(this.toggleByElement)
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

  /** tweb :939-944 */
  protected override toggleByMid = async(peerId: number, mid: number) => {
    const mounted = await this.bubbles.getMountedBubble(`${peerId}_${mid}`)
    if (mounted) {
      this.toggleByElement(mounted.bubble)
    }
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
      !bubble.classList.contains('service') &&
      !bubble.classList.contains('is-outgoing') &&
      !bubble.classList.contains('is-error') &&
      !bubble.classList.contains('bubble-first') &&
      !bubble.classList.contains('avoid-selection')
  }

  /** tweb :1008-1136 в части, которая принадлежит ленте (см. шапку) */
  protected override onToggleSelection = async(forwards: boolean, animate: boolean): Promise<void> => {
    await this.plate?.toggle(forwards, animate)

    const listenElement = this.listenElement
    if (!listenElement) return

    setTransition({
      element: listenElement,
      className: 'is-selecting',
      forwards,
      duration: animate ? SELECTION_TRANSITION_DURATION : 0,
      onTransitionEnd: () => {
        if (!this.isSelecting) {
          this.plate?.remove()
          this.selectedText = undefined
        }
      },
    })
  }

  /** tweb :1138-1157 в части, которая принадлежит ленте (счётчик и дизейбл —
   *  внутри плашки, она читает `length()` сама, как и оригинал) */
  protected override onUpdateContainer = (cantForward: boolean, cantDelete: boolean, cantSend: boolean) => {
    this.plate?.update(cantForward, cantDelete, cantSend)
  }
}
