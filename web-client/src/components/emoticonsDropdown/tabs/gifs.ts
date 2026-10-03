// Порт tweb `src/components/emoticonsDropdown/tabs/gifs.ts` (812502980, 196 строк) — вкладка GIF:
// кладка сохранённых GIF (`gifsMasonry.ts`), поиск с кэшем запросов на время поиска и подгрузкой
// страниц по прокрутке, отправка по клику (`onMediaClick`), живое обновление сохранённых
// (`gifs_updated`).
//
// ОБЪЯВЛЕННЫЕ РАСХОЖДЕНИЯ С ОРИГИНАЛОМ
//  1. Поиск — прокси Tenor (`stickers.searchGifs(q, pos)`, `TenorGif`), а не инлайн-бот `@gif`
//     (`appGifsManager.searchGifs`); элемент кладки — `GifItem` (`core/gifs.ts`): сохранённый —
//     `savedGifToItem`, найденный — `tenorToItem` (как во вкладке поиска GIF правой колонки).
//  2. Группы поиска (`groupFetcher`) — Б-131.
//  3. Очередь кладки — её `VisibilityIntersector` (расхождение 3 `gifsMasonry.ts`); к
//     `addLazyLoadQueueRepeat` дропдауна она подключается им же.
import I18n, { i18n } from '@lib/langPack'
import { attachPickerGrid } from '@helpers/dom/attachListNavigation'
import GifsMasonry from '@components/gifsMasonry'
import { putPreloader } from '@components/putPreloader'
import type { Managers } from '@/client/bootstrap'
import { attachClickEvent } from '@helpers/dom/clickEvent'
import EmoticonsTabC from '@components/emoticonsDropdown/tab'
import { onCleanup } from 'solid-js'
import type { Middleware } from '@helpers/middleware'
import { getMiddleware } from '@helpers/middleware'
import rootScope from '@lib/rootScope'
import { savedGifToItem, tenorToItem, type GifItem } from '@core/gifs'
import type StickersTabCategory from '@components/emoticonsDropdown/category'

// * a query keeps its results (and the pages scrolled into them) for as long as the search
// * lasts, so going back to an earlier query is instant and costs no request
type GifsSearchResults = { documents: GifItem[], nextOffset?: string, query: string }

export default class GifsTab extends EmoticonsTabC<StickersTabCategory<{ element: HTMLElement }>, GifsSearchResults> {
  private searchCache?: Map<string, GifsSearchResults | Promise<GifsSearchResults>>

  constructor(options: {
    managers: Managers
  }) {
    super({
      managers: options.managers,
      noMenu: true,
      searchFetcher: (value) => {
        if(!value) {
          // * the cache lives for one search, exactly like tdesktop's cancelGifsSearch
          this.searchCache?.clear()
          return { documents: [], nextOffset: '', query: value }
        }

        return this.getSearchResults(value)
      },
      // * only a value that still has to be asked for waits out the debounce - clearing the
      // * search and returning to an already fetched query both answer at once
      searchVerifyDebounce: (value) => {
        value = value.trim()
        return !!value && !this.searchCache?.has(value)
      },
      processSearchResult: async({ data, searching, grouping }) => {
        if(!searching && !grouping) {
          return
        }

        // * `data` is undefined until the first fetch resolves and again whenever one fails
        const gifs = data?.documents
        if(!data || !gifs?.length) {
          const span = i18n('NoGIFsFound')
          span.classList.add('emoticons-not-found')
          return span
        }

        const middlewareHelper = getMiddleware()
        onCleanup(() => middlewareHelper.destroy())
        const middleware = middlewareHelper.get()
        const container = this.categoriesContainer.cloneNode(false) as HTMLElement
        const { masonry, container: gifsContainer } = this.createMasonry(middleware)
        gifs.forEach((doc) => masonry.add(doc))
        container.append(gifsContainer)

        const old = this.scrollable.onAdditionalScroll
        this.scrollable.onAdditionalScroll = () => {
          old?.()

          const { nextOffset } = data
          if(!nextOffset) {
            return
          }

          // prevent multiple requests
          data.nextOffset = undefined

          this.managers.stickers.searchGifs(data.query, nextOffset).then((result) => {
            // * this view is what the results were rendered into - once it is gone the page
            // * has nowhere to go, so put the offset back and let the next view ask again
            if(!middleware()) {
              data.nextOffset = nextOffset
              return
            }

            const documents = result.gifs.map(tenorToItem)
            documents.forEach((doc) => masonry.add(doc))
            data.documents.push(...documents)
            data.nextOffset = result.next
          }, () => {
            // * let a later scroll retry the page instead of ending the list here
            data.nextOffset = nextOffset
          })
        }

        onCleanup(() => {
          this.scrollable.onAdditionalScroll = old
        })

        return container
      },
      searchNoLoader: true,
      searchPlaceholder: 'SearchGIFs',
      searchType: 'gifs',
      // * every keystroke is a search request - 400ms is what tdesktop waits
      // * (kSearchRequestDelay in gifs_list_widget.cpp)
      searchDebounceTime: 400,
    })

    this.container.classList.add('gifs-padding')
    this.content.id = 'content-gifs'
  }

