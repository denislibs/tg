/**
 * ВРЕМЕННО до 3-1 — вкладка №0 правой колонки под React-панель профиля.
 *
 * Роль tweb `AppSharedMediaTab` (`sidebarRight/tabs/sharedMediaTab.tsx:26-135`):
 * вкладка на инстанс чата, которую `AppSidebarRight.createSharedMediaTab`
 * создаёт ВНЕ DOM, а `replaceSharedMediaTab` ставит в слайдер, когда инстанс
 * становится активным. Содержимое у оригинала рисует Solid `sharedMedia.tsx`
 * в `tab.scrollable`; у нас до задачи 3-1 — React `UserInfoPanel`, который
 * порталит в `container` СВОЮ шапку и СВОЙ скроллер (`useSearchSuper`).
 * Поэтому шапка и `.sidebar-content` базового `_constructor` из контейнера
 * убраны: второй шапки и второго скроллера во вкладке быть не должно.
 * Классы `shared-media-container`/`profile-container` на `container` ставит
 * сама панель — как у tweb `sharedMedia.tsx:193`, `:399`.
 *
 * Панель — React-остров (`reactProfileTabView.tsx`, ВРЕМЕННО до К-5): вкладка
 * монтирует его сама на первом `setPeer`, как `AppSharedMediaTab` рендерит
 * `sharedMedia.tsx` (`sharedMediaTab.tsx:68-83`). Корень острова — узел вне DOM:
 * панель порталит себя в `container`, второго хоста во вкладке быть не должно.
 * Модуль острова грузится динамическим импортом — панель тяжёлая и тянет
 * `appImManager`, который сам импортирует эту вкладку через `appSidebarRight`.
 *
 * Расхождения с `AppSharedMediaTab`:
 *  1. `fillProfileElements`/`loadSidebarMedia` пустые — данные панель грузит
 *     сама по пиру из пропов, задача 3-1;
 *  2. `onOpenAfterTimeout` зовёт `onScroll()` скроллера ПАНЕЛИ
 *     (`reactScrollable`, его отдаёт `UserInfoPanel`), а не своего
 *     `this.scrollable` — свой здесь не в DOM.
 */
import SliderSuperTab from '@components/sliderTab'
import type Scrollable from '@components/scrollable'
import { mountReact, type ReactIsland } from '@shared/react/mountReact'
import type { ReactProfileTabViewProps } from './reactProfileTabView'

export default class AppReactProfileTab extends SliderSuperTab {
  /** Скроллер React-панели (`useSearchSuper`) — пишет и снимает `UserInfoPanel`. */
  public reactScrollable?: Scrollable
  public peerId?: PeerId
  public threadId?: number

  private island?: ReactIsland<ReactProfileTabViewProps>
  private islandPromise?: Promise<void>
  private destroyed = false

  public _constructor(...args: Parameters<SliderSuperTab['_constructor']>) {
    super._constructor(...args)
    this.container.replaceChildren()
  }

  // tweb sharedMediaTab.tsx:105-109
  protected onOpenAfterTimeout() {
    super.onOpenAfterTimeout()

    this.reactScrollable?.onScroll()
  }

  // tweb sharedMediaTab.tsx:68-83
  public setPeer(peerId: PeerId, threadId?: number) {
    if(this.peerId === peerId && this.threadId === threadId) return false

    this.peerId = peerId
    this.threadId = threadId
    if(this.island) {
      this.island.update({ peerId, threadId })
    } else {
      this.islandPromise ??= this.renderIsland()
    }

    return true
  }

  // tweb sharedMediaTab.tsx:85-88 — расхождение 1 шапки
  public fillProfileElements() {
    return this.islandPromise ?? Promise.resolve()
  }

  // tweb sharedMediaTab.tsx:90-93 — расхождение 1 шапки
  public loadSidebarMedia(_single: boolean, _justLoad?: boolean) {}

  private async renderIsland() {
    const { default: ReactProfileTabView } = await import('./reactProfileTabView')
    // `managers` вкладке ставит слайдер (`slider.ts:358`, расхождение ВАЖНО-4 `sliderTab.ts`)
    const managers = this.managers
    if(this.destroyed || this.peerId === undefined || !managers) return

    this.island = mountReact<ReactProfileTabViewProps>(document.createElement('div'), ReactProfileTabView, {
      tab: this,
      peerId: this.peerId,
      threadId: this.threadId,
    }, managers)
  }

  // tweb sharedMediaTab.tsx:121-124
  public destroy() {
    this.destroyable = true
    this.destroyed = true
    this.island?.unmount()
    this.island = undefined
    this.onCloseAfterTimeout()
  }
}
