/**
 * Порт tweb `src/components/appNavigationController.ts` — ЕДИНСТВЕННЫЙ владелец
 * истории браузера и кнопки «Назад» в приложении (ЗАДАЧА #108).
 *
 * До него у нас было ДВА независимых механизма на один вопрос «что закрыть
 * первым»: стек слоёв `core/navigation/navigationStack.ts` (Back) и Esc-стек
 * `core/hotkeys.pushEsc`. Оба хранили СВОЙ порядок и обновлялись по отдельности,
 * поэтому расходились: слой, снятый Back'ом, обязан был снять и свой
 * Esc-обработчик руками, и наоборот. В оригинале обоими вопросами ведает один
 * список `navigations`, и Esc — это буквально `back(item.type)` по верхнему
 * элементу (`onKeyDown`, :217-224).
 *
 * ── Что порт возвращает, чего у стека слоёв не было ────────────────────────
 *  • `type` у записи и адресация по нему: `findItemByType`, `removeByType`,
 *    `back(type)`. В оригинале это ручка НАРУЖУ — `sidebarRight/index.ts:95`
 *    снимает все свои записи разом (`removeByType('right')` в `hide()`);
 *  • `onEscape` — вето именно на Esc (не на Back) и `registerEscapeHandler` —
 *    глобальные вето (например, «идёт запись голосового — Esc не закрывает»);
 *  • `noHistory` — запись без своей записи истории (Esc её закрывает, Back —
 *    нет); `noBlurOnPop` — не снимать фокус при закрытии;
 *  • `unshiftItem`/`spliceItems` — вставка НЕ в вершину: у оригинала это нужно
 *    тем, кто обязан закрываться ПОСЛЕДНИМ;
 *  • ветка **Navigation API** (Chrome/Safari) — её у нас не было вовсе, и
 *    именно она у оригинала несёт сериализацию мутаций истории;
 *  • `isSwipingBackSafari` → `manual === false` → `onPop(false)`: параметр
 *    `canAnimate` наконец обрёл источник. До порта он был мёртв, потому что
 *    детектор жеста не был подключён.
 *
 * ── ОТСТУПЛЕНИЕ ОТ ОРИГИНАЛА, ОДНО, И ОНО ОСОЗНАННОЕ ───────────────────────
 * `modifyHistoryFromEvent` в оригинале сериализует мутации ТОЛЬКО в ветке
 * Navigation API (`:445-448`: `if(!USE_NAVIGATION_API) { callback?.(); return }`);
 * легаси-путь (`history.pushState`/`history.back`) идёт напрямую. У нас
 * очередь работает в ОБЕИХ ветках.
 *
 * Причина не теоретическая, она из воспроизведённого дефекта (баг-репорт
 * волны 1). `history.back()` асинхронна: браузер фиксирует ЦЕЛЬ перехода в
 * момент вызова, а сам переход и `popstate` происходят позже. Если между
 * вызовом и переходом успевает пройти ещё один `history.pushState` (типичный
 * сценарий — оверлей программно закрывается и тут же открывается следующий:
 * меню сообщения → диалог подтверждения), зафиксированная раньше цель
 * применяется к уже сдвинувшейся позиции, и модель расходится с браузером на
 * уровень. Следующее закрытие отматывает МИМО записи чата, хэш обнуляется.
 * Комментарий самого оригинала описывает ровно это («otherwise browser will
 * eat the event if you do push and back together», :319-320) — просто лечение
 * приложено там к одной ветке из двух. Мы прикладываем к обеим; механика та
 * же, отличается только область действия.
 *
 * Легаси-ветке нужен сигнал «мутация состоялась», которого у Navigation API
 * даёт событие `navigate`: `pushState`/`replaceState` синхронны и
 * подтверждаются сразу, `history.back()` — своим `popstate` (счётчик
 * `pendingBacks` + предохранитель на 500мс, см. `legacySettleForBack`).
 *
 * ── Прочие адаптации под наш стек ──────────────────────────────────────────
 *  • `bindActiveWindowListener` (`helpers/appWindow.ts` — поддержка Document
 *    PiP у оригинала) → обычный `window.addEventListener`: подсистемы PiP у нас
 *    нет, тот же вычет уже сделан в `components/chat/contextMenu.ts:909`
 *    (`getOverlayRoot()` → `document.body`);
 *  • `reload`/`close`/`focus`/`navigateToUrl` (`:481-520`) НЕ портированы —
 *    вызывающих нет ни одного: перезагрузку после логаута у нас делает
 *    `client/boot.ts` напрямую, а `window.close()`/`focus()` не зовёт никто;
 *  • класс экспортируется вместе с синглтоном (у оригинала так же): тестам
 *    нужен свой экземпляр, а приложению — один на вкладку.
 */
