// GifsSearchTab — экран «Поиск GIF» правой колонки (порт tweb
// sidebarRight/tabs/gifs.tsx, живой DOM — дампы 19-emoticons-04/05):
// #search-gifs-container, в шапке InputSearch «Search GIFs», в скролле —
// div.gifs-masonry с ячейками tweb wrapVideo (общий components/GifsMasonry, как
// tweb GifsMasonry общий у дропдауна и этого экрана). Пустой запрос — тренды,
// догрузка страниц по скроллу вниз, клик по гифке — отправка в текущий чат
// (tweb sendMessageWithDocument; у нас — колбэк onPick тем же путём, что
// onPickGif Composer'а). На узком экране выбор закрывает панель (tweb
// mediaSizes.isMobile → appSidebarRight.onCloseBtnClick()).
import { useRef, useState } from 'react'
import { openPopup } from '../../stores/popupStore'
import useMediaQuery from '../../shared/lib/useMediaQuery'
import { useGifsSearch } from '../../core/hooks/useGifsSearch'
import type { GifItem } from '../../core/gifs'
import GifsMasonry, { useGifsMasonryVisibility } from '../GifsMasonry'
import RightSearchTab, { RIGHT_SEARCH_POPUP_KIND, RightSearchPopup } from './RightSearchTab'

export default function GifsSearchTab({
  onPick,
  onClose,
}: {
  /** отправка выбранной гифки в текущий чат (проводка — как onPickGif Composer'а) */
  onPick?: (g: GifItem) => void
  onClose: () => void
}) {
  const narrow = useMediaQuery('(max-width:900px)')
  const [query, setQuery] = useState('')
  const { items, loadMore } = useGifsSearch(query)
  const scrollRef = useRef<HTMLDivElement>(null)
  const { visible, register } = useGifsMasonryVisibility(scrollRef)

  const pick = (g: GifItem) => {
    onPick?.(g)
    // мобильный tweb закрывает правую колонку после отправки (gifs.tsx:80-82)
    if (narrow) onClose()
  }

  return (
    <RightSearchTab
      id="search-gifs-container"
      placeholder="SearchGIFs"
      value={query}
      onChange={setQuery}
      onClose={onClose}
      onScrolledBottom={loadMore}
      scrollRef={scrollRef}
    >
      <GifsMasonry items={items} visible={visible} onPick={pick} register={register} />
      {/* пустой div после кладки — как в живом DOM (хвост tweb Scrollable) */}
      <div />
    </RightSearchTab>
  )
}

/**
 * Публичный путь открытия экрана извне (кнопка-лупа футера GIF-вкладки
 * дропдауна — проводка за оркестратором): тот же императивный механизм, что у
 * остальных «вкладок слайдера правой колонки» — openPopup c instant-контрактом
 * (см. useChatPopups: openAddContact/openEditContact). kind делает экраны
 * поиска одиночными: открытие второго закрывает первый — как замена вкладки
 * в слайдере tweb (обёртка RightSearchPopup снимает закрытый со стека).
 */
export function openGifsSearchTab(opts: { onPick?: (g: GifItem) => void }) {
  return openPopup(
    (p) => (
      <RightSearchPopup api={p}>
        <GifsSearchTab onPick={opts.onPick} onClose={p.destroy} />
      </RightSearchPopup>
    ),
    RIGHT_SEARCH_POPUP_KIND,
  )
}
