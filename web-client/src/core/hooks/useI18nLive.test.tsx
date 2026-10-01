/**
 * ПИН НА СНИМОК ПЕРЕВОДЧИКА в хуках (задача 8).
 *
 * Ради этого места задача и заводилась, а держалось оно одним комментарием:
 * ревьюер вернул `useI18nStore.getState().t` в тело хука — 4228 тестов
 * остались зелёными, `tsc` чистым. `useChatHeaderSearch` читает язык НА
 * РЕНДЕРЕ, поэтому ему нужна ПОДПИСКА (`useT`): со снимком плашка «Избранное»
 * в поиске остаётся на прежнем языке до перемонтирования панели.
 *
 * Второе место — `useSidebarActions` (название группы без имени, уезжавшее на
 * сервер) — снесено вместе с React-экраном «Новой группы» (0а-2 волны 7): у
 * вкладки tweb группа без названия не создаётся вовсе.
 *
 * Проверяется одно: СМЕНИЛ ЯЗЫК → хук отдаёт новый текст БЕЗ перемонтирования.
 */
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, cleanup } from '@testing-library/react'

import type { Managers } from '@/client/bootstrap'
import { ManagersProvider } from '@core/hooks/useManagers'
import { applyLang } from '@/test/lang'
import { useChatsStore } from '@/stores/chatsStore'
import { useChatHeaderSearch } from './useChatHeaderSearch'

// Соседние хуки — ШОВ, а не предмет: они ходят в воркер за выдачей поиска и за
// карточками пиров, а проверяется здесь подпись на языке пользователя.
vi.mock('./useChatSearch', () => ({
  useMessageSearchLoader: () => ({ messages: [], peerIds: [], count: 0, totalCount: 0, loading: false }),
  useSenderSearchLoader: () => ({ peerIds: [], count: 0, loading: false }),
}))
vi.mock('./usePeers', () => ({ usePeers: () => new Map() }))

const managers = {
  messages: { getSavedTags: vi.fn(async () => []) },
} as unknown as Managers

const wrapper = ({ children }: { children: ReactNode }) => (
  <ManagersProvider managers={managers}>{children}</ManagersProvider>
)

/**
 * Смена языка. Продуктовый путь (`setLang` → `I18n.getLangPackAndApply`) сюда не
 * годится: он спрашивает пакет у ВОРКЕРА, которого в прогоне нет, и вернул бы
 * английский. Применяется тот же самый вход, что и в бою (`applyLangPack` со
 * слиянием), только пакет собран из файлов — см. `@/test/lang`.
 */
async function switchTo(lang: string) {
  await act(async () => { await applyLang(lang) })
}

beforeEach(async () => {
  await switchTo('en')
})

afterEach(async () => {
  cleanup()
  await switchTo('en')
})

describe('useChatHeaderSearch: подпись фильтра «Избранное» — с подпиской', () => {
  it('язык сменили при открытом поиске — плашка перерисовалась без перемонтирования', async () => {
    useChatsStore.setState({ meId: 777 })
    // Чат НЕ «Избранное» (id ≠ meId) намеренно: у своего чата хук идёт за
    // тегами, и ответ менеджера, доехав во время смены языка, перерисовал бы
    // панель САМ — тогда проверка зеленела бы и без подписки на язык, то есть
    // не проверяла бы ничего. Фильтр по себе при этом остаётся: подпись
    // «Избранное» даёт `filterPeerId === meId`, а не сам чат.
    const { result } = renderHook(() => useChatHeaderSearch({ id: '5' } as never, () => {}), { wrapper })

    act(() => { result.current.setFilterPeerId(777) })
    expect(result.current.filterPeerName).toBe('Saved Messages')

    await switchTo('ru')

    expect(result.current.filterPeerName).toBe('Избранное')
  })
})
