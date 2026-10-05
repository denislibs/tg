/**
 * Порт tweb `src/components/sidebarRight/tabs/sharedMediaTab.tsx` (812502980) —
 * `AppSharedMediaTab`, вкладка общих медиа правой колонки: профиль пира
 * (`PeerProfile`) и `AppSearchSuper` в одной прокрутке. Вкладка живёт у
 * инстанса чата (`chat.ts:1003-1008`, `:1178-1185`, `:1218-1242`): её создаёт
 * `appSidebarRight.createSharedMediaTab()`, пир даёт `setPeer(peerId, threadId)`,
 * в колонку её ставит `replaceSharedMediaTab`.
 *
 * Класс держит публичный API и состояние, а UI строит Solid-компонент
 * `sharedMedia.solid.tsx` (динамический импорт), который вешает на вкладку
 * `_impl` — ровно как у оригинала.
 *
 * Расхождения:
 *  1. Корень рисуется нашим `mountSolid` (`render` + `ErrorBoundary`), а не
 *     `render` под `SolidJSHotReloadGuardProvider`: HMR-стража у нас нет,
 *     зависимости компонент импортирует сам.
 *  2. Solid-корень гасится только на `destroy()` (у оригинала — на любом
 *     `onCloseAfterTimeout`, то есть и на закрытии колонки): корень у нас
 *     владеет вычислениями `AppSearchSuper` (`Tabs.MenuGradient`) и
 *     подписками шапки, а вкладка после закрытия колонки открывается снова
 *     той же (`toggleSidebar` → `sharedMediaTab.open()`).
 *  3. Статический `open(slider, peerId, noProfile)` (профиль в левой колонке —
 *     «Сохранённые диалоги», инфо темы форума) не портирован: вызывающих нет,
 *     бэклог Б-54.
 */
import { createComponent } from 'solid-js'
import SliderSuperTab from '@components/sliderTab'
import type AppSearchSuper from '@components/appSearchSuper'
import type { SearchSuperMediaType } from '@components/appSearchSuper'
import { mountSolid } from '@shared/solid/mountSolid.solid'
import { PromiseCollector } from '@components/solidJsTabs/promiseCollector.solid'
import { SuperTabProvider } from '@components/solidJsTabs/superTabProvider.solid'
import rootScope from '@lib/rootScope'

export type SharedMediaImpl = {
  setQuery: () => void
  fillProfileElements: () => Promise<(() => void) | undefined>
  loadSidebarMedia: (single: boolean, justLoad?: boolean) => Promise<unknown>
  setSearchTab: (type: SearchSuperMediaType) => void
  setLoadMutex: (promise: Promise<unknown>) => void
}

export default class AppSharedMediaTab extends SliderSuperTab {
  public peerId!: PeerId
  public threadId?: number
  public isFirst?: boolean
  public noProfile?: boolean
  public peerChanged?: boolean
  public searchSuper!: AppSearchSuper

  public _impl?: SharedMediaImpl
  private _renderPromise?: Promise<void>
  private _dispose?: () => void

  private _render() {
    if(this._renderPromise) return this._renderPromise

    const div = document.createElement('div')

    return this._renderPromise = (async() => {
      const { default: Component } = await import('./sharedMedia.solid')

      const promiseCollectorHelper = PromiseCollector.createHelper()

      // tweb :44-52 — `PromiseCollector` > `SuperTabProvider` > компонент
      this._dispose = mountSolid(div, (props) => createComponent(PromiseCollector, {
        onCollect: props.onCollect,
        get children() {
          return createComponent(SuperTabProvider, {
            get self() {
              return props.self
            },
            get children() {
              return createComponent(props.Content, {})
            },
          })
        },
      }), { self: this, onCollect: promiseCollectorHelper.onCollect, Content: Component }).dispose

      this.scrollable.append(div)

      await promiseCollectorHelper.await()
    })()
  }

  public init() {
    return this._render()
  }

  public setPeer(peerId: PeerId, threadId?: number) {
    if(this.peerId === peerId && this.threadId === threadId) return false

    this.peerId = peerId
    this.threadId = threadId
    this.noProfile ??= peerId === rootScope.myId
    this.peerChanged = true

    if(this._impl) {
      this._impl.setQuery()
    } else {
      void this._render().then(() => this._impl!.setQuery())
    }

    return true
  }

  public fillProfileElements() {
    if(this._impl) return this._impl.fillProfileElements()
    return this._render().then(() => this._impl!.fillProfileElements())
  }

  public loadSidebarMedia(single: boolean, justLoad?: boolean) {
    if(this._impl) return this._impl.loadSidebarMedia(single, justLoad)
    return this._render().then(() => this._impl!.loadSidebarMedia(single, justLoad))
  }

  public setSearchTab(type: SearchSuperMediaType) {
    if(this._impl) return this._impl.setSearchTab(type)
    void this._render().then(() => this._impl!.setSearchTab(type))
  }

  public setLoadMutex(promise: Promise<unknown>) {
    if(this._impl) return this._impl.setLoadMutex(promise)
    void this._render().then(() => this._impl!.setLoadMutex(promise))
  }

  protected onOpenAfterTimeout() {
    super.onOpenAfterTimeout()

    this.scrollable.onScroll()
  }

  protected onCloseAfterTimeout() {
    super.onCloseAfterTimeout()

    if(this.destroyable) {
      this.searchSuper?.destroy()
      // расхождение 2
      this._dispose?.()
      this._dispose = undefined
    }
  }

  public destroy() {
    this.destroyable = true
    this.onCloseAfterTimeout()
  }
}
