// Message-вариант медиавьювера — порт tweb `src/components/mediaViewer/index.ts`
// (класс AppMediaViewer) в объёме Task 14: topButtons ['delete','forward'],
// навигация листания через listLoader, подпись RichText-островом, мобильное
// ⋮-меню, клик по автору → close→jumpToMessage, скачивание.
//
// Адаптации (каждая помечена и на месте):
//   • модель данных: вместо MyMessage+managers (getMediaFromMessage, RPC
//     appMessagesManager) — готовый `ViewerItem` (лайтбокс-модель useLightbox:
//     медиа/автор/подпись собирает вызывающий из окна сообщений);
//   • действия над сообщением — инжектируемые колбэки opts (onForward/onDelete/
//     jumpToMessage): наши флоу пересылки/удаления — React-попапы чата
//     (проводка — Chat.tsx, Task 16), PopupDeleteMessages/showForwardPopup tweb (:23-24)
//     не портируются. Кнопка без колбэка получает класс hide — как tweb прячет
//     по canForward/canDelete (setMessageActionVisibility :396-418);
//     permissionsPromise (:457-498) не портирован — прав-модели MTProto нет;
//   • SearchListLoader (MTProto-поиск по инпут-фильтрам) не портирован — наш
//     ListLoader (Task 3) + колбэк opts.loadMoreMedia (REST `/chats/{id}/media`,
//     проводка — Chat.tsx, Task 16); без колбэка пустой ответ ⇒ loadedAll — вьювер листает
//     только переданные items, как жил старый лайтбокс);
//   • onMediaCaptionClick (index.ts:47-73, t.me-редиректы/спойлеры/цитаты в
//     подписи) не портирован: подпись — React `RichText`, ссылки в нём обычные
//     безопасные <a> (allow-list схем), маскед-алертов не существует;
//   • setCaption: вместо wrapRichText/TranslatableMessage — RichText-остров
//     через renderCaptionIsland (ядро vanilla, React только createRoot);
//     saveTimestamps/videoTimestamps (:358-388) — материал плеера, Task 15;
//   • спонсорские сообщения (:305-341), deleteAsChatPhoto (:224-242),
//     видео-аватары (:500-511), isMediaCompatibleForDocumentViewer (:522-524) —
//     фич/вариантов нет в Task 14 (аватар-вариант — вне периметра стадии);
//   • onEmptied (:104-106, SearchListLoader «текущий элемент удалён») — у
//     нашего ListLoader события нет; удаление закрывает вьювер колбэком
//     closeFromMedia (onDeleteClick ниже).
import { createElement } from 'react'
import cancelEvent from '@helpers/dom/cancelEvent'
import { attachClickEvent } from '@helpers/dom/clickEvent'
import findUpClassName from '@helpers/dom/findUpClassName'
import { positionMenuTrigger } from '@helpers/positionMenu'
import { doubleRaf } from '@helpers/schedulers'
import type { IconName } from '@core/tgico-icons'
import type { MessageEntity } from '@core/models'
import { startClient } from '@/client/bootstrap'
import { useI18nStore } from '../../i18n'
import RichText from '../RichText'
import AppMediaViewerBase, { btnIcon, iconSpan, type ViewerAuthor, type ViewerMedia } from './base'
import ListLoader from './listLoader'

// Наш аналог сообщения для вьювера (модель старого useLightbox + mid):
// вызывающий (collectLightboxItems, Task 16) собирает его из окна сообщений / ответа `/media`.
export type ViewerItem = {
  /** миниатюра-источник в DOM; у соседей вне отрендеренного окна — null
   * (tweb processItem кладёт `element: null as HTMLElement`, index.ts:100) */
  element: HTMLElement | null
  mid: number
  /** per-chat seq сообщения — цель jumpToMessage (наша навигация ленты ходит
   * по seq, а не по id); у не-сообщений (фото профиля) отсутствует */
  seq?: number
  media: ViewerMedia
  author: ViewerAuthor
  caption?: string
  captionEntities?: MessageEntity[]
}

