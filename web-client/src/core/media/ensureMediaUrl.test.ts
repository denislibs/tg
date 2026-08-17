// ensureMediaUrl — единственная точка входа императивного кода за URL медиа.
//
// Проверяем ровно те свойства, ради которых точка входа и заведена одна:
// синхронное попадание в зеркало не ходит в сеть, промах ходит к владельцу и
// ОБЯЗАТЕЛЬНО применяет ответ к зеркалу (иначе URL, который у воркера уже был,
// не увидит никто, кроме спросившего), кадр владельца доезжает подпиской, а
// смерть зоны актуальности вызывающего отменяет доставку — но не снимок.
//
// Модульное состояние живёт в модулях (зеркало core/mediaCache, склейка
// inflight), поэтому каждый кейс поднимает свежий реестр (vi.resetModules) и
// импортирует оба модуля ПОСЛЕ сброса — как в core/mediaUrl.test.ts.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getMiddleware } from '@helpers/middleware'

const { downloadMediaURL } = vi.hoisted(() => ({
  downloadMediaURL: vi.fn<(id: number, opts?: { thumb?: boolean }) => Promise<string>>(),
}))
vi.mock('../../client/bootstrap', () => ({
  startClient: () => ({ managers: { media: { downloadMediaURL } } }),
}))

let mod: typeof import('./ensureMediaUrl')
let cache: typeof import('../mediaCache')

// Управляемый ответ владельца: тест сам решает, когда он приземлится.
function deferred() {
  let resolve!: (url: string) => void
  let reject!: (err: unknown) => void
  const promise = new Promise<string>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

const flush = () => new Promise<void>((r) => { setTimeout(r, 0) })

beforeEach(async () => {
  vi.resetModules()
  downloadMediaURL.mockReset()
  mod = await import('./ensureMediaUrl')
  cache = await import('../mediaCache')
})

describe('ensureMediaUrl', () => {
  it('попадание в зеркало отдаёт URL синхронно и в сеть не ходит', async () => {
    cache.applyMediaUrl({ id: 7, thumb: false, url: 'blob:hit' })

    await expect(mod.ensureMediaUrl(7)).resolves.toBe('blob:hit')
    expect(downloadMediaURL).not.toHaveBeenCalled()
  })

  // Ключевой кейс: ответ RPC — ЕДИНСТВЕННЫЙ канал для URL, который у воркера
  // уже был (rt:media_url публикуется только при СОЗДАНИИ URL, а
  // SuperMessagePort кадры не буферизует). Не применить его к зеркалу — значит
  // потерять факт для всех остальных потребителей того же id.
  it('промах: RPC к владельцу, ответ применён к зеркалу, URL отдан вызывающему', async () => {
    downloadMediaURL.mockResolvedValue('blob:full')

    await expect(mod.ensureMediaUrl(7)).resolves.toBe('blob:full')
    expect(downloadMediaURL).toHaveBeenCalledWith(7, { thumb: false })
    expect(cache.cachedMediaUrl(7)).toBe('blob:full')
  })

  it('thumb — отдельный ключ зеркала и отдельный запрос', async () => {
    downloadMediaURL.mockResolvedValue('blob:thumb')

    await expect(mod.ensureMediaUrl(7, { thumb: true })).resolves.toBe('blob:thumb')
    expect(downloadMediaURL).toHaveBeenCalledWith(7, { thumb: true })
    expect(cache.cachedMediaUrl(7, true)).toBe('blob:thumb')
    expect(cache.cachedMediaUrl(7, false)).toBeUndefined()
  })

  // Гонка «кадр против ответа»: rt:media_url от нашего же запроса уже применён
  // проектором, а RPC-ответ ещё летит — ждать его незачем.
  it('поздний приход кадром: подписка на зеркало отдаёт URL, не дожидаясь ответа RPC', async () => {
    const d = deferred()
    downloadMediaURL.mockReturnValue(d.promise)

    const promise = mod.ensureMediaUrl(7)
    cache.applyMediaUrl({ id: 7, thumb: false, url: 'blob:from-frame' }) // проектор, кадр rt:media_url

    await expect(promise).resolves.toBe('blob:from-frame')
    d.resolve('blob:from-frame')
  })

  it('отмена по middleware: доставка отклонена, а поздний ответ вызывающего не воскрешает', async () => {
    const d = deferred()
    downloadMediaURL.mockReturnValue(d.promise)

    const helper = getMiddleware()
    const seen: string[] = []
    const outcome = mod.ensureMediaUrl(7, { middleware: helper.get() })
      .then((url) => { seen.push(url); return 'resolved' }, (err: { type?: string }) => err.type)

    helper.clean()
    expect(await outcome).toBe('MIDDLEWARE')

    d.resolve('blob:late')
    await flush()
    expect(seen).toEqual([])
    // …но снимок владельца зеркало получило: URL не становится неверным оттого,
    // что спросивший его бабл успел умереть — следующий потребитель того же id
    // возьмёт его синхронно, без второго round-trip'а.
    expect(cache.cachedMediaUrl(7)).toBe('blob:late')
  })

  it('мёртвый middleware на входе: к владельцу не ходим вовсе', async () => {
    const helper = getMiddleware()
    const middleware = helper.get()
    helper.clean()

    await expect(mod.ensureMediaUrl(7, { middleware })).rejects.toMatchObject({ type: 'MIDDLEWARE' })
    expect(downloadMediaURL).not.toHaveBeenCalled()
  })

  // Лента открывает десятки баблов разом, альбом — до десяти картинок одного
  // сообщения: без склейки это столько же одинаковых RPC.
  it('склейка: два потребителя одного ключа — один запрос к владельцу', async () => {
    const d = deferred()
    downloadMediaURL.mockReturnValue(d.promise)

    const a = mod.ensureMediaUrl(7)
    const b = mod.ensureMediaUrl(7)
    d.resolve('blob:one')

    expect(await a).toBe('blob:one')
    expect(await b).toBe('blob:one')
    expect(downloadMediaURL).toHaveBeenCalledTimes(1)
  })

  it('склейка снимается по завершении: следующий промах спрашивает владельца заново', async () => {
    downloadMediaURL.mockRejectedValueOnce(new Error('404'))
    await expect(mod.ensureMediaUrl(7)).rejects.toThrow('404')

    downloadMediaURL.mockResolvedValueOnce('blob:retry')
    await expect(mod.ensureMediaUrl(7)).resolves.toBe('blob:retry')
    expect(downloadMediaURL).toHaveBeenCalledTimes(2)
  })

  // Ошибка обязана доехать: на ней враппер вешает manual-кольцо прелоадера
  // (tweb wrapPhoto → preloader.setManual), а не остаётся в вечном ожидании.
  it('ошибка владельца доезжает до вызывающего', async () => {
    downloadMediaURL.mockRejectedValue(new Error('network'))
    await expect(mod.ensureMediaUrl(7)).rejects.toThrow('network')
  })
})