import { MOUNT_CLASS_TO } from '@config/debug'
import { IS_FIREFOX, IS_MOBILE_SAFARI } from '@environment/userAgent'
import { logger } from '@lib/logger'
import blurActiveElement from '@helpers/dom/blurActiveElement'
import cancelEvent from '@helpers/dom/cancelEvent'
import isSwipingBackSafari from '@helpers/dom/isSwipingBackSafari'
import tabId from '@config/tabId'

/**
 * Словарь типов записи — дословный из оригинала (`:16-21`), целиком.
 *
 * Урезать его до «тех, кого мы уже завели», было бы ошибкой той же природы,
 * что урезание словаря конструкторов схемы: это НЕ код, а язык, которым
 * подсистема адресует свои записи, и он один на приложение. Каждый новый
 * потребитель берёт готовое имя оригинала, а не придумывает своё, — иначе
 * `removeByType('right')` у одного и `removeByType('sidebar-right')` у другого
 * разъедутся молча.
 */
export type NavigationItemType = 'left' | 'right' | 'im' | 'chat' | 'popup' | 'media' | 'menu' |
  'esg' | 'multiselect' | 'input-helper' | 'autocomplete-helper' | 'markup' |
  'global-search' | 'voice' | 'mobile-search' | 'filters' | 'global-search-focus' |
  'toast' | 'dropdown' | 'forum' | 'stories' | 'stories-focus' | 'topbar-search' |
  'settings-popup' | 'monoforum' | 'inline-message-input'

export type NavigationItem = {
  type: NavigationItemType
  /**
   * Закрыть. `false` — ВЕТО: запись возвращается на своё место (`handleItem`).
   * Живой потребитель вето — медиавьювер: пока летит мувер, снимать запись
   * нельзя, иначе Back в этот момент убивает её навсегда.
   *
   * `canAnimate === false` приходит ровно из одного места — жеста «назад» у
   * левой кромки в мобильном Safari (`isSwipingBackSafari` → `manual = false`):
   * система уже играет свою анимацию, наша поверх неё лишняя.
   */
  onPop: (canAnimate: boolean | undefined) => boolean | void
  /** Вето именно на Esc (Back по этой записи всё равно сработает). */
  onEscape?: () => boolean
  /** Запись без своей записи истории: Esc её закрывает, Back — нет. */
  noHistory?: boolean
  /** Не снимать фокус с активного элемента при закрытии. */
  noBlurOnPop?: boolean
  removed?: boolean
  context?: unknown
}

export const USE_NAVIGATION_API = typeof window !== 'undefined' && 'navigation' in window && !IS_FIREFOX
// tweb :25 — `TRY_TO_TRAVERSE` гейтит «съедание» своей записи истории при
// программном закрытии. У оригинала оно живёт ТОЛЬКО под Navigation API с
// пометкой «not tested for legacy api»; у нас легаси-ветка — единственная в
// Firefox, и без съедания там оставалась бы ничейная запись и холостой Back
// (это и есть пункт 3 задачи #108). Поэтому включено в обеих ветках, а
// сериализация, которой у оригинала легаси-путь не получает, добавлена выше.
const TRY_TO_TRAVERSE = true

export class AppNavigationController {
  private navigations: NavigationItem[] = []
  private id = tabId
  private manual = false
  private log = logger('NC')
  private debug = false
  /** Обязан начинаться с `#`, если не пуст. */
  private currentHash = typeof window !== 'undefined' ? window.location.hash : ''
  private overriddenHash = ''
  private isPossibleSwipe = false
  private escapeHandlers: Array<() => boolean> = []
  private ignoreNextNavigations: string[] = []
  private popping = false
  private modificationQueue: Array<() => void> = []
  private modificationBusy = false
  private modificationResolve: (() => void) | undefined
  /**
   * Сколько НАШИХ `history.back()` ждут своего `popstate` (только легаси).
   *
   * СЧЁТЧИК, а не флаг, и это не обобщение впрок: флаг гасил бы два разных
   * вопроса одним значением — «съесть ли следующий popstate» и «свободна ли
   * очередь». Отсюда дефект волны 1: если собственный `back()` подтверждался
   * дольше предохранителя, тот гасил флаг, и пришедший позже `popstate` этой же
   * операции попадал в ветку «настоящий Back пользователя» — снималась запись,
   * которую никто не просил снимать.
   */
  private pendingBacks = 0
  /** Поколение предохранителя: таймер молчит, если его операция уже не в полёте. */
  private backGen = 0
  public onHashChange: (() => void) | undefined

