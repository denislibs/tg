// Порт tweb `src/components/forumTab/forumTab.ts` (812502980, 177 строк) — база
// форум-таба: список тем пира поверх списка чатов. Плавающий (`is-floating`,
// без слайдера — его держит `.topics-slider` владельца списка,
// `appDialogsManager.toggleForumTabByPeerId`) или вкладкой колонки, когда в ней
// уже открыта вкладка. Задача 1-6 волны 7.
//
// Расхождения с оригиналом:
//  1. `dialog_drop` пира (`:63-69`) — пропажа диалога форума из зеркала
//     `chatsStore` (событий диалогов на главном потоке нет, В7-5).
//  2. `getRectFromForPlaceholder` (`:136-158`) — прямоугольник канваса наш
//     `DialogsPlaceholder` берёт сам (расхождение 4 `autonomousDialogList/base.ts`).
//  3. Выделения тем (`selection`, `DialogsSelectionBase`) нет — О-30.
//  4. `triggerAsyncInit` — поле-функция, а не метод: оригинал гасит его
//     присваиванием `undefined`, строгий TS не даёт присвоить его методу.
import IS_TOUCH_SUPPORTED from '@environment/touchSupport'
import { attachClickEvent } from '@helpers/dom/clickEvent'
import handleTabSwipe from '@helpers/dom/handleTabSwipe'
import liteMode from '@helpers/liteMode'
import pause from '@helpers/schedulers/pause'
import appDialogsManager from '@lib/appDialogsManager'
import type { Managers } from '@/client/bootstrap'
import { logger } from '@lib/logger'
import type { AutonomousDialogListBase, ListDialog } from '@components/autonomousDialogList/base'
import ButtonIcon from '@components/buttonIcon'
import Icon from '@components/icon'
import appSidebarLeft from '@components/sidebarLeft'
import { setTransition } from '@core/dom/setTransition'
import { SliderSuperTabEventable } from '@components/sliderTab'
import { Register } from '@components/forumTab/register'
import { useChatsStore } from '@stores/chatsStore'

export class ForumTab extends SliderSuperTabEventable {
  public static register: Register<PeerId, typeof ForumTab> = new Register()

  public rows!: HTMLElement
  public subtitle!: HTMLElement
  public headerAvatar: HTMLElement | undefined

  public peerId!: PeerId
  private firstTime: boolean | undefined

  protected log!: ReturnType<typeof logger>

  public xd?: AutonomousDialogListBase<ListDialog>

  /** tweb `:41-56` */
  public async toggle(value: boolean) {
    if(this.triggerAsyncInit) {
      await this.triggerAsyncInit()
    }

    setTransition({
      element: this.container,
      className: 'is-visible',
      forwards: value,
      duration: 300,
      onTransitionEnd: !value ? () => {
        this.onCloseAfterTimeout()
      } : undefined,
      useRafs: this.firstTime ? (this.firstTime = undefined, 2) : undefined,
    })
  }

  /** tweb `:58-64` */
  protected _close = () => {
    if(!this.slider) {
      void appDialogsManager.toggleForumTab(undefined, this)
    } else {
      void this.close()
    }
  }

  /** tweb `:66-72` (расхождение 1) */
  protected syncInit(): void {
    const unsubscribe = useChatsStore.subscribe((state, prev) => {
      if(state.dialogs === prev.dialogs) return
      const had = prev.dialogs.some((dialog) => dialog.peerId === this.peerId)
      if(had && !state.dialogs.some((dialog) => dialog.peerId === this.peerId)) {
        this._close()
      }
    })
    this.middlewareHelper.get().onDestroy(unsubscribe)
  }

  /** tweb `:74-76` */
  protected async asyncInit(): Promise<void> {
    this.xd?.onChatsScroll()
  }

  /** tweb `:78-82` */
  protected async onSearchClick() {
    appSidebarLeft.closeEverythingInside()
    if(liteMode.isAvailable('animations')) await pause(400)
    appSidebarLeft.initSearch().openWithPeerId(this.peerId)
  }

  /** tweb `:84-127` */
  public init(options: {
    peerId: PeerId,
    managers: Managers,
  }) {
    this.peerId = options.peerId
    this.managers = options.managers

    this.log = logger('FORUM')
    this.firstTime = true
    this.container.classList.add('topics-container')

    const isFloating = !this.slider
    if(isFloating) {
      this.closeBtn.replaceChildren(Icon('close'))
      this.container.classList.add('active', 'is-floating')

      attachClickEvent(this.closeBtn, this._close, { listenerSetter: this.listenerSetter })
    }

    this.rows = document.createElement('div')
    this.rows.classList.add('sidebar-header__rows')

    this.subtitle = document.createElement('div')
    this.subtitle.classList.add('sidebar-header__subtitle')

    this.title.replaceWith(this.rows)
    this.rows.append(this.title, this.subtitle)

    if(IS_TOUCH_SUPPORTED) {
      handleTabSwipe({
        element: this.container,
        onSwipe: this._close,
        middleware: this.middlewareHelper.get(),
      })
    }

    const searchButton = ButtonIcon('search')
    attachClickEvent(searchButton, () => void this.onSearchClick())

    this.header.append(searchButton)

    this.syncInit()

    // `xd.getRectFromForPlaceholder` (`:120-122`) — расхождение 2

    if(!isFloating) {
      return this.triggerAsyncInit!()
    }
  }

  /** tweb `:129-135` — место аватара перед строками шапки */
  protected createHeaderAvatar() {
    const avatar = document.createElement('div')
    avatar.classList.add('sidebar-header__avatar')
    this.rows.before(avatar)
    return this.headerAvatar = avatar
  }

  /** tweb `:160-164` (расхождение 4) */
  public triggerAsyncInit?: () => Promise<void> = () => {
    this.triggerAsyncInit = undefined

    return this.asyncInit()
  }

  /** tweb `:166-171` (расхождение 3) */
  public onCloseAfterTimeout() {
    super.onCloseAfterTimeout()
    this.xd?.destroy()
  }
}
