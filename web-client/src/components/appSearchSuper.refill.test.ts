// Бесконечная догрузка профиля — B8 в `docs/tweb/delta/security-and-bugs.md`,
// порт tweb fb18166dc (`ScrollableRefiller`).
//
// Механика ловушки: `Scrollable.checkForTriggers` зовёт `onScrolledBottom`
// ВСЯКИЙ раз, когда список не переполнен (`scrollSize === clientSize` →
// `maxScrollPosition - scrollPosition` равно 0, что всегда в пределах
// `onScrollOffset`). Это нарочно — так добирается первая страница короче
// экрана. А `AppSearchSuper` после КАЖДОЙ загрузки снова звал
// `checkForTriggers` из `finally`, и у вкладки `savedDialogs` флаг `loaded`
// не ставится никогда (`canLoadMediaTab` для неё истинен всегда). Итог — цикл
// `load` → `checkForTriggers` → `onScrolledBottom` → `load` без участия
// пользователя; у tweb замерено ~9300 вызовов в секунду.
//
// Зависимости настоящие: живой `Scrollable` (его `checkForTriggers` и есть
// половина ловушки) и живой класс с Solid-вкладкой «Чаты». Геометрию, которой
// в happy-dom нет, задаём ЗНАЧЕНИЯМИ: список высотой ровно в окно.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Scrollable from '@components/scrollable'
import AppSearchSuper, { type SearchSuperManagers, type SearchSuperMediaTab } from '@components/appSearchSuper'
import { getHistoryStorage, resetSharedMediaHistories } from '@components/sharedMediaHistories'
import { makeMessage } from '@core/messages/testMessage'
import { saveMessageMedia } from '@core/media/messageMedia'
import type { SearchHistoryOptions } from '@core/managers/messagesManager'
import type { MyMessage } from '@core/models'
import type { LangPackKey } from '@lib/langPack'
import { useChatsStore } from '@stores/chatsStore'

// `usePeer` строки «Чатов» объявляет пробел зеркала через `startClient()`;
// фабрика в happy-dom подняла бы воркер — гасим.
vi.mock('@/client/bootstrap', () => ({
  startClient: () => ({ managers: { peers: { fillMirror: async () => {} } } }),
}))

const ME: PeerId = 7

/** Фотография — то, что попадает во вкладку `media` (`inputMessagesFilterPhotoVideo`). */
const photo = (id: number): MyMessage => makeMessage({
  id, peerId: ME, fromId: ME,
  media: saveMessageMedia({ _: 'messageMediaPhoto', photo: { _: 'photo', id, sizes: [] } }),
})

/** Курсорная ручка `/chats/{id}/media`, как в `appSearchSuper.load.test.ts`: страница строго ниже `offset_id`. */
function fakeBackend(media = 0) {
  const all = Array.from({ length: media }, (_, i) => photo(media - i))
  const managers = {
    messages: {
      searchHistory: async ({ offsetId = 0, limit = 30 }: SearchHistoryOptions) => {
        const from = offsetId ? all.filter((m) => m.id < offsetId) : all
        return { messages: from.slice(0, limit), count: all.length }
      },
      searchCounters: async (_peerId: number, filters: string[]) => filters.map((filter) => ({ filter, count: all.length })),
    },
    peers: { fillMirror: async () => {} },
    stars: { profileGifts: async () => [] },
    chats: { savedDialogs: async () => [] },
    presence: { get: async () => [] },
  } as unknown as SearchSuperManagers
  return { managers }
}

/** Список ровно в высоту окна — измеренное у tweb состояние сайдбара: 768 против 768. */
function build(managers: SearchSuperManagers, mediaTabs: SearchSuperMediaTab[]) {
  const scrollableEl = document.createElement('div')
  document.body.append(scrollableEl)
  const scrollable = new Scrollable(scrollableEl)
  Object.defineProperty(scrollable.container, 'scrollHeight', { value: 768, configurable: true })
  Object.defineProperty(scrollable.container, 'clientHeight', { value: 768, configurable: true })
  const host = document.createElement('div')
  host.className = 'profile-content'
  scrollable.container.append(host)

  // `loadFirstTime` выключен: какая вкладка открывается первой — предмет
  // `firstTime.test.ts`; здесь первой стоит та, что нужна тесту.
  const searchSuper = new AppSearchSuper({ mediaTabs, scrollable, managers, hideEmptyTabs: false })
  host.append(searchSuper.container)
  searchSuper.setQuery({ peerId: ME, historyStorage: getHistoryStorage(ME) })

  // считаем там же, где tweb e2e: у `AppSearchSuper.load` — это тот вызов,
  // который цикл и множил
  let loads = 0
  const original = searchSuper.load.bind(searchSuper)
  searchSuper.load = (...args: Parameters<AppSearchSuper['load']>) => {
    ++loads
    return original(...args)
  }

  return { searchSuper, scrollable, getLoads: () => loads }
}

/** Дать отработать цепочке макрозадач: каждое звено — `setTimeout(0)`. */
async function idle(ticks = 30) {
  for(let i = 0; i < ticks; ++i) {
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

const SAVED_DIALOGS: SearchSuperMediaTab = { type: 'savedDialogs', name: 'FilterChats' as LangPackKey }
const MEDIA: SearchSuperMediaTab = { type: 'media', inputFilter: 'inputMessagesFilterPhotoVideo', name: 'SharedMediaTab2' as LangPackKey }

beforeEach(() => {
  resetSharedMediaHistories()
  useChatsStore.setState({ meId: ME, dialogs: [] })
})
afterEach(() => document.body.replaceChildren())

describe('AppSearchSuper: догрузка после загрузки не зацикливается (tweb fb18166dc)', () => {
  it('вкладка «Чаты» Избранного в неполном окне успокаивается после одной проверки', async () => {
    const { managers } = fakeBackend()
    const { searchSuper, getLoads } = build(managers, [{ ...SAVED_DIALOGS }, { ...MEDIA }])

    await searchSuper.load(true)
    await idle()
    const settled = getLoads()
    await idle()

    // первая загрузка — та, что попросили; вторая — единственная проверка
    // «экран уже полон?». Дальше вкладка молчит: прогресса у неё нет
    // (фильтра сообщений нет), новой проверки не будет
    expect(settled).toBeLessThanOrEqual(2)
    expect(getLoads()).toBe(settled)
  })

  it('медиа-вкладка в неполном окне догружает и дорисовывает всё до конца выдачи', async () => {
    // первая страница короче выдачи, дальше предзагрузка `justLoad` (50) растит
    // кэш БЕЗ отрисовки — его хвост дорисовывает именно цепочка проверок
    const { managers } = fakeBackend(100)
    const { searchSuper, getLoads } = build(managers, [{ ...MEDIA }])

    await searchSuper.load(true)
    await idle(100)
    const settled = getLoads()
    await idle()

    expect(searchSuper.historyStorage.inputMessagesFilterPhotoVideo).toHaveLength(100)
    // всё приехавшее отрисовано: цепочку ведёт прогресс, и она не рвётся раньше конца
    expect(searchSuper.usedFromHistory.inputMessagesFilterPhotoVideo).toBe(100)
    expect(getLoads()).toBe(settled)
  })
})