  constructor() {
    if(typeof window === 'undefined') {
      return
    }

    history.scrollRestoration = 'manual'

    if(USE_NAVIGATION_API) {
      navigation.addEventListener('navigate', this.onNavigate)
    } else {
      window.addEventListener('popstate', this.onPopState)
      this.pushState() // * push init state
    }

    window.addEventListener('keydown', this.onKeyDown, { capture: true, passive: false })

    if(IS_MOBILE_SAFARI) {
      window.addEventListener('touchstart', this.onTouchStart, { passive: true })
    }
  }

  // ── Ветка Navigation API (tweb :86-165) ───────────────────────────────────

  private onNavigate = (event: NavigateEvent) => {
    this.modificationResolve?.()
    const log = this.log.bindPrefix('navigate')

    const fixHashIfNeeded = () => {
      const destinationHash = new URL(event.destination.url).hash
      if(
        event.navigationType === 'traverse' &&
        destinationHash !== this.currentHash
      ) {
        this.modifyHistoryFromEvent(() => { // * fix hash
          this.replaceState()
        })
      }
    }

    if(event.destination.index > navigation.currentEntry!.index) {
      log('ignoring forward navigation')
      cancelEvent(event)
      event.intercept()
      fixHashIfNeeded()
      return
    }

    if(event.navigationType === this.ignoreNextNavigations[0]) {
      this.ignoreNextNavigations.shift()
      fixHashIfNeeded()
      return
    }

    if(
      (
        event.navigationType === 'push' ||
        (event.navigationType === 'replace' && !event.destination.sameDocument)
      ) &&
      event.destination.getState() === this.id
    ) {
      event.intercept({
        handler: () => {},
        focusReset: 'manual', // * prevent losing focus
        scroll: 'manual',
      })
      return
    }

    if(
      event.navigationType === 'reload' ||
      event.navigationType === 'replace' ||
      !event.destination.sameDocument
    ) {
      return
    }

    const url = new URL(event.destination.url)

    if(event.navigationType === 'push') {
      this.overrideHash(url.hash)
      this.onHashChange?.()
      return
    }

    let hash = url.hash
    // * don't set old hash if we're going back
    if(event.destination.index < navigation.currentEntry!.index) {
      hash = this.currentHash
      fixHashIfNeeded()
    }
    this._onPopState(hash, 0)
  }

  // ── Легаси-ветка (tweb :167-215) ──────────────────────────────────────────

  private onPopState = (e: PopStateEvent) => {
    // Подтверждение НАШЕГО же `history.back()`: снимаем токен, распускаем
    // очередь и выходим — записи это событие не касается (см. докблок файла,
    // «отступление»). У оригинала ветки нет вовсе: там очередь обслуживает
    // только Navigation API, а её подтверждение — событие `navigate`.
    if(this.pendingBacks > 0) {
      this.pendingBacks--
      this.modificationSettled()
      return
    }

    this._onPopState(window.location.hash, e.state as number)
  }

  private _onPopState(hash: string, id: number) {
    this.debug && this.log('popstate', this.isPossibleSwipe, hash, id)
    if(hash !== this.currentHash) {
      // fix for returning to wrong hash (e.g. chat -> archive -> chat -> 3x back)
      if((USE_NAVIGATION_API || id === this.id) && this.overriddenHash && this.overriddenHash !== hash) {
        this.overrideHash(this.overriddenHash, true)
      } else if(id && !this.overriddenHash && hash) {
        this.overrideHash(undefined, true)
      } else {
        this.currentHash = hash
        this.onHashChange?.()
        return
      }
    }

    if(!USE_NAVIGATION_API && id !== this.id) {
      this.pushState()

      if(!this.navigations.length) {
        return
      }
    }

    const item = this.navigations.pop()
    if(!item) {
      this.pushState()
      return
    }

    this.manual = !this.isPossibleSwipe
    this.popping = true
    this.handleItem(item, this.navigations.length)
    this.popping = false
  }

