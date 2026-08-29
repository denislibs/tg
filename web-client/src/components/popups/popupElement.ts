// Порт tweb `components/popups/index.ts` — база `PopupElement`. Объём этой
// волны (задача 1 плана solid-wave-1): конструктор и дерево (:81-90), setButtons
// (:247-320), show (:330-389), hide (:391-402), forceHide (:409-411), destroy
// (:413-449), createPopup (:478-481).
// Конкретные попапы (потомки) — отдельные задачи того же плана.
//
// НЕ портировано в этой волне (у каждого пункта — «нет потребителя в волне 1»,
// не молча):
//   • `options.isConfirmationNeededOnClose` (tweb :42, :339-348) — подтверждение
//     при закрытии (напр. «отменить правки?»); ни один попап волны 1 его не
//     запрашивает. Следствие ниже: `hide()` у нас идёт сразу в `destroy()`.
//   • `options.old` / `this.night` (tweb :117, :125-131, :329-337) — тёмная
//     тема старых попапов и связь с `overlayCounter.isDarkOverlayActive`.
//   • `options.withoutOverlay` (tweb :48, :101, :180-183, :363, :426, :445) —
//     попап без затемнения экрана; ветки `if(!this.withoutOverlay)` ниже свёрнуты
//     в безусловные (эквивалент withoutOverlay === false всегда).
//   • `static reAppend()`/`getPopups()` (tweb :463-476) — переезд DOM-узла при
//     входе/выходе из полноэкранного режима и полнотекстовый поиск открытых
//     попапов по конструктору; `appendPopupTo()` здесь тоже упрощён до
//     `document.body` (без fullscreen/Document PiP резолва).
//   • `options.scrollable`/`floatingHeader` + `Scrollable` внутри тела
//     (tweb :49, :52, :105, :212-227, :322-328) — ни один попап не скроллит
//     длинный список.
//   • `appendSolid`/`appendSolidBody` (tweb :451-462) — мост Solid внутрь тела
//     попапа. Были портированы волной 1 и СНЯТЫ волной 2 (задача 8): потребителя
//     им не дала ни та, ни другая — Solid-содержимое вкладок монтирует
//     `scaffoldSolidJSTab` через тот же `mountSolid` напрямую
//     (`components/solidJsTabs/scaffoldSolidJSTab.solid.tsx`), а ни один попап
//     обеих волн Solid не рисует. Вернутся вместе с первым богатым попапом —
//     порт занимает шесть строк поверх `mountSolid`.
//   • `options.confirmShortcutIsSendShortcut` (tweb :47, :98, :153, :382) —
//     выбор между Ctrl+Enter/обычным Enter для подтверждения по клавише;
//     условие в `show()` ниже всегда `e.key === 'Enter'`.
//   • `options.onBackClick`/`footer`/`withFooterConfirm` и `MarkupTooltip`
//     (tweb :41, :46, :53, :161-177, :229-237, :424) — их нет и в `PopupOptions`
//     этой волны: ни один попап волны 1 не показывает кнопку «назад» в шапке,
//     прибитый футер или подсказку разметки композера.
//   • вызов `onFullScreenChange()` из `destroy()` (tweb :436, «! calm») —
//     отдельно от общего пункта про `reAppend()`/`getPopups()` выше: он лишь
//     заново раскладывает уже открытые попапы по актуальному `appendPopupTo()`
//     после закрытия одного из них (сценарий fullscreen/Document PiP),
//     которого у нас нет.
//   • `lateMiddlewareHelper` (tweb :113, :149, :443, «Gets destroyed after
//     timeout») — второй хелпер оригинала, гасится ПОСЛЕ 250мс-таймера
//     `destroy()` (тем же тиком, что `element.remove()`/`closeAfterTimeout`/
//     `cleanup()`), а не сразу. Нет потребителя: ни один узел, порождённый
//     попапом этой волны, не обязан пережить именно ЭТОТ момент — единственный
//     нашедшийся потребитель асинхронщины (аватар `PopupPeer`, см. ниже)
//     умирает вместе с обычным `middlewareHelper`, синхронно в `destroy()`.
//     Портировать второй хелпер без потребителя значило бы тащить мёртвый код;
//     когда появится узел/эффект, обязанный пережить именно 250мс-таймер
//     (а не сам факт закрытия) — заводить здесь же, портом tweb :113/:149/:443.
//
// Раунд правок 1 (после отчёта задачи 2): `middlewareHelper` (tweb :109, :148,
// :423) — ПОРТИРОВАН, вопреки первоначальному решению «нет потребителя»
// (см. предыдущую версию этого докблока в истории коммитов). Решение было
// опровергнуто фактом, не рассуждением: `ConfirmPopup.tsx`/`MutePopup.tsx`
// реально показывают аватар пира в подтверждении — значит `PopupPeer.peerId`
// (tweb `peer.ts:44-55`) НЕ псевдо-опция без потребителя, а видимая
// пользователю функция. `avatarNew` (`components/avatar.ts`) требует
// `middleware: Middleware` для отписки узла от зеркала пиров
// (`options.middleware.onClean(() => live.delete(this))`) — без него аватар
// в закрытом попапе навсегда остаётся в модульном `Set` живых узлов и
// перерисовывается на каждое чужое движение зеркала: тот же класс утечки,
// что уже ловили в ленте («лента умирает на каждой смене чата, а слушатели
// переживают её», `web-client/CLAUDE.md` → «Владение фактами»). Здесь
// портирован ТОЛЬКО `middlewareHelper` (без `lateMiddlewareHelper` — см.
// пункт выше), гасится синхронно в `destroy()`, тем же местом, что
// `listenerSetter.removeAll()` (tweb :422-423, соседние строки).
//
// Esc и Back — НЕ через `appNavigationController` оригинала (единый LIFO-стек
// tweb :336-354, `pushItem`/`backByItem`/`removeItem`), а через два наших
// раздельных механизма: `core/hotkeys.pushEsc` (клавиша) и
// `core/navigation/navigationStack.pushLayer`/`removeLayer` (аппаратный/
// браузерный Back). Тот же приём уже применён в
// `shared/ui/Popup/Popup.tsx:96-101` и `helpers/overlayClickHandler.ts:104-105`
// — третий способ не изобретаем. Поскольку `isConfirmationNeededOnClose` не
// портирован, оба обработчика ниже сводятся к `this.hide()`, а `hide()` — сразу
// к `this.destroy()` (в оригинале это же в итоге делает `backByItem`).
import Icon from '@components/icon'
import animationIntersector from '@components/animationIntersector'
import overlayCounter from '@helpers/overlayCounter'
import EventListenerBase, { type EventListenerListeners } from '@helpers/eventListenerBase'
import ListenerSetter from '@helpers/listenerSetter'
import { attachClickEvent, simulateClickEvent } from '@helpers/dom/clickEvent'
import findUpClassName from '@helpers/dom/findUpClassName'
import blurActiveElement from '@helpers/dom/blurActiveElement'
import cancelEvent from '@helpers/dom/cancelEvent'
import indexOfAndSplice from '@helpers/array/indexOfAndSplice'
import { pushEsc } from '@core/hotkeys'
import { pushLayer, removeLayer, type Layer } from '@core/navigation/navigationStack'
import { getMiddleware, type MiddlewareHelper } from '@helpers/middleware'

