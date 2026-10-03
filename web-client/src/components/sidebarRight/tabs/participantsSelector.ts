/**
 * Порт tweb `src/components/sidebarRight/tabs/participantsSelector.ts:1-33`
 * (812502980) — селектор строк для вкладок участников правой колонки (0б-7
 * волны 7: администраторы, участники, удалённые, заявки): `AppSelectPeers` без
 * мультивыбора, с полем поиска, промис первой отрисовки.
 *
 * Расхождение одно: `headerSearch` (:15) не передаётся — у нашего селектора
 * этой опции нет, а у оригинала она лишь пишется в поле и не читается
 * (`appSelectPeers.tsx:225`).
 */
import { createRoot } from 'solid-js'
import deferredPromise from '@helpers/cancellablePromise'
import AppSelectPeers from '@components/appSelectPeers.solid'

export function createSelectorForTab(options: ConstructorParameters<typeof AppSelectPeers>[0]) {
  const deferred = deferredPromise<void>()
  let selector!: AppSelectPeers
  createRoot((dispose) => {
    options.middleware.onClean(() => {
      dispose()
      deferred.resolve!()
    })
    selector = new AppSelectPeers({
      ...options,
      multiSelect: false,
      placeholder: 'SearchPlaceholder',
      meAsSaved: false,
      onFirstRender: () => {
        deferred.resolve!()
      },
    })
  })

  return { selector, loadPromise: deferred }
}

export function createSelectorForParticipants(options: ConstructorParameters<typeof AppSelectPeers>[0]) {
  return createSelectorForTab({ ...options, peerType: ['channelParticipants'] })
}