// Порт tweb AppMediaViewerTargetType (:39-45): element+mid; вместо
// peerId/message — сам ViewerItem (наш «message» уже собран).
export type ViewerTarget = {
  element: HTMLElement
  mid: number
  item: ViewerItem
}

export type AppMediaViewerOptions = {
  /** флоу пересылки (React-попап чата, Task 16); tweb: showForwardPopup(...,
   * () => this.close()) — закрытие по выбору получателя через close */
  onForward?: (mid: number, close: () => Promise<void> | null) => void
  /** флоу удаления с подтверждением (React-попап, Task 16); по подтверждению
   * звать closeFromMedia — close перецелится в отцентрованное медиа (tweb :249-252) */
  onDelete?: (mid: number, closeFromMedia: () => void) => void
  /** переход к сообщению из клика по автору (tweb appImManager.setInnerPeer);
   * получает весь item — вызывающему нужен seq (jump ленты ходит по seq) */
  jumpToMessage?: (item: ViewerItem) => void
  /** дозапрос истории медиа (REST `/chats/{id}/media`, Task 16); без колбэка —
   * loadedAll: листаются только переданные items */
  loadMoreMedia?: (older: boolean, anchor: ViewerItem | undefined, loadCount: number) => Promise<ViewerItem[]>
}

export default class AppMediaViewer extends AppMediaViewerBase<'caption', 'delete' | 'forward', ViewerTarget> {
  protected btnMenuToggle!: HTMLButtonElement
  protected btnMenu!: HTMLElement
  protected btnMenuForward!: HTMLElement
  protected btnMenuDownload!: HTMLElement
  protected btnMenuDelete!: HTMLElement
  /** снять ⋮-меню (immediate — вместе с DOM-узлом сразу): body-смонтированное
   * меню не уходит вместе с wholeDiv, закрытие/деструкция зовут его явно */
  protected closeBtnMenu?: (immediate?: boolean) => void

  constructor(protected opts: AppMediaViewerOptions = {}) {
    super(new ListLoader<ViewerTarget, ViewerTarget>({
      // Порт tweb SearchListLoader-источника на наш колбэк: пустой ответ короче
      // loadCount ⇒ setLoaded(older, true) — дальше края не грузим. Маппинг
      // элемент → цель (tweb processItem, index.ts:89-101) — прямо здесь:
      // сигнатура base фиксирует P = TargetType.
      loadMore: async (anchor, older, loadCount) => {
        if (!opts.loadMoreMedia) return { count: 0, items: [] }
        const items = await opts.loadMoreMedia(older, anchor?.item, loadCount)
        return { count: items.length, items: items.map(AppMediaViewer.toTarget) }
      },
    }), ['delete', 'forward'])

    attachClickEvent(this.buttons.delete, this.onDeleteClick) // tweb index.ts:145

    this.setBtnMenuToggle() // tweb index.ts:147-162 + base :970-973

    // Адаптация tweb permissionsPromise/setMessageActionVisibility: право на
    // действие статично — задан ли колбэк (см. шапку файла).
    this.setMessageActionVisibility({
      cantForward: !opts.onForward,
      cantDownload: false,
      cantDelete: !opts.onDelete,
    })

    // Порт tweb onAuthorClick (index.ts:268-290): закрыть и перейти к сообщению.
    // Гейт closing/authorInfo — уже в base (setListeners); ветка мобильного
    // shared-media-таба (:276-281) не портирована — таба нет. catch: close()
    // во время полёта открытия отдаёт rejected (base :1039-1045).
    this.onAuthorClick = () => {
      const item = this.target?.item
      if (!item?.mid || !this.opts.jumpToMessage) return
      void this.close()?.then(() => this.opts.jumpToMessage!(item)).catch(() => {})
    }

    // * constructing html end

    this.setListeners() // tweb index.ts:166
  }

  // стрелочное свойство: передаётся в map по ссылке (oxlint unbound-method)
  protected static toTarget = (item: ViewerItem): ViewerTarget =>
    ({ element: item.element as HTMLElement, mid: item.mid, item })