/** tweb :26-37, упрощено: `text` всегда готовая строка (без LangPackKey/i18n —
 *  переводом владеет вызывающий, как и `title` в `PopupOptions` ниже), без
 *  промис-результата колбэка (`toggleDisability` во время ожидания — tweb
 *  :283-295 — не портирован, нет потребителя в волне 1) и без iconLeft/iconRight. */
export type PopupButton = {
  text: string,
  callback?: () => void,
  isDanger?: boolean,
  isCancel?: boolean,
}

/** tweb :39-55, сужено до опций, у которых есть потребитель в волне 1. */
export type PopupOptions = {
  closable?: boolean,
  overlayClosable?: boolean,
  withConfirm?: string,
  body?: boolean,
  title?: string,
  /**
   * НАШЕ расширение сверх tweb — у оригинала такой опции нет и не нужно:
   * стек `PopupElement.POPUPS` там ни с чем сторонним не пересекается. У нас
   * же React ещё не весь переехал (задача 3 плана solid-wave-1), и попап
   * обязан лечь ПОВЕРХ уже существующих React-оверлеев с собственным
   * z-index — полноэкранного `MediaEditor` (портал, z-index задаёт сам
   * компонент) и слайд-стека `SettingsScreen`. Единственный потребитель —
   * мост `components/settings/ConfirmDialog.tsx` (задача 3): без своей
   * z-index попап рисовался бы ПОД ними. Временное расширение переходного
   * периода, снимается вместе с последним React-оверлеем (волна 8 плана).
   */
  zIndex?: number,
}

type PopupListeners = {
  close: () => void,
  closeAfterTimeout: () => void,
}

export default class PopupElement<E extends EventListenerListeners = {}> extends EventListenerBase<PopupListeners & E> {
  private static POPUPS: PopupElement<any>[] = [] // tweb :78

