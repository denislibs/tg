/**
 * ПИН НА СНИМОК ПЕРЕВОДЧИКА в хуках (задача 8).
 *
 * Ради этих двух мест задача и заводилась, а держались они одним комментарием:
 * ревьюер вернул `useI18nStore.getState().t` в тело обоих хуков — 4228 тестов
 * остались зелёными, `tsc` чистым. Дефект при этом настоящий и разный по виду:
 *
 *  • `useChatHeaderSearch` читает язык НА РЕНДЕРЕ, поэтому ему нужна ПОДПИСКА
 *    (`useT`): со снимком плашка «Избранное» в поиске остаётся на прежнем языке
 *    до перемонтирования панели;
 *  • `useSidebarActions` ничего не рисует, поэтому подписка ему не нужна, но
 *    снимок В МОМЕНТ МОНТИРОВАНИЯ там ещё хуже: название группы, созданной без
 *    имени, УЕЗЖАЕТ НА СЕРВЕР и остаётся у всех участников на языке, который
 *    стоял при открытии сайдбара.
 *
 * Проверяется в обоих случаях одно: СМЕНИЛ ЯЗЫК → хук отдаёт новый текст БЕЗ
 * перемонтирования.
 */
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, cleanup } from '@testing-library/react'

import type { Managers } from '@/client/bootstrap'
import { ManagersProvider } from '@core/hooks/useManagers'
import { loadLang, useI18nStore } from '@/i18n'
import { useChatsStore } from '@/stores/chatsStore'
import { useSidebarActions } from './useSidebarActions'
import { useChatHeaderSearch } from './useChatHeaderSearch'

// Соседние хуки — ШОВ, а не предмет: они ходят в воркер за выдачей поиска и за
// карточками пиров, а проверяется здесь подпись на языке пользователя.
vi.mock('./useChatSearch', () => ({
  useMessageSearchLoader: () => ({ messages: [], peerIds: [], count: 0, totalCount: 0, loading: false }),
  useSenderSearchLoader: () => ({ peerIds: [], count: 0, loading: false }),
}))
vi.mock('./usePeers', () => ({ usePeers: () => new Map() }))

const managers = {
  groups: { createGroup: vi.fn(async () => 42) },
  channels: { createChannel: vi.fn(async () => 43) },
  messages: { getSavedTags: vi.fn(async () => []) },
} as unknown as Managers

const wrapper = ({ children }: { children: ReactNode }) => (
  <ManagersProvider managers={managers}>{children}</ManagersProvider>
)

/** Смена языка так, как её делает экран выбора языка. */
async function switchTo(lang: string) {
  await act(async () => {
    useI18nStore.getState().setLang(lang)
    await loadLang(lang)
  })
}

beforeEach(async () => {
  await switchTo('en')
  vi.mocked(managers.groups.createGroup).mockClear()
})

afterEach(async () => {
  cleanup()
  await switchTo('en')
})

describe('useSidebarActions: название по умолчанию — на языке МОМЕНТА ВЫЗОВА', () => {
  it('язык сменили при открытом сайдбаре — на сервер уезжает новое название', async () => {
    const { result } = renderHook(() => useSidebarActions([]), { wrapper })

    await switchTo('ru')
    await act(async () => { await result.current.createGroup('', [], null) })

    // Хук НЕ перемонтирован — тот же `result.current`, что и до смены языка.
    expect(managers.groups.createGroup).toHaveBeenCalledWith({ title: 'Новая группа', memberIds: [] })
  })
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
