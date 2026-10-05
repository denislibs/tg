/** @jsxImportSource solid-js */
/**
 * Порт tweb `src/components/emoticonsDropdown/search.tsx` (812502980, 199 строк) — поле
 * поиска вкладки эмодзи-дропдауна (`EmoticonsSearch`, монтирует `EmoticonsTabC.createSearch`,
 * `tab.ts`). Поле — наш порт `InputSearch` (`components/inputSearch.ts`).
 *
 * Расхождение: ряд групп эмодзи под полем (`addSearchCategories`, `:16-148`, опция
 * `onGroup`) не портирован — групп нет на бэкенде (`messages.getEmojiGroups`,
 * `appEmojiManager.getEmojiGroups`), вкладки не передают `groupFetcher` (Б-131).
 */
import { type Accessor, createEffect, createSignal, onCleanup } from 'solid-js'
import type { LangPackKey } from '@lib/langPack'
import InputSearch from '@components/inputSearch'

export default function EmoticonsSearch(props: {
  type: 'emoji' | 'stickers' | 'gifs'
  placeholder?: LangPackKey
  // * defaults to 0 - local searches (emoji, stickers) can run on every keystroke,
  // * server-backed ones must not or the API floods the client out
  debounceTime?: number
  // * return false to answer a value right away, e.g. one the tab already has results for
  verifyDebounce?: (value: string, prevValue: string) => boolean
  loading?: Accessor<boolean>
  onValue: (value: string) => void
  onFocusChange?: (isFocused: boolean) => void
}) {
  const [debounced, setDebounced] = createSignal(false)
  const inputSearch = new InputSearch({
    placeholder: props.placeholder || 'Search',
    onChange: (value) => {
      props.onValue(value.trim())
    },
    onFocusChange: props.onFocusChange,
    onDebounce: setDebounced,
    noBorder: true,
    noFocusEffect: true,
    debounceTime: props.debounceTime ?? 0,
    verifyDebounce: props.verifyDebounce,
  })
  inputSearch.container.classList.add('emoticons-search-input-container')
  inputSearch.input.classList.add('emoticons-search-input')

  onCleanup(() => {
    inputSearch.remove()
  })

  if(props.loading) {
    const loading = props.loading
    createEffect(() => {
      inputSearch.toggleLoading(debounced() || loading())
    })
  }

  return (
    <>
      {inputSearch.container}
    </>
  )
}