  protected element = document.createElement('div') // tweb :81
  protected container = document.createElement('div') // tweb :82
  protected header = document.createElement('div') // tweb :83
  protected title = document.createElement('div') // tweb :84
  protected body?: HTMLElement // tweb :89, опционален — только при options.body
  protected buttonsEl?: HTMLElement // tweb :90
  protected btnClose?: HTMLButtonElement // tweb :86, упрощено: без btnCloseAnimatedIcon (onBackClick не портирован)
  protected btnConfirm?: HTMLButtonElement // tweb :88
  protected btnConfirmOnEnter?: HTMLButtonElement // tweb :99

  protected listenerSetter = new ListenerSetter() // tweb :96, :150
  protected buttons: PopupButton[] = [] // tweb :107

  protected destroyed = false // tweb :114
  protected shown = false // tweb :115

  // tweb :109 — раунд правок 1: без `lateMiddlewareHelper` (tweb :113), см.
  // докблок файла. Потребитель — аватар `PopupPeer` (`peer.ts:44-55`).
  protected middlewareHelper: MiddlewareHelper

  // Наш аналог `navigationItem` (tweb :94) — расщеплён на два примитива вместо
  // одного элемента общего Esc/Back-стека, см. докблок файла.
  private unregisterEsc?: () => void
  private navigationLayer?: Layer

  constructor(className: string, options: PopupOptions = {}) {
    super(false) // tweb :120

    this.middlewareHelper = getMiddleware() // tweb :148

    this.element.className = 'popup' + (className ? ' ' + className : '') // tweb :121-122
    this.container.classList.add('popup-container', 'z-depth-1') // tweb :123

    if(options.zIndex != null) { // наше расширение — см. докблок PopupOptions.zIndex выше
      this.element.style.zIndex = String(options.zIndex)
    }

    this.header.classList.add('popup-header') // tweb :134

    if(options.title) { // tweb :136-145, упрощено: title уже переведённая строка
      this.title.classList.add('popup-title')
      this.title.textContent = options.title
      this.header.append(this.title)
    }

    if(options.closable) { // tweb :155-178, без ветки onBackClick — не в PopupOptions волны 1
      this.btnClose = document.createElement('button')
      this.btnClose.className = 'btn-icon' // tweb ButtonIcon('', {noRipple: true}) → Button('btn-icon', ...)
      this.btnClose.classList.add('popup-close')
      this.btnClose.append(Icon('close'))
      this.header.prepend(this.btnClose)

      attachClickEvent(this.btnClose, () => this.hide(), { listenerSetter: this.listenerSetter })
    }

    if(options.overlayClosable) { // tweb :185-193
      attachClickEvent(this.element, (e: MouseEvent) => {
        const target = e.target as HTMLElement
        if(findUpClassName(target, 'popup-container') || !target.isConnected) {
          return
        }

        this.hide()
      }, { listenerSetter: this.listenerSetter })
    }

    if(options.withConfirm) { // tweb :195-203, упрощено: withConfirm всегда готовая строка
      this.btnConfirm = document.createElement('button')
      this.btnConfirm.classList.add('btn-primary', 'btn-color-primary')
      this.btnConfirm.append(document.createTextNode(options.withConfirm))
      this.header.append(this.btnConfirm)
    }

    this.container.append(this.header) // tweb :205

    if(options.body) { // tweb :206-210
      this.body = document.createElement('div')
      this.body.classList.add('popup-body')
      this.container.append(this.body)
    }

    this.btnConfirmOnEnter = this.btnConfirm // tweb :239 — setButtons(:307-312) может переопределить

    this.element.append(this.container) // tweb :242

    PopupElement.POPUPS.push(this) // tweb :244
  }

  protected setButtons(buttons: PopupButton[]): void {
    this.buttons = buttons // tweb :248
    if(this.buttonsEl) { // tweb :249-252
      this.buttonsEl.remove()
      this.buttonsEl = undefined
    }

    if(!buttons?.length) { // tweb :254-256
      return
    }

    const buttonsDiv = this.buttonsEl = document.createElement('div') // tweb :258
    buttonsDiv.classList.add('popup-buttons') // tweb :259

    const buttonsElements = buttons.map((b) => { // tweb :261-305
      const button = document.createElement('button')
      button.className = 'popup-button btn' + (b.isDanger ? ' danger' : ' primary') // tweb :263

      // `ripple(button)` (tweb :265-267) не портирован — ванильного
      // `components/ripple.ts` в этом репозитории ещё нет (тот же вычет уже
      // записан в `components/buttonMenu.ts` и `components/chat/replies.ts`).
      button.append(document.createTextNode(b.text)) // tweb :269-270, text всегда string

      attachClickEvent(button, () => { // tweb :282-302, упрощено: callback синхронный (см. PopupButton)
        b.callback?.()
        this.hide()
      }, { listenerSetter: this.listenerSetter })

      return button
    })

    if(!this.btnConfirmOnEnter && buttons.length === 2) { // tweb :307-312
      const index = buttons.findIndex((button) => !button.isCancel)
      if(index !== -1) {
        this.btnConfirmOnEnter = buttonsElements[index]
      }
    }

    if(buttons.length >= 3) { // tweb :314-316
      buttonsDiv.classList.add('is-vertical-layout')
    }

    buttonsDiv.append(...buttonsElements) // tweb :318
    this.container.append(buttonsDiv) // tweb :319
  }