  private onKeyDown = (e: KeyboardEvent) => {
    const item = this.navigations[this.navigations.length - 1]
    if(!item) return
    if(e.key === 'Escape' && this.canCloseOnEscape() && (item.onEscape ? item.onEscape() : true)) {
      cancelEvent(e)
      this.back(item.type)
    }
  }

  private onTouchStart = (e: TouchEvent) => {
    if(e.touches.length > 1) return

    if(isSwipingBackSafari(e)) {
      this.isPossibleSwipe = true

      window.addEventListener('touchend', () => {
        setTimeout(() => {
          this.isPossibleSwipe = false
        }, 100)
      }, { passive: true, once: true })
    }
  }

  // ── Хэш ───────────────────────────────────────────────────────────────────

  public overrideHash(hash = '', forceReplace?: boolean) {
    if(hash && hash[0] !== '#') hash = '#' + hash
    else if(hash === '#') hash = ''

    if(this.currentHash === hash && !forceReplace) {
      return
    }

    this.overriddenHash = this.currentHash = hash
    this.modifyHistoryFromEvent(() => {
      this.replaceState()
    })
  }

  // ── Записи ────────────────────────────────────────────────────────────────

  private handleItem(item: NavigationItem, wasIndex = this.navigations.indexOf(item)) {
    const good = item.onPop(!this.manual ? false : undefined)
    this.debug && this.log('popstate, navigation:', item, this.navigations)
    if(good === false) { // insert item on the same place, because .push can have different index if new item has appeared
      this.spliceItems(Math.min(this.navigations.length, wasIndex), 0, item)
    } else if(!item.noBlurOnPop) {
      blurActiveElement() // no better place for it
    }

    if(good !== false) {
      this.onItemDeleted(item)
    }

    this.manual = false
  }

  private onItemDeleted(item: NavigationItem) {
    if(item.removed) {
      return
    }

    if(TRY_TO_TRAVERSE && !item.noHistory && !this.popping) {
      // * have to have this timeout,
      // * otherwise browser will eat the event if you do push and back together
      this.modifyHistoryFromEvent(() => {
        this.ignoreNextNavigations.unshift('traverse')
        if(USE_NAVIGATION_API) {
          navigation.back()
        } else {
          this.legacySettleForBack()
          history.back()
        }
      })
    }

    item.removed = true
  }

  private onItemAdded(item: NavigationItem) {
    this.debug && this.log('onItemAdded', item, this.navigations)

    delete item.removed

    if(!item.noHistory) {
      this.modifyHistoryFromEvent(() => {
        this.pushState()
      })
    }
  }

  public findItemByType(type: NavigationItemType) {
    for(let i = this.navigations.length - 1; i >= 0; --i) {
      const item = this.navigations[i]
      if(item.type === type) {
        return { item, index: i }
      }
    }
  }

  public back(type?: NavigationItemType) {
    if(type) {
      const ret = this.findItemByType(type)
      if(ret) {
        this.backByItem(ret.item, ret.index)
        return
      }
    }

    history.back()
  }

  public backByItem(item: NavigationItem, index = this.navigations.indexOf(item)) {
    if(index === -1) {
      return
    }

    this.manual = true
    this.spliceItems(index, 1)
    this.handleItem(item, index)
  }

  public pushItem(item: NavigationItem) {
    this.navigations.push(item)
    this.onItemAdded(item)
    return item
  }

  public unshiftItem(item: NavigationItem) {
    this.navigations.unshift(item)
    this.onItemAdded(item)
    return item
  }

  public spliceItems(index: number, length: number, ...items: NavigationItem[]) {
    const deleted = this.navigations.splice(index, length, ...items)
    deleted.forEach((item) => {
      this.onItemDeleted(item)
    })
    items.forEach((item) => {
      this.onItemAdded(item)
    })
  }

  public removeItem(item: NavigationItem) {
    const index = this.navigations.indexOf(item)
    if(index === -1) {
      return
    }

    this.spliceItems(index, 1)
  }

  public removeByType(type: NavigationItemType, single = false) {
    for(let i = this.navigations.length - 1; i >= 0; --i) {
      const item = this.navigations[i]
      if(item.type === type) {
        this.spliceItems(i, 1)

        if(single) {
          break
        }
      }
    }
  }

