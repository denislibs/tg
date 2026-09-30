/** @jsxImportSource solid-js */
/**
 * Порт tweb `src/components/sidebarRight/tabs/stickers.tsx` (812502980, 231 строка) —
 * вкладка «Поиск стикеров» (`AppStickersTab`, регистрация — `solidJsTabs/tabs.ts`,
 * tweb `tabs.ts:521-525`). Разметка строится императивно, как у оригинала:
 * компонент возвращает `null`, а в `onMount` кладёт в скроллер вкладки
 * `div.sticker-sets` и меняет заголовок на поле поиска (живой DOM — дамп
 * `docs/tweb/dom/dumps/19-emoticons-06-sticker-search-right.json`).
 *
 * Расхождения с оригиналом:
 *  1. Состав строки — из covered-выдачи (`featuredSets`/`searchSets` отдают
 *     набор вместе с первыми документами), а не `getStickerSet` на каждую
 *     строку (`:68`): у tweb тот же вызов отдаёт ИЗ КЭША менеджера тот самый
 *     covered-набор, который туда положили `getFeaturedStickers`/
 *     `searchStickerSets` (`appStickersManager.ts:552-558`, `:752-758`). Кэша
 *     наборов у нашего менеджера нет, и дословный вызов стал бы запросом на
 *     каждую строку выдачи.
 *  2. Выдача — `{sets, covers}` (`core/managers/stickersManager.ts::splitCovered`),
 *     её пары «набор + документы» собираются здесь (`toCovered`). Локальной
 *     подмешки найденных среди своих наборов (`foundSaved`,
 *     `appStickersManager.ts:765-775`) у менеджера нет — О-28 волна 7.
 *  3. `data-access_hash` не пишется: у наших наборов его нет, адрес — число
 *     (`InputStickerSetAddress {id}`).
 *  4. Строка несёт свой `middlewareHelper` (ребёнок хелпера вкладки) и гасит его,
 *     когда `filterRendered` её снимает. Наш `wrapSticker` регистрирует плеер
 *     `controlled` своей зоной (шапка `wrappers/sticker.ts`), и
 *     `checkAnimations` (`:114`) снятую строку не снимает; у tweb `wrapSticker`
 *     этой вкладки зовётся без `middleware`, плеер неуправляемый.
 *  5. Кнопка: сам тоггл — общий `core/stickers/toggleStickerSet` (он же
 *     объявляет `stickers_installed`/`stickers_deleted`, как
 *     `appStickersManager.toggleStickerSet`); полного набора перед ним не
 *     запрашиваем (`getStickerSet(input)`, `:192`) — установке нужен только id.
 *     Новое состояние — ответ тоггла, его же пишем в `installed_date` набора
 *     строки (у tweb это делает менеджер в своём кэше, `appStickersManager.ts:672-727`).
 *  6. `premium`-замок (`withLock: true`, `:85`) не передаётся: у нашего
 *     `wrapSticker` его нет, премиум-стикеров нет — О-29 волна 7.
 *
 * Временное (с номерами):
 *  • `showStickersPopup` (`:205-206`) → React `openStickerSetModal` — ВРЕМЕННО
 *    до 2C-15 (порт `popups/stickers.solid.tsx`). Полный набор перед попапом не
 *    запрашиваем: попап грузит его сам по адресу.
 *  • `appImManager.chat` и `appSidebarRight` — через `emoticonsSearchBridge`
 *    (ВРЕМЕННО до Э4-3 и до врезки 0б-11 — шапка моста).
 *
 * Отложено (с номерами):
 *  • О-25 волна 7 — предпросмотр по зажатию (`attachStickerViewerListeners`,
 *    `:166`): ванильного порта `components/stickerViewer.ts` нет, у нас только
 *    React-хук `components/stickers/useStickerViewer.ts`.
 *  • О-26 волна 7 — «Add/Added» читает `installed_date` набора дословно
 *    (`isStickerSetAdded`), а бэкенд кладёт его только в выдачу моих наборов:
 *    тренды, поиск и набор по id собираются без пользователя
 *    (`stickersrepo.go::setCols`), и установленный набор здесь выглядит «Add».
 */
