// Путь tweb (`@helpers/mediaSizes`), по которому mediaSizes импортируют
// вендорные островки (медиавьювер `components/mediaViewer/base.ts`, lottie
// `lib/lottie/lottiePlayer.ts`) — ровно как в оригинале.
//
// Своей реализации здесь БОЛЬШЕ НЕТ: до порта тут жил обрезанный класс с
// собственным `isMobile` (`window.innerWidth <= 600`) — второй владелец того же
// факта. Полный порт tweb `helpers/mediaSizes.ts` (активный набор размеров +
// `changeScreen`/`resize`) лежит в `core/dom/mediaSizes.ts`, вместе с
// `setAttachmentSize`; здесь только ре-экспорт того же инстанса.
// `setAttachmentSize` в tweb — отдельный модуль `@helpers/setAttachmentSize`,
// у нас он лежит в том же `core/dom/mediaSizes.ts`; вендорным островкам он
// нужен так же (вьювер считает бокс им, tweb mediaViewer/base.ts:2465).
import { createStore } from 'solid-js/store'
import mediaSizesInstance, { ScreenSize as Screen } from '@core/dom/mediaSizes'

export { MediaSizes, ScreenSize, setAttachmentSize, default } from '@core/dom/mediaSizes'

// Solid-стор оригинала (`createStore` + `useMediaSizes()`, tweb mediaSizes.ts:46-52,
// :157-163, :196-198): у нас он собран здесь, поверх событий того же инстанса, а
// не внутри класса — `core/dom/mediaSizes.ts` читают и невизуальные пути (шапка
// файла). Стор заводится лениво на первом вызове; потребитель — поиск по чату
// (`components/chat/topbarSearch.solid.tsx`, tweb `topbarSearch.tsx:363`).

type MediaSizesStore = {
  isMobile: boolean,
  isFloatingLeftSidebar: boolean,
  activeScreen: Screen
}

let store: MediaSizesStore | undefined
export function useMediaSizes(): MediaSizesStore {
  if(!store) {
    const read = (): MediaSizesStore => ({
      isMobile: mediaSizesInstance.isMobile,
      isFloatingLeftSidebar: mediaSizesInstance.isFloatingLeftSidebar,
      activeScreen: mediaSizesInstance.activeScreen,
    })
    const [s, setStore] = createStore<MediaSizesStore>(read())
    mediaSizesInstance.addEventListener('changeScreen', () => setStore(read()))
    mediaSizesInstance.addEventListener('resize', () => setStore(read()))
    store = s
  }

  return store
}