  // Body-смонтированное ⋮-меню — не потомок wholeDiv: close()/destroy() базы
  // его не снимут. В tweb открытый btn-menu закрывает contextMenuController
  // (Esc/клик по оверлею); контроллера у нас нет — закрываем сами.
  public override close(e?: MouseEvent) {
    this.closeBtnMenu?.()
    return super.close(e)
  }

  public override destroy() {
    this.closeBtnMenu?.(true)
    super.destroy()
  }

  // Порт tweb index.ts:169-186 поверх base.setListeners; download — из
  // base.setListeners tweb (:448-451, без гейта hasQualityOptions — HLS-меню
  // Task 15), onJump — из base tweb (:485-489): поля подкласса, вешаются здесь.
  // attachClickEvent(author.container) tweb :172 — уже висит в base (колбэк
  // this.onAuthorClick); caption-клик (:174-185) — см. шапку файла.
  protected override setListeners() {
    super.setListeners()
    attachClickEvent(this.buttons.forward, this.onForwardClick)
    attachClickEvent(this.buttons.download, this.onDownloadClick)

    this.listLoader.onJump = (item, older) => {
      if (older) this.onNextClick(item)
      else this.onPrevClick(item)
    }
  }

  // Порт tweb onPrevClick/onNextClick (index.ts:204-220): повторный openMedia
  // соседа. getMessageByPeer-фетч не нужен — item уже полон (модель ViewerItem).
  protected onPrevClick = (target: ViewerTarget) => {
    void this.openMedia({ items: [target.item], index: 0, target: target.element ?? undefined, fromRight: -1 })
  }

  protected onNextClick = (target: ViewerTarget) => {
    void this.openMedia({ items: [target.item], index: 0, target: target.element ?? undefined, fromRight: 1 })
  }

  // Порт tweb onDeleteClick (index.ts:222-254) без deleteAsChatPhoto-ветки
  // (:224-242, аватар-вариант — вне Task 14). PopupDeleteMessages заменяет
  // колбэк opts.onDelete; по подтверждению close перецеливается в
  // отцентрованное медиа — полёт «в никуда» гаснет opacity (tweb :249-252).
  protected onDeleteClick = () => {
    const target = this.target
    if (!target?.mid) return
    this.opts.onDelete?.(target.mid, () => {
      this.target = { element: this.content.media } as ViewerTarget // tweb :250 `as any`
      void this.close()
    })
  }

  // Порт tweb onForwardClick (index.ts:256-266): showForwardPopup заменяет
  // колбэк opts.onForward, закрытие — через переданный close (tweb :262-264).
  protected onForwardClick = () => {
    const target = this.target
    if (!target?.mid) return
    this.opts.onForward?.(target.mid, () => this.close())
  }

  // Адаптация tweb onDownloadClick (index.ts:292-302): appDownloadManager.
  // downloadToDisc → наша существующая механика скачивания (как download
  // старого MediaLightbox / DocRow): URL из воркерного конвейера
  // downloadMediaURL + `<a download>`; имя файла — из meta (fileName).
  protected onDownloadClick = () => {
    const item = this.target?.item
    if (!item) return
    void AppMediaViewer.downloadMedia(item)
  }

  protected static async downloadMedia(item: ViewerItem) {
    const mediaId = item.media.mediaId
    const a = document.createElement('a')
    const direct = item.media.url
    if (direct !== undefined) {
      // Task 16: готовый источник (секретное E2E / фото профиля) — конвейер и
      // meta не зовутся (у секретного meta — шифртекст); имя — по виду медиа
      a.href = typeof direct === 'function' ? await direct() : direct
      a.download = `media-${mediaId || 'photo'}${item.media.kind === 'video' ? '.mp4' : '.jpg'}`
    } else {
      const managers = startClient().managers
      const [url, meta] = await Promise.all([
        managers.media.downloadMediaURL(mediaId),
        managers.media.meta(mediaId).catch(() => null),
      ])
      a.href = url
      a.download = meta?.fileName || `media-${mediaId}`
    }
    document.body.append(a)
    a.click()
    a.remove()
  }