import { onCleanup, onMount, type Component } from 'solid-js'
import animationIntersector from '@components/animationIntersector'
import InputSearch from '@components/inputSearch'
import { useSuperTab } from '@components/solidJsTabs/superTabProvider.solid'
import wrapSticker from '@components/wrappers/sticker'
import { createLazyLoadQueue } from '@core/lazyLoadQueue'
import { getPathThumb, getStrippedThumb } from '@core/media/messageMedia'
import type { Covers, Sticker, StickerSet } from '@core/managers/stickersManager'
import isStickerSetAdded from '@core/stickers/isStickerSetAdded'
import { toggleStickerSet } from '@core/stickers/toggleStickerSet'
import forEachReverse from '@helpers/array/forEachReverse'
import { attachClickEvent } from '@helpers/dom/clickEvent'
import findUpClassName from '@helpers/dom/findUpClassName'
import setInnerHTML from '@helpers/dom/setInnerHTML'
import { i18n } from '@lib/langPack'
import wrapEmojiText from '@lib/richtext/wrapEmojiText'
import { emoticonsSearchBridge } from './emoticonsSearchBridge'

const ANIMATION_GROUP = 'STICKERS-SEARCH'

/** Набор вместе с документами — `stickerSetFullCovered` схемы (расхождение 2). */
type CoveredSet = { set: StickerSet, documents: Sticker[] }

const toCovered = ({ sets, covers }: { sets: StickerSet[], covers: Covers }): CoveredSet[] =>
  sets.map((set) => ({ set, documents: covers.get(set.id) ?? [] }))