  public getNextIndex() {
    return this.navigations.length
  }

  public findItem(predicate: (item: NavigationItem) => boolean) {
    const index = this.navigations.findIndex(predicate)
    return index === -1 ? undefined : { index, item: this.navigations[index] }
  }

  // ── История ───────────────────────────────────────────────────────────────

  public pushState() {
    this.manual = false

    if(USE_NAVIGATION_API) {
      navigation.navigate(location.href, { state: this.id, history: 'push' })
    } else {
      history.pushState(this.id, '')
    }
  }

  /**
   * ОСТАТОК #108, а не метод оригинала. У tweb смена чата не создаёт записи
   * истории вовсе — хэш переписывается на месте (`overrideHash` →
   * `replaceState`), а Back закрывает чат отдельной записью типа `im`. У нас
   * каждый открытый чат — своя запись (Phase A роутинга, `useUrlSync`), и
   * пока это так, её `pushState` обязан идти через ТУ ЖЕ очередь мутаций, что
   * записи навигации: иначе он обгонит ещё не подтверждённый `history.back()`
   * закрывающегося оверлея (воспроизведённый дефект волны 1).
   *
   * Метод уйдёт вместе с переводом навигации чата на `overrideHash`.
   */
  public pushHashState(url: string) {
    this.modifyHistoryFromEvent(() => {
      history.pushState(null, '', url)
    })
  }

  public replaceState(url?: URL) {
    if(!url) {
      url = new URL(location.href)
      url.hash = this.overriddenHash
    }

    if(USE_NAVIGATION_API) {
      navigation.navigate(url, { state: this.id, history: 'replace' })
    } else {
      history.replaceState(this.id, '', url)
    }
  }

  // ── Esc ───────────────────────────────────────────────────────────────────

  private canCloseOnEscape() {
    return this.escapeHandlers.every((fn) => fn())
  }

  /** Глобальное вето на Esc: пока хоть один обработчик вернул `false`, Esc не закрывает ничего. */
  public registerEscapeHandler(handler: () => boolean) {
    this.escapeHandlers.push(handler)

    return () => {
      this.escapeHandlers = this.escapeHandlers.filter((fn) => fn !== handler)
    }
  }

  // ── Очередь мутаций истории ───────────────────────────────────────────────

  /**
   * Подтверждение текущей мутации: снимает «занято» и берёт следующую.
   * У Navigation API его даёт событие `navigate` (`modificationResolve`), у
   * легаси — `pushState`/`replaceState` синхронно, а `history.back()` — своим
   * `popstate`.
   */
  private modificationSettled = () => {
    this.modificationResolve = undefined
    this.modificationBusy = false
    if(this.modificationQueue.length) {
      this.modifyHistoryFromEvent()
    }
  }

  /**
   * Взвести ожидание подтверждения для легаси-`history.back()`.
   *
   * Предохранитель распускает ТОЛЬКО очередь и не трогает `pendingBacks`:
   * поздний `popstate` по-прежнему находит свой токен и съедается. Проверка
   * поколения обязана идти ПЕРВОЙ — `modificationBusy` общий на все операции, и
   * к моменту срабатывания таймера может принадлежать уже следующей.
   */
  private legacySettleForBack() {
    this.pendingBacks++
    const gen = ++this.backGen
    setTimeout(() => {
      if(this.backGen !== gen) return
      if(!this.modificationBusy) return
      this.modificationSettled()
    }, 500)
  }

  private modifyHistoryFromEvent(callback?: () => void) {
    if(callback) {
      this.modificationQueue.push(callback)
    }

    if(this.modificationBusy) return
    this.modificationBusy = true
    setTimeout(() => {
      const callback = this.modificationQueue.shift()
      if(!callback) {
        this.modificationBusy = false
        return
      }

      this.modificationResolve = this.modificationSettled
      const backsBefore = this.pendingBacks
      callback()
      // Легаси-ветка: `pushState`/`replaceState` синхронны — подтверждать
      // нечего и ждать нечего. `history.back()` взвёл токен внутри колбэка
      // (`legacySettleForBack`), и подтверждением служит его `popstate`.
      if(!USE_NAVIGATION_API && this.pendingBacks === backsBefore) {
        this.modificationSettled()
      }
    }, 0)
  }
}

const appNavigationController = new AppNavigationController()
MOUNT_CLASS_TO.appNavigationController = appNavigationController
export default appNavigationController
