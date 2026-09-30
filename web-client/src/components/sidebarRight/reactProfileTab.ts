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
 * Расхождения с `AppSharedMediaTab`:
 *  1. нет `setPeer`/`fillProfileElements`/`loadSidebarMedia` — пир и данные
 *     панель берёт из пропов React (`Chat.tsx`), задача 3-1;
 *  2. `onOpenAfterTimeout` зовёт `onScroll()` скроллера ПАНЕЛИ
 *     (`reactScrollable`, его отдаёт `UserInfoPanel`), а не своего
 *     `this.scrollable` — свой здесь не в DOM.
 */
import SliderSuperTab from '@components/sliderTab'
import type Scrollable from '@components/scrollable'

export default class AppReactProfileTab extends SliderSuperTab {
  /** Скроллер React-панели (`useSearchSuper`) — пишет и снимает `UserInfoPanel`. */
  public reactScrollable?: Scrollable

  public _constructor(...args: Parameters<SliderSuperTab['_constructor']>) {
    super._constructor(...args)
    this.container.replaceChildren()
  }

  // tweb sharedMediaTab.tsx:105-109
  protected onOpenAfterTimeout() {
    super.onOpenAfterTimeout()

    this.reactScrollable?.onScroll()
  }

  // tweb sharedMediaTab.tsx:121-124
  public destroy() {
    this.destroyable = true
    this.onCloseAfterTimeout()
  }
}