const Stickers: Component = () => {
  const [tab] = useSuperTab()
  const managers = tab.managers!

  let inputSearch: InputSearch
  let setsDiv: HTMLDivElement
  const lazyLoadQueue = createLazyLoadQueue()
  // Наборы и документы отрисованных строк — по `data-sticker-set` и
  // `data-doc-id` (у tweb их достают по id менеджеры: `getStickerSet`,
  // `sendMessageWithDocument({document: docId})`).
  const renderedSets = new Map<string, StickerSet>()
  const renderedDocs = new Map<string, Sticker>()

  const renderSet = ({ set, documents }: CoveredSet) => {
    const div = document.createElement('div')
    div.classList.add('sticker-set')
    div.middlewareHelper = tab.middlewareHelper.get().create()

    const header = document.createElement('div')
    header.classList.add('sticker-set-header')

    const details = document.createElement('div')
    details.classList.add('sticker-set-details')
    const name = document.createElement('div')
    name.classList.add('sticker-set-name')
    details.append(name)

    setInnerHTML(name, wrapEmojiText(set.title))

    const countDiv = document.createElement('div')
    countDiv.classList.add('sticker-set-count')
    countDiv.append(i18n('Stickers', [set.count]))
    details.append(countDiv)

    const button = document.createElement('button')
    button.classList.add('btn-primary', 'btn-color-primary', 'sticker-set-button')
    // О-26 волна 7: у трендов и поиска `installed_date` бэкенд пока не пишет.
    const added = isStickerSetAdded(set)
    button.append(i18n(added ? 'Stickers.SearchAdded' : 'Stickers.SearchAdd'))

    if(added) {
      button.classList.add('gray')
    }

    header.append(details, button)

    const stickersDiv = document.createElement('div')
    stickersDiv.classList.add('sticker-set-stickers')

    const count = Math.min(5, set.count)
    for(let i = 0; i < count; ++i) {
      const stickerDiv = document.createElement('div')
      stickerDiv.classList.add('sticker-set-sticker')

      stickersDiv.append(stickerDiv)
    }

    const middleware = div.middlewareHelper.get()
    for(let i = 0; i < count; ++i) {
      const stickerDiv = stickersDiv.children[i] as HTMLDivElement
      const doc = documents[i]
      if(!doc) {
        continue
      }

      renderedDocs.set('' + doc.id, doc)
      wrapSticker({
        mediaId: doc.id,
        thumb: getStrippedThumb(doc),
        pathThumb: getPathThumb(doc),
        docWidth: doc.w,
        docHeight: doc.h,
        div: stickerDiv,
        middleware,
        lazyLoadQueue,
        group: ANIMATION_GROUP,
        play: true,
        loop: true,
        width: 68,
        height: 68,
      })
    }

    div.dataset.stickerSet = '' + set.id
    div.dataset.title = set.title
    renderedSets.set('' + set.id, set)

    div.append(header, stickersDiv)

    setsDiv.append(div)
  }

  const filterRendered = (query: string, coveredSets: CoveredSet[]) => {
    coveredSets = coveredSets.slice()

    const children = Array.from(setsDiv.children) as HTMLElement[]
    forEachReverse(children, (el) => {
      const id = el.dataset.stickerSet
      const index = coveredSets.findIndex((covered) => '' + covered.set.id === id)

      if(index !== -1) {
        coveredSets.splice(index, 1)
      } else if(!query || !el.dataset.title!.toLowerCase().includes(query.toLowerCase())) {
        el.remove()
        // расхождение 4
        el.middlewareHelper?.destroy()
      }
    })

    animationIntersector.checkAnimations(undefined, ANIMATION_GROUP)

    return coveredSets
  }

  const renderFeatured = () => {
    return managers.stickers.featuredSets().then((res) => {
      if(inputSearch.value) {
        return
      }

      const coveredSets = filterRendered('', toCovered(res))
      coveredSets.forEach((set) => {
        renderSet(set)
      })
    })
  }

  const search = (query: string) => {
    if(!query) {
      return renderFeatured()
    }

    return managers.stickers.searchSets(query).then((res) => {
      if(inputSearch.value !== query) {
        return
      }

      const coveredSets = filterRendered(query, toCovered(res))
      coveredSets.forEach((set) => {
        renderSet(set)
      })
    })
  }

  onMount(() => {
    tab.container.id = 'stickers-container'
    tab.container.classList.add('chatlist-container')

    inputSearch = new InputSearch({
      placeholder: 'StickersTab.SearchPlaceholder',
      onChange: (value) => {
        void search(value)
      },
    })

    tab.title.replaceWith(inputSearch.container)

    setsDiv = document.createElement('div')
    setsDiv.classList.add('sticker-sets')
    tab.scrollable.append(setsDiv)

    // О-25 волна 7: `attachStickerViewerListeners({listenTo: setsDiv, …})` — порта нет.

    attachClickEvent(setsDiv, (e) => {
      const { appImManager } = emoticonsSearchBridge
      const sticker = findUpClassName(e.target as HTMLElement, 'sticker-set-sticker')
      // With no chat to send to — the tab opened from the empty column's Stickers tip — a sticker
      // falls through to its own set below, which opens the pack.
      if(sticker && appImManager.chat?.peerId) {
        const doc = renderedDocs.get(sticker.dataset.docId!)
        if(doc) {
          void appImManager.chat.input.sendMessageWithDocument({ document: doc, target: sticker })
        }
        return
      }

      const target = findUpClassName(e.target as HTMLElement, 'sticker-set')
      if(!target) return

      const set = renderedSets.get(target.dataset.stickerSet!)
      if(!set) return

      const button = findUpClassName(e.target as HTMLElement, 'sticker-set-button') as HTMLElement
      if(button) {
        e.preventDefault()
        e.stopPropagation()

        button.setAttribute('disabled', 'true')

        toggleStickerSet(managers.stickers, set, isStickerSetAdded(set)).then((added) => {
          // расхождение 5
          set.installed_date = added ? Math.floor(Date.now() / 1000) : undefined
          button.textContent = ''
          button.append(i18n(added ? 'Stickers.SearchAdded' : 'Stickers.SearchAdd'))
          button.classList.toggle('gray', added)
        }).catch(() => {}).finally(() => {
          button.removeAttribute('disabled')
        })
      } else {
        // ВРЕМЕННО до 2C-15: `showStickersPopup(getStickerSetInputByStickerSet(full.set))`
        const chat = appImManager.chat
        const onPick = chat ? (doc: Sticker) => { void chat.input.sendMessageWithDocument({ document: doc }) } : undefined
        void import('@components/stickers/StickerSetModal').then((m) => { m.openStickerSetModal({ id: set.id }, onPick) })
      }
    }, { listenerSetter: tab.listenerSetter })

    // The tab is opened from the emoticons panel into the right sidebar, and from the empty
    // column's Stickers tip into the left one — where there is no sidebar to reveal, and where
    // revealing the right one would just show an empty column.
    // ВРЕМЕННО до 0б-11 (врезка): `appSidebarRight` — синглтон колонки (шапка моста).
    const { appSidebarRight } = emoticonsSearchBridge
    const revealed = appSidebarRight && tab.slider === appSidebarRight ?
      appSidebarRight.toggleSidebar(true) :
      Promise.resolve()

    void revealed.then(() => {
      void renderFeatured()
    })
  })

  onCleanup(() => {
    setsDiv.replaceChildren()
    animationIntersector.checkAnimations(undefined, ANIMATION_GROUP)
  })

  return null
}

export default Stickers