  private getSearchResults(query: string) {
    const cache = this.searchCache ??= new Map()
    const cached = cache.get(query)
    if(cached) {
      return cached
    }

    // * the promise is cached too so the pending query is never requested twice, and it is
    // * swapped for the plain results afterwards - a repeat of the query then resolves
    // * synchronously and the search input skips its debounce for it
    const promise: Promise<GifsSearchResults> = this.managers.stickers.searchGifs(query).then((result) => {
      const results: GifsSearchResults = { documents: result.gifs.map(tenorToItem), nextOffset: result.next, query }
      // * the search may have been cancelled (dropping the cache) while this was in flight -
      // * results of a search that is over must not reappear in the next one
      if(cache.get(query) === promise) {
        cache.set(query, results)
      }

      return results
    }, (err: unknown) => {
      cache.delete(query)
      throw err
    })

    cache.set(query, promise)
    return promise
  }

  private createMasonry(middleware: Middleware) {
    const gifsContainer = document.createElement('div')
    gifsContainer.classList.add('gifs-masonry')
    middleware.onDestroy(attachPickerGrid(gifsContainer, '.gif', (_, index) => I18n.format('AccDescr.GifNumber', true, [String(index + 1)])))
    const masonry = new GifsMasonry(gifsContainer, this.animationGroup, this.scrollable)
    const detachClickEvent = attachClickEvent(gifsContainer, (e) => {
      void this.emoticonsDropdown!.onMediaClick(e, (docId) => masonry.getItem(docId))
    })

    middleware.onDestroy(() => {
      masonry.clear()
      detachClickEvent()
    })

    const { intersector } = masonry
    this.emoticonsDropdown!.addLazyLoadQueueRepeat({
      intersector,
      lock: () => intersector.lock(),
      unlockAndRefresh: () => intersector.unlockAndRefresh(),
    }, masonry.processInvisibleDiv, middleware)
    return { masonry, container: gifsContainer }
  }

  public init() {
    if(this.initialized) return
    this.initialized = true
    super.init()

    const middleware = this.middlewareHelper.get()
    const { masonry, container } = this.createMasonry(middleware)
    this.categoriesContainer.append(container)
    const preloader = putPreloader(this.content, true)

    let rendered = 0
    const onGifsUpdated = (gifs: GifItem[]) => {
      masonry.update(gifs)
      rendered = gifs.length
    }

    void this.managers.stickers.savedGifs().then((docs) => {
      masonry.addBatch(docs.map(savedGifToItem))
      rendered = docs.length
    }, () => {}).finally(() => {
      preloader.remove()
    })

    const onGifsUpdatedPostponed = this.postponedEvent(onGifsUpdated)
    this.listenerSetter.add(rootScope)('gifs_updated', (docs) => {
      const gifs = docs.map(savedGifToItem)
      // a shorter list means a gif was taken out of the saved ones — the user did that and has
      // to see it go; a list of the same length is the reorder that follows using one, which
      // waits for the panel to hide
      ;(gifs.length < rendered ? onGifsUpdated : onGifsUpdatedPostponed)(gifs)
    })

    this.attachHelpers({
      isGif: true,
    })
  }
}