  // Порт tweb setCaption (index.ts:304-356) в нашем объёме: подпись —
  // RichText-остров (renderCaptionIsland ставит/снимает hide — tweb :354).
  // Спонсорская ветка (:305-341), TranslatableMessage и saveTimestamps —
  // см. шапку файла.
  protected setCaption(item: ViewerItem) {
    this.renderCaptionIsland(item.caption
      ? createElement(RichText, {
        text: item.caption,
        entities: item.captionEntities,
        linkColor: 'var(--link-color)',
      })
      : null)
  }

  // Порт tweb setMessageActionVisibility (index.ts:396-418) в объёме DOM: и
  // топбар-кнопки, и пункты ⋮-меню у нас HTMLElement (verify-механики
  // ButtonMenu нет) — обе группы прячутся классом hide.
  private setMessageActionVisibility(options: {
    cantForward: boolean,
    cantDownload: boolean,
    cantDelete: boolean,
  }) {
    const actions: [HTMLElement[], boolean][] = [
      [[this.buttons.forward, this.btnMenuForward], options.cantForward],
      [[this.buttons.download, this.btnMenuDownload], options.cantDownload],
      [[this.buttons.delete, this.btnMenuDelete], options.cantDelete],
    ]

    actions.forEach(([buttons, hide]) => {
      buttons.forEach((button) => {
        button.classList.toggle('hide', hide)
      })
    })

    this.wholeDiv.classList.toggle('no-forwards', options.cantDownload)
  }

