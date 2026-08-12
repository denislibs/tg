// Task 7 (медиа-суперпорт, стадия C): хук потребления факта «URL медиа».
// Контракт: синхронное чтение зеркала (cachedMediaUrl) на рендере — повторный
// маунт того же id рисует картинку БЕЗ сети и БЕЗ мигания (джиттер ленты не
// возвращаем); промах зеркала → RPC downloadMediaURL к владельцу; поздний ответ
// протухшей сущности не пишется (@helpers/middleware); кадр rt:media_url двигает
// подписчиков (useSyncExternalStore по образцу useMediaTokenVersion).
//
// Зеркало (core/mediaCache.ts) — модульное состояние, поэтому каждый кейс
// начинается с resetMediaUrlMirror() (в тестах это допустимо — скан-пин
// noDuplicateMediaUrl.test.ts исходники *.test.* не считает).
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { ManagersProvider } from './useManagers'
import { useMediaUrl } from './useMediaUrl'
import { applyMediaUrl, cachedMediaUrl, resetMediaUrlMirror } from '../mediaCache'
import type { Managers } from '../../client/bootstrap'

const downloadMediaURL = vi.fn<(id: number, opts?: { thumb?: boolean }) => Promise<string>>()
const managers = { media: { downloadMediaURL } } as unknown as Managers
const wrapper = ({ children }: { children: ReactNode }) => (
  <ManagersProvider managers={managers}>{children}</ManagersProvider>
)

beforeEach(() => {
  cleanup()
  resetMediaUrlMirror()
  downloadMediaURL.mockReset()
})

describe('useMediaUrl — синхронное зеркало + RPC к владельцу на промахе', () => {
  it('промах зеркала → RPC downloadMediaURL → URL владельца', async () => {
    downloadMediaURL.mockResolvedValue('blob:full-7')

    const { result } = renderHook(() => useMediaUrl(7), { wrapper })
    expect(result.current).toBe('') // подложка, пока факт не объявлен

    await act(async () => {})
    expect(downloadMediaURL).toHaveBeenCalledWith(7, { thumb: false })
    expect(result.current).toBe('blob:full-7')
  })

  it('thumb — отдельный факт: и в RPC, и в зеркале', async () => {
    downloadMediaURL.mockResolvedValue('blob:thumb-7')

    const { result } = renderHook(() => useMediaUrl(7, { thumb: true }), { wrapper })
    await act(async () => {})

    expect(downloadMediaURL).toHaveBeenCalledWith(7, { thumb: true })
    expect(result.current).toBe('blob:thumb-7')
    expect(cachedMediaUrl(7, false)).toBeUndefined()
  })

  // Главное требование задачи: повторный рендер того же id — синхронно из
  // зеркала, без сети и без кадра-«мигания» (джиттер ленты не возвращаем).
  it('повторный маунт того же id: URL синхронно ПЕРВЫМ же рендером, RPC не зовётся повторно', async () => {
    downloadMediaURL.mockResolvedValue('blob:full-9')
    const first = renderHook(() => useMediaUrl(9), { wrapper })
    await act(async () => {})
    expect(first.result.current).toBe('blob:full-9')
    first.unmount()
    downloadMediaURL.mockClear()

    const renders: string[] = []
    const second = renderHook(
      () => {
        const url = useMediaUrl(9)
        renders.push(url)
        return url
      },
      { wrapper },
    )
    await act(async () => {})

    expect(second.result.current).toBe('blob:full-9')
    // ни одного рендера с подложкой — мигания нет
    expect(renders.every((u) => u === 'blob:full-9')).toBe(true)
    expect(downloadMediaURL).not.toHaveBeenCalled()
  })

  it('null id: RPC не зовётся, наружу пустая строка', async () => {
    const { result } = renderHook(() => useMediaUrl(null), { wrapper })
    await act(async () => {})
    expect(result.current).toBe('')
    expect(downloadMediaURL).not.toHaveBeenCalled()
  })

  // Протухание по смене сущности (@helpers/middleware): ответ, пришедший после
  // смены id, принадлежит прошлому прогону эффекта — в зеркало не пишется.
  it('смена id: поздний ответ старого id не пишется в зеркало', async () => {
    const pend = new Map<number, (u: string) => void>()
    downloadMediaURL.mockImplementation((id) => new Promise((res) => pend.set(id, res)))

    const { result, rerender } = renderHook(({ id }: { id: number }) => useMediaUrl(id), {
      wrapper,
      initialProps: { id: 1 },
    })
    await act(async () => {})
    rerender({ id: 2 })
    await act(async () => { pend.get(1)!('blob:late-1') }) // ответ старого прогона

    expect(cachedMediaUrl(1)).toBeUndefined()
    expect(result.current).toBe('')

    await act(async () => { pend.get(2)!('blob:live-2') })
    expect(result.current).toBe('blob:live-2')
  })

  // Кадр rt:media_url (проектор → applyMediaUrl) двигает подписчиков: сценарий
  // «скачала другая вкладка/другой компонент» — свой RPC ещё летит, URL приезжает
  // кадром, и <img> пересобирается без ответа собственного запроса.
  it('applyMediaUrl (кадр rt:media_url) будит подписчика с висящим RPC', async () => {
    downloadMediaURL.mockReturnValue(new Promise(() => {})) // свой запрос завис

    const { result } = renderHook(() => useMediaUrl(5), { wrapper })
    await act(async () => {})
    expect(result.current).toBe('')

    act(() => { applyMediaUrl({ id: 5, thumb: false, url: 'blob:from-frame' }) })

    expect(result.current).toBe('blob:from-frame')
  })

  // Сброс зеркала (кадр rt:logging_out) обязан разбудить подписчиков: <img>
  // не должен держать отозванный blob:-URL прошлой сессии.
  it('resetMediaUrlMirror будит подписчиков — URL уходит в подложку', async () => {
    downloadMediaURL.mockResolvedValue('blob:gone')
    const { result } = renderHook(() => useMediaUrl(6), { wrapper })
    await act(async () => {})
    expect(result.current).toBe('blob:gone')
    downloadMediaURL.mockReturnValue(new Promise(() => {}))

    act(() => { resetMediaUrlMirror() })

    expect(result.current).toBe('')
  })
})
