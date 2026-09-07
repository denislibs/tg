// Порт tweb `src/components/stargifts/profileStore.ts` (305 строк) —
// `createProfileGiftsStore`: стор витрины подарков профиля и действия над ним.
// Форма оригинала: Solid `createStore` + объект действий; класс `AppSearchSuper`
// читает `store.loading`/`store.loaded` и зовёт `actions.loadNext()`
// (`appSearchSuper.ts:2174-2178`, `:2363-2365`).
//
// ── Что НЕ портировано, и почему ──────────────────────────────────────────────
// Наша ручка `GET /users/{id}/gifts` (`managers.stars.profileGifts`) отдаёт весь
// набор ОДНИМ ответом без параметров: ни `offset`/`limit` (пагинация,
// `currentOffset`/`res.next`, `:74`, `:107`), ни фильтров `sort`/`unlimited`/
// `limited`/`upgradable`/`unique`/`displayed`/`hidden` (`:15-24`, `setFilters`),
// ни коллекций (`collections`/`chosenCollection`/`collectionCache`,
// `deleteCollection`/`updateCollection`/`handleSwipe`). Поэтому стор сужен до
// того, что предмет имеет: `items`/`loading`/`loaded`/`canManageGifts`, а из
// действий — только `loadNext`; после первого ответа набор считается дочитанным
// (`loaded = true`, у оригинала — `!res.next`).
//
// Живые апдейты (`star_gift_update`/`pinned_stargifts`/`star_gift_list_update`,
// `:246-302`) — у `rootScope` нет событий подарков, владелец их не объявляет.
//
// `canManageGifts` (`:57`, `canManageGifts.ts`) не заведён: его читают только
// коллекции и контекстное меню плитки (`profileList.tsx:310`, `:385`,
// `stargiftsGrid.tsx:56`) — оба не портированы, поле было бы мёртвым.
//
// `onCountChange(res.count)` (`:130`): счётчик ответа и есть длина набора —
// ручка без пагинации отдаёт всё.
import { createStore } from 'solid-js/store'
import { batch } from 'solid-js'
import type { Managers } from '@/client/bootstrap'
import type { SavedStarGift } from '@core/managers/starsManager'

export type StarGiftsManagers = {
  stars: Pick<Managers['stars'], 'profileGifts'>
}

export interface StarGiftsProfileStore {
  items: SavedStarGift[]
  loading: boolean
  loaded: boolean
}

export interface StarGiftsProfileActions {
  /** `loadNext(reload?)` оригинала: `reload` звали только фильтры и апдейт
   *  списка (`:144`, `:299`) — оба не портированы, параметра нет. */
  loadNext: () => Promise<void>
}

export function createProfileGiftsStore(props: {
  peerId: PeerId
  managers: StarGiftsManagers
  onCountChange?: (count: number) => void
}): [StarGiftsProfileStore, StarGiftsProfileActions] {
  const initialState: StarGiftsProfileStore = {
    items: [],
    loading: false,
    loaded: false,
  }
  const [store, setStore] = createStore<StarGiftsProfileStore>(initialState)

  // `nextReqId` (`:75`, `:86`, `:106`) — защита от гонки ДВУХ запросов; второй
  // порождали только `reload()`-пути, которых нет: под гвардом `loading`
  // запрос всегда один.
  async function loadNext() {
    if(store.loading || store.loaded) return
    setStore('loading', true)

    const gifts = await props.managers.stars.profileGifts(props.peerId)

    batch(() => {
      // `store.items.concat(res.gifts)` (`:114`) — страница одна, набор пуст.
      setStore('items', gifts)
      setStore('loaded', true)
      setStore('loading', false)
    })
    props.onCountChange?.(gifts.length)
  }

  const actions: StarGiftsProfileActions = {
    loadNext,
  }

  return [store, actions]
}
