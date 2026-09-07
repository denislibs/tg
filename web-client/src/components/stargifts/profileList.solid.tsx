/** @jsxImportSource solid-js */
// Порт tweb `src/components/stargifts/profileList.tsx` (472 строки) —
// `StarGiftsProfileTab`: витрина подарков в профиле (вкладка «Подарки»
// `AppSearchSuper`, монтируется в `mediaTab.itemsTab` из `loadGifts`,
// `appSearchSuper.ts:2130-2179`). Стор — `profileStore.solid.ts`, сетка —
// `stargiftsGrid.solid.tsx`, стили — `profileList.module.scss` (порт 1:1, лежал
// заранее).
//
// ── Форма шва с классом ───────────────────────────────────────────────────────
// У tweb компонент — функция, которую класс зовёт ПРЯМО внутри своего
// `createRoot` и получает `{render, store, actions, setCollection}` (`:471`).
// У нас Solid входит в императивный код только через мост `mountSolid`
// (`shared/solid/mountSolid.solid.tsx` — `ErrorBoundary` сдерживания), и он
// возвращает только `dispose`/`update`. Поэтому компонент возвращает JSX, а
// `store`/`actions` отдаёт наружу пропом `ref` (Solid-соглашение для «дай
// вызывающему ручку на созданное»), — тот же набор, что класс читал бы из
// возврата функции.
//
// ── Что НЕ портировано, и почему ──────────────────────────────────────────────
//  • Коллекции целиком (`ChipTabs`, `setCollection`, `AnimationList` со сдвигом
//    между коллекциями, `scrollPositions`, попапы создать/переименовать/добавить,
//    контекстное меню чипа, `:30-126`, `:246-300`, `:352-457`) и меню
//    сортировки/фильтров (`profileStarGiftsButtonMenu`, `:128-230`): у ручки
//    `GET /users/{id}/gifts` нет ни коллекций, ни фильтров (`profileStore.solid.ts`).
//    Вместе с ними — `hasCollections` на корне, пустое состояние коллекции
//    (`StarGiftCollectionsEmpty*`, `:310-324`) и перехват свайпа вкладок
//    `handleSwipe` (`appSearchSuper.ts:508-511` — свайп листает коллекции).
//  • `scrollParent` (`:236`): нужен `StarGiftsGrid` как корень
//    `IntersectionObserver` рендерера стикеров и памяти скролла коллекций —
//    ни того, ни другого нет.
//  • Клик по плитке → `PopupStarGiftInfo` (`:340-342`): попап не портирован —
//    у грида есть `onClick` оригинала, вызов встанет туда вместе с попапом.
import { Match, Switch, onMount } from 'solid-js'
import type { AvatarManagers } from '@components/avatar'
import Preloader from '@components/auth/Preloader.solid'
import { _i18n } from '@lib/langPack'
import { StarGiftsGrid } from './stargiftsGrid.solid'
import {
  createProfileGiftsStore,
  type StarGiftsManagers,
  type StarGiftsProfileActions,
  type StarGiftsProfileStore,
} from './profileStore.solid'
import styles from './profileList.module.scss'

export type StarGiftsProfileTabRef = {
  store: StarGiftsProfileStore
  actions: StarGiftsProfileActions
}

export type StarGiftsProfileTabProps = {
  peerId: PeerId
  managers: StarGiftsManagers & AvatarManagers
  onCountChange?: (count: number) => void
  /** `{store, actions}` — то, что оригинал возвращает вызывающему (`:471`) */
  ref?: (api: StarGiftsProfileTabRef) => void
}

export function StarGiftsProfileTab(props: StarGiftsProfileTabProps) {
  const [store, actions] = createProfileGiftsStore({
    peerId: props.peerId,
    managers: props.managers,
    onCountChange: props.onCountChange,
  })

  props.ref?.({ store, actions })

  onMount(() => actions.loadNext())

  // `collectionContent` (`:302-348`) без обёртки `createMemo`/`untrack` по
  // `chosenCollection` — коллекций нет, содержимое одно.
  return (
    <div class={/* @once */ styles.tab}>
      <div class={/* @once */ styles.contentWrapper}>
        <div class={/* @once */ styles.collectionContent}>
          <Switch>
            <Match when={store.loading && store.items.length === 0}>
              <Preloader />
            </Match>
            <Match when={store.items.length === 0}>
              <div class={/* @once */ styles.empty}>
                {/* `I18nTsx` (`helpers/solid/i18n.tsx`) — `IntlElement` с классом на нём же */}
                <span class={/* @once */ styles.emptySubtitle} ref={(el) => _i18n(el, 'StarGiftCollectionsEmptyOther')} />
              </div>
            </Match>
            <Match when={true}>
              <StarGiftsGrid
                class={/* @once */ styles.grid}
                items={store.items}
                managers={props.managers}
              />
            </Match>
          </Switch>
        </div>
      </div>
    </div>
  )
}
