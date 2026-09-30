/** @jsxImportSource solid-js */
/**
 * Порт tweb `src/components/sidebarRight/tabs/gifs.tsx` (812502980, 128 строк) —
 * вкладка «Поиск GIF» (`AppGifsTab`, регистрация — `solidJsTabs/tabs.ts`, tweb
 * `tabs.ts:458-462`). Компонент возвращает `null`, а в `onMount` кладёт в
 * скроллер вкладки кладку `div.gifs-masonry` (`components/gifsMasonry.ts`) и
 * меняет заголовок на поле поиска (живой DOM — дампы
 * `docs/tweb/dom/dumps/19-emoticons-04-gif-search-right.json`, `-05-…results.json`).
 *
 * Расхождения с оригиналом:
 *  1. Выдача — прокси Tenor (`managers.stickers.searchGifs(q, pos)`,
 *     `GET /gifs/search`), а не инлайн-бот `@gif` (`resolveUsername('gif')` +
 *     `appInlineBotsManager.getInlineResults`, `:38-44`): инлайн-бота GIF на
 *     бэкенде нет (О-27 волна 7). Курсор `next` — роль `next_offset`, элемент выдачи —
 *     `GifItem` (`core/gifs.ts::tenorToItem`), а не `botInlineMediaResult.document`
 *     (`:56-60`); кладка принимает его же (шапка `gifsMasonry.ts`, расхождение 1).
 *  2. Клик достаёт элемент у кладки по `data-doc-id` (`masonry.getItem`) и
 *     отдаёт в отправку САМ элемент, а не `docId` (`:77-78`): Tenor-результат не
 *     документ, по id его никто, кроме кладки, не знает.
 *
 * Временное (с номерами): `appImManager.chat` и `appSidebarRight` — через
 * `emoticonsSearchBridge` (ВРЕМЕННО до Э4-3 и до врезки 0б-11 — шапка моста).
 */
import { onCleanup, onMount, type Component } from 'solid-js'
import animationIntersector, { type AnimationItemGroup } from '@components/animationIntersector'
import GifsMasonry from '@components/gifsMasonry'
import InputSearch from '@components/inputSearch'
import { useSuperTab } from '@components/solidJsTabs/superTabProvider.solid'
import { tenorToItem } from '@core/gifs'
import type { GifPage } from '@core/managers/stickersManager'
import { attachClickEvent } from '@helpers/dom/clickEvent'
import findUpClassName from '@helpers/dom/findUpClassName'
import mediaSizes from '@helpers/mediaSizes'
import { emoticonsSearchBridge } from './emoticonsSearchBridge'

const ANIMATIONGROUP: AnimationItemGroup = 'GIFS-SEARCH'

const Gifs: Component = () => {
  const [tab] = useSuperTab()
  const managers = tab.managers!

  let inputSearch: InputSearch
  let gifsDiv: HTMLDivElement
  let masonry: GifsMasonry
  let nextOffset = ''
  let loadedAll = false
  let searchPromise: Promise<GifPage> | null = null

  const reset = () => {
    searchPromise = null
    nextOffset = ''
    loadedAll = false
    masonry.clear()
  }

  const search = async(query: string, newSearch = true) => {
    if(searchPromise || loadedAll) return

    try {
      // О-27 волна 7: Tenor-прокси вместо `@gif` (`resolveUsername` + `getInlineResults`).
      searchPromise = managers.stickers.searchGifs(query, nextOffset)
      const { gifs: results, next } = await searchPromise

      if(inputSearch.value !== query) {
        return
      }

      searchPromise = null
      nextOffset = next
      if(newSearch) {
        gifsDiv.replaceChildren()
      }

      if(results.length) {
        results.forEach((result) => {
          masonry.add(tenorToItem(result))
        })
      } else {
        loadedAll = true
      }

      tab.scrollable.onScroll()
    } catch(err) {
      searchPromise = null
      console.error('gifs loading error:', err)
      throw err
    }
  }

  const onGifsClick = async(e: MouseEvent | TouchEvent) => {
    const target = findUpClassName(e.target as HTMLElement, 'gif')
    if(!target) return

    const { appImManager, appSidebarRight } = emoticonsSearchBridge
    const fileId = target.dataset.docId!
    const item = masonry.getItem(fileId)
    if(item && appImManager.chat && await appImManager.chat.input.sendMessageWithDocument({ document: item, target })) {
      if(mediaSizes.isMobile) {
        appSidebarRight?.onCloseBtnClick()
      }
    } else {
      console.warn('got no doc by id:', fileId)
    }
  }

  onMount(() => {
    tab.container.id = 'search-gifs-container'

    inputSearch = new InputSearch({
      placeholder: 'SearchGifsTitle',
      onChange: (value) => {
        reset()
        void search(value)
      },
    })

    tab.title.replaceWith(inputSearch.container)

    gifsDiv = document.createElement('div')
    gifsDiv.classList.add('gifs-masonry')
    attachClickEvent(gifsDiv, (e) => { void onGifsClick(e) }, { listenerSetter: tab.listenerSetter })

    tab.scrollable.append(gifsDiv)

    masonry = new GifsMasonry(gifsDiv, ANIMATIONGROUP, tab.scrollable)

    // ВРЕМЕННО до 0б-11 (врезка): `appSidebarRight.toggleSidebar(true)` — синглтон
    // колонки (шапка моста); до него вкладке раскрывать нечего.
    const revealed = emoticonsSearchBridge.appSidebarRight?.toggleSidebar(true) ?? Promise.resolve()
    void revealed.then(() => {
      void search('', true)

      tab.scrollable.onScrolledBottom = () => {
        void search(inputSearch.value, false)
      }
    })
  })

  onCleanup(() => {
    reset()
    gifsDiv.replaceChildren()
    animationIntersector.checkAnimations(undefined, ANIMATIONGROUP)
    inputSearch.remove()
  })

  return null
}

export default Gifs