  public show(animate = true): void {
    if(this.shown || this.destroyed) { // tweb :331-333
      return
    }

    this.shown = true // tweb :335

    this.unregisterEsc = pushEsc(() => this.hide())
    this.navigationLayer = pushLayer(() => { this.hide() })

    blurActiveElement() // tweb :356
    document.body.append(this.element) // tweb :357, appendPopupTo() упрощено до document.body
    if(animate) void this.element.offsetWidth // tweb :358, reflow перед анимацией класса
    this.element.classList.add('active') // tweb :359

    overlayCounter.isOverlayActive = true // tweb :363-364, withoutOverlay не портирован — ветка безусловна
    animationIntersector.checkAnimations2(true) // tweb :365

    // tweb :369-387 — Enter подтверждает верхний попап (если есть
    // btnConfirmOnEnter). confirmShortcutIsSendShortcut не портирован —
    // условие всегда `e.key === 'Enter'`.
    setTimeout(() => {
      if(!this.element.classList.contains('active')) {
        return
      }

      this.listenerSetter.add(document.body)('keydown', (e: KeyboardEvent) => {
        if(!this.btnConfirmOnEnter ||
          this.btnConfirmOnEnter.disabled ||
          PopupElement.POPUPS[PopupElement.POPUPS.length - 1] !== this) {
          return
        }

        if(e.key === 'Enter') {
          simulateClickEvent(this.btnConfirmOnEnter)
          cancelEvent(e)
        }
      })
    }, 0)
  }

  public hide(): void {
    if(this.destroyed) { // tweb :392-394
      return
    }

    // tweb :396-401 упрощено: без navigationItem/backByItem — isConfirmationNeededOnClose
    // не портирован, поэтому у нас `backByItem(item).onPop` всегда сводится к
    // прямому `this.destroy()`.
    this.destroy()
  }

  public forceHide(): void {
    this.destroy() // tweb :409-411, 1:1
  }

  protected destroy(): void {
    if(this.destroyed) { // tweb :414-416
      return
    }

    this.destroyed = true // tweb :418
    this.dispatchEvent<PopupListeners>('close') // tweb :419, тот же явный generic-аргумент, что и в оригинале
    this.element.classList.add('hiding') // tweb :420
    this.element.classList.remove('active') // tweb :421
    this.listenerSetter.removeAll() // tweb :422
    this.middlewareHelper.destroy() // tweb :423 — раунд правок 1, см. докблок файла

    // Наш аналог tweb :430 (`appNavigationController.removeItem`) — снимаем
    // оба раздельных механизма Esc/Back, см. докблок файла.
    this.unregisterEsc?.()
    this.unregisterEsc = undefined
    if(this.navigationLayer) {
      removeLayer(this.navigationLayer) // после Back слой уже снят — no-op (тот же паттерн, что overlayClickHandler.ts:70)
    }
    this.navigationLayer = undefined

    if(this.shown) { // tweb :426-428, withoutOverlay не портирован — условие безусловно
      overlayCounter.isOverlayActive = false
    }

    indexOfAndSplice(PopupElement.POPUPS, this) // tweb :433

    setTimeout(() => { // tweb :438-448
      this.element.remove() // tweb :439
      this.dispatchEvent<PopupListeners>('closeAfterTimeout') // tweb :440, см. коммент у dispatchEvent('close') выше
      this.cleanup() // tweb :441 (EventListenerBase.cleanup — своих middlewareHelper/scrollable у нас нет)
      if(this.shown) { // tweb :445-447
        animationIntersector.checkAnimations2(false)
      }
    }, 250) // tweb :448 — то же захардкоженное число, что в оригинале; с CSS-переменной
    // (`--popup-transition-time`, `styles/_tokens.scss:58` = .15s/150мс) НЕ связано —
    // у tweb это тоже независимый магический литерал, а не производная от CSS
  }

  public static createPopup<T, A extends any[]>(ctor: new (...args: A) => T, ...args: A): T {
    return new ctor(...args) // tweb :478-481, 1:1
  }
}
