/** @jsxImportSource solid-js */
/**
 * Пины `SignImportCard.solid.tsx` (Solid-порт нашей React
 * `cards/SignImportCard.tsx`, которая сама — порт tweb
 * `pages/cards/SignImportCard.tsx`, 80 строк).
 *
 * Карточка живёт доли секунды: на монтировании кладётся прелоадер и сразу
 * уходит обмен `webAuthToken` на сессию (`managers.auth.signImport`) — ровно
 * ОДИН раз, три исхода: сессия → `toIm()`, `passwordNeeded` → `navigate`
 * на `password` с `token`/`hint`, отказ → назад на `signIn`.
 *
 * ── Особое внимание задачи 5: зачистка адреса — ЕДИНСТВЕННЫЙ писатель истории ──
 * `appNavigationController.overrideHash('')` — тот же приём и та же причина,
 * что были у React-версии (задача 4, ОСТАТОК #108): перезагрузка не должна
 * снова тащить сгоревший токен в этот же экран, и делает это ИМЕННО
 * контроллер, а не `history.replaceState` мимо него (запись с чужим `id` не
 * опознаётся его же `_onPopState`). Мокаем модуль и проверяем факт вызова.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render } from 'solid-js/web'
import type { Managers } from '@/client/bootstrap'
import { AuthFlowContext, type AuthFlowContextValue } from '../authFlow.solid'
import SignImportCard from './SignImportCard.solid'

const overrideHash = vi.hoisted(() => vi.fn())
vi.mock('@core/navigation/appNavigationController', () => ({
  default: { overrideHash },
}))

let dispose: (() => void) | undefined
let host: HTMLDivElement | undefined

afterEach(() => {
  dispose?.()
  host?.remove()
  dispose = undefined
  host = undefined
  overrideHash.mockClear()
  location.hash = ''
})

function mount(signImport: ReturnType<typeof vi.fn>, webAuthToken = 'wt-1') {
  const navigate = vi.fn()
  const toIm = vi.fn().mockResolvedValue(undefined)
  const managers = { auth: { signImport } } as unknown as Managers
  const ctx: AuthFlowContextValue = {
    managers,
    current: () => null,
    navigate,
    back: async () => {},
    toIm,
  }

  host = document.createElement('div')
  document.body.append(host)
  dispose = render(
    (() => (
      <AuthFlowContext.Provider value={ctx}>
        <SignImportCard spec={{ name: 'signImport', payload: { webAuthToken } }} />
      </AuthFlowContext.Provider>
    )) as () => never,
    host,
  )

  return { navigate, toIm }
}

describe('SignImportCard.solid: обмен веб-токена на сессию', () => {
  it('на монтировании кладёт прелоадер и зовёт signImport(webAuthToken) РОВНО ОДИН раз', async () => {
    const signImport = vi.fn().mockResolvedValue({ user: {} })
    mount(signImport, 'wt-42')

    expect(host!.querySelector('.preloader')).not.toBeNull()
    await vi.waitFor(() => expect(signImport).toHaveBeenCalledWith('wt-42', 'web', 'browser'))
    expect(signImport).toHaveBeenCalledTimes(1)
  })

  it('успех — toIm()', async () => {
    const signImport = vi.fn().mockResolvedValue({ user: {} })
    const { toIm } = mount(signImport)

    await vi.waitFor(() => expect(toIm).toHaveBeenCalled())
  })

  it('passwordNeeded — переход на password с token/hint', async () => {
    const signImport = vi.fn().mockResolvedValue({ passwordNeeded: true, passwordToken: 't1', hint: 'h1' })
    const { navigate } = mount(signImport)

    await vi.waitFor(() =>
      expect(navigate).toHaveBeenCalledWith({ name: 'password', payload: { token: 't1', hint: 'h1' } }),
    )
  })

  it('отказ сервера — назад на signIn', async () => {
    const signImport = vi.fn().mockResolvedValue({ error: 'web_auth_token_invalid' })
    const { navigate } = mount(signImport)

    await vi.waitFor(() => expect(navigate).toHaveBeenCalledWith({ name: 'signIn' }))
  })
})

describe('SignImportCard.solid: зачистка адреса — appNavigationController, единственный писатель истории', () => {
  it('хеш есть — overrideHash(\'\') зовётся ДО навигации дальше', async () => {
    location.hash = '#?tgWebAuthToken=wt-1'
    const signImport = vi.fn().mockResolvedValue({ user: {} })
    mount(signImport)

    await vi.waitFor(() => expect(overrideHash).toHaveBeenCalledWith(''))
  })

  it('хеша нет — overrideHash НЕ зовётся (нечего чистить)', async () => {
    location.hash = ''
    const signImport = vi.fn().mockResolvedValue({ user: {} })
    const { toIm } = mount(signImport)

    await vi.waitFor(() => expect(toIm).toHaveBeenCalled())
    expect(overrideHash).not.toHaveBeenCalled()
  })
})

describe('SignImportCard.solid: сетевой отказ — НЕ вечный прелоадер (находка 1 ревью задачи 5)', () => {
  // authManager.signImport перебрасывает НЕ-HttpError наружу (обрыв сети,
  // отказ worker-RPC) — `.then()` без `.catch()` оставлял бы такой отказ
  // необработанным отклонением, а карточку — навечно с прелоадером и
  // невычищенным хешем (перезагрузка тащит тот же мёртвый экран назад).
  // Оригинал (tweb SignImportCard.tsx:53-66, ветка `default:`) на ЛЮБОЙ
  // ошибке уходит на дефолтный экран входа.
  it('signImport() отклонился — карточка уходит на signIn, а не остаётся с прелоадером навечно', async () => {
    const signImport = vi.fn().mockRejectedValue(new Error('network down'))
    const { navigate } = mount(signImport)

    await vi.waitFor(() => expect(navigate).toHaveBeenCalledWith({ name: 'signIn' }))
  })

  it('отклонение ПРИ непустом хеше — адрес всё равно вычищен (не только путь успеха)', async () => {
    location.hash = '#?tgWebAuthToken=wt-1'
    const signImport = vi.fn().mockRejectedValue(new Error('network down'))
    mount(signImport)

    await vi.waitFor(() => expect(overrideHash).toHaveBeenCalledWith(''))
  })
})