  // Мобильное ⋮-меню топбара — порт tweb setBtnMenuToggle (base.ts:970-973) +
  // минимальный vanilla-объём ButtonMenuToggle/ButtonMenu (buttonMenuToggle.ts:
  // 95-97, buttonMenu.ts:82-104/:232-233; классы открытия — contextMenuController
  // :140-142: 'active'+'was-open' на меню, 'menu-open' на кнопке; стили — порт
  // styles/tweb/_button.scss). Меню строится один раз (адаптация: пункты
  // статичны, verify/пересборки tweb на каждое открытие не нужны), но живёт
  // tweb-циклом autoPosition (buttonMenuToggle.ts:145-162, 171-186): на
  // открытие монтируется в getOverlayRoot() (body) и позиционируется
  // positionMenuTrigger от кнопки, классы — после doubleRaf (кадр между
  // монтированием и transition); на закрытие уезжает из DOM отложенно
  // (300 мс — уход transition, tweb :171-186).
  protected setBtnMenuToggle() {
    const toggle = this.btnMenuToggle = btnIcon('more', { onlyMobile: true })
    toggle.classList.add('btn-menu-toggle')

    const menu = this.btnMenu = document.createElement('div')
    menu.classList.add('btn-menu', 'bottom-left')

    // i18n вне React — как connectionStatus.ts: строка на момент постройки
    const t = useI18nStore.getState().t
    const menuItem = (icon: IconName, text: string, onClick: () => void, danger = false) => {
      const el = document.createElement('div')
      el.className = 'btn-menu-item rp-overflow' + (danger ? ' danger' : '')
      el.append(iconSpan(icon, 'btn-menu-item-icon'))
      const textEl = document.createElement('span')
      textEl.classList.add('btn-menu-item-text')
      textEl.textContent = t(text)
      el.append(textEl)
      attachClickEvent(el, () => {
        closeMenu()
        onClick()
      })
      return el
    }

    // порядок и тексты пунктов — tweb index.ts:147-160
    this.btnMenuForward = menuItem('forward', 'Forward', this.onForwardClick)
    this.btnMenuDownload = menuItem('download', 'Download', this.onDownloadClick)
    this.btnMenuDelete = menuItem('delete', 'Delete', this.onDeleteClick, true)
    menu.append(this.btnMenuForward, this.btnMenuDownload, this.btnMenuDelete)

    // Поколение открытия — роль tempId tweb (buttonMenuToggle.ts:113-116):
    // закрытие до кадра doubleRaf обесценивает летящее добавление классов.
    let tempId = 0
    let closeTimeout: ReturnType<typeof setTimeout> | undefined
    const unmount = () => {
      closeTimeout = undefined
      menu.remove()
    }
    const onOutsideClick = (e: Event) => {
      const target = e.target as HTMLElement
      // клик по кнопке обрабатывает её хендлер, по меню — сами пункты
      if (findUpClassName(target, 'btn-menu-toggle') === toggle || findUpClassName(target, 'btn-menu') === menu) return
      closeMenu()
    }
    const closeMenu = this.closeBtnMenu = (immediate = false) => {
      ++tempId
      menu.classList.remove('active')
      toggle.classList.remove('menu-open')
      document.removeEventListener('click', onOutsideClick, true)
      if (!menu.isConnected) return
      // tweb buttonMenuToggle.ts:171-186: element.remove() по таймеру 300 мс —
      // меню уезжает из DOM после transition закрытия; immediate — деструкция
      // вьювера (ждать некому)
      clearTimeout(closeTimeout)
      if (immediate) unmount()
      else closeTimeout = setTimeout(unmount, 300)
    }
    attachClickEvent(toggle, (e) => {
      cancelEvent(e)
      // клики по пунктам обрабатывают сами пункты (tweb ButtonMenuToggleHandler:35)
      if (findUpClassName(e.target as HTMLElement, 'btn-menu')) return
      if (toggle.classList.contains('menu-open')) {
        closeMenu()
      } else {
        const id = ++tempId
        // переоткрытие при летящем 300мс-закрытии переиспользует ещё
        // смонтированный элемент (tweb :117-121)
        clearTimeout(closeTimeout)
        closeTimeout = undefined
        this.getOverlayRoot().append(menu) // tweb :150-156 (mountTarget = getOverlayRoot())
        positionMenuTrigger(toggle, menu, 'bottom-left', { top: 8, bottom: 8 }) // tweb :157 (positionPadding-дефолт)
        // tweb :158 + ButtonMenuToggleHandler → openBtnMenu: классы открытия —
        // после doubleRaf, иначе transition не сыграет на свежесмонтированном узле
        void doubleRaf().then(() => {
          if (id !== tempId) return
          menu.classList.add('active', 'was-open')
          toggle.classList.add('menu-open')
          document.addEventListener('click', onOutsideClick, true)
        })
      }
    })

    this.topbar.append(toggle) // tweb base :972
  }

  // Порт tweb openMedia (index.ts:420-514) в нашей модели данных: вход — items
  // старого useLightbox + index (вместо message: цепочки getMediaFromMessage/
  // fwd_from/serviceMessage не нужны — item уже собран). Первый вызов кладёт
  // соседей вокруг index в listLoader (setTargets внутри base._openMedia);
  // повторные (листание из onPrev/onNextClick) — только текущий элемент.
  public openMedia({ items, index, target, fromRight = 0, reverse = false }: {
    items: ViewerItem[]
    index: number
    target?: HTMLElement
    fromRight?: number
    reverse?: boolean
  }): Promise<void> | undefined {
    if (this.setMoverPromise) return this.setMoverPromise // tweb :440

    const item = items[index]
    if (!item) return

    this.setCaption(item) // tweb :468

    const promise = this._openMedia({
      media: item.media,
      author: item.author, // noAuthor tweb :446-447 — спонсорских сообщений нет
      fromRight,
      target: target ?? item.element ?? undefined,
      reverse,
      prevTargets: items.slice(0, index).map(AppMediaViewer.toTarget),
      nextTargets: items.slice(index + 1).map(AppMediaViewer.toTarget),
    })

    // tweb :484-487: base положил в цель голый {element} (= listLoader.current)
    // — дописываем поля message-варианта
    const t = this.target!
    t.mid = item.mid
    t.item = item

    return promise
  }
}
