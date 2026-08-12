// Task 6 (медиа-суперпорт, стадия C): воркерный конвейер download→cache→objectURL.
//
// Модель tweb apiFileManager.downloadMediaURL (apiFileManager.ts:1029-1045):
// кэш-контекст в памяти (storages/thumbs.ts: {downloaded, url}) → корзина
// CacheStorage → байты из сети; конкурентные запросы одного файла склеиваются
// инфлайт-промисом (downloadPromises). Здесь — юнит-уровень владельца: сеть и
// корзина фейковые, проверяются сами правила конвейера. Проводка воркера
// (веер rt:media_url, сброс на logout) — core/workerCore.mediaUrl.test.ts;
// стык с зеркалом витрины — client/realtime/storeProjection.mediaUrl.test.ts.
import { describe, expect, it, vi, afterEach } from 'vitest'
import { newMediaManager, type MediaUrlEvt } from './mediaManager'
import { MAX_FILE_SAVE_SIZE } from './constants'

// Blob с подменённым size — не аллоцировать 20 МиБ ради проверки порога.
class SizedBlob extends Blob {
  constructor(private _size: number) { super(['x']) }
  override get size(): number { return this._size }
}

// rest с байтовым каналом: getBlob можно придержать (hold) — тогда тест сам
// решает, когда какой запрос приземлится (answer), как в mediaManager.reset.test.ts.
function fakeRest() {
  const blobGets: string[] = []
  const pending: Array<() => void> = []
  let hold = false
  let payload: () => Blob = () => new Blob(['bytes'])
  const getBlob = vi.fn((path: string) => {
    blobGets.push(path)
    return new Promise<Blob>((resolve) => {
      const fire = () => resolve(payload())
      if (hold) pending.push(fire)
      else fire()
    })
  })
  return {
    rest: { post: vi.fn(), get: vi.fn(), putBytes: vi.fn(), contentUrl: (p: string) => '/api' + p, mediaUrl: (p: string, t: string) => '/api' + p + '?token=' + t, getBlob } as never,
    blobGets,
    hold: () => { hold = true },
    answer: () => { pending.shift()?.() },
    setPayload: (f: () => Blob) => { payload = f },
  }
}

// Корзина CacheStorage (контракт MediaFilesCache): Map-бэкенд, промах — reject,
// как makeError('NO_ENTRY_FOUND') у настоящего CacheStorageController.
function fakeFiles(initial: Record<string, Blob> = {}) {
  const store = new Map(Object.entries(initial))
  return {
    store,
    getFile: vi.fn(async (name: string): Promise<Blob> => {
      const b = store.get(name)
      if (!b) throw { type: 'NO_ENTRY_FOUND' }
      return b
    }),
    saveFile: vi.fn(async (name: string, blob: Blob): Promise<Blob> => { store.set(name, blob); return blob }),
    deleteAll: vi.fn(async (): Promise<boolean> => { store.clear(); return true }),
  }
}

// Микротаски внутренних .then/.finally менеджера.
const flush = () => new Promise<void>((r) => setTimeout(r, 0))

afterEach(() => { vi.restoreAllMocks() })

describe('mediaManager.downloadMediaURL — конвейер download→cache→objectURL', () => {
  it('повторный запрос того же id: один поход за байтами, тот же URL, одна публикация', async () => {
    const { rest, blobGets } = fakeRest()
    const files = fakeFiles()
    const published: MediaUrlEvt[] = []
    const mgr = newMediaManager({ rest, files, onMediaUrl: (e) => published.push(e) })

    const u1 = await mgr.downloadMediaURL(7)
    const u2 = await mgr.downloadMediaURL(7)

    expect(u1).toBe(u2)
    expect(u1).toMatch(/^blob:/)
    expect(blobGets).toEqual(['/media/7/content'])
    expect(published).toHaveLength(1)
    expect(published[0]).toMatchObject({ id: 7, thumb: false, url: u1 })
  })

  it('конкурентные запросы одного id склеиваются инфлайт-промисом в один поход', async () => {
    const { rest, blobGets, hold, answer } = fakeRest()
    const mgr = newMediaManager({ rest, files: fakeFiles() })
    hold()

    const p1 = mgr.downloadMediaURL(7)
    const p2 = mgr.downloadMediaURL(7)
    await flush() // промах корзины (async) доводит оба до байтового канала
    answer()

    expect(await p1).toBe(await p2)
    expect(blobGets).toEqual(['/media/7/content'])
  })

  it('thumb и полное медиа — разные записи: свои пути, ключи корзины и URL', async () => {
    const { rest, blobGets } = fakeRest()
    const files = fakeFiles()
    const mgr = newMediaManager({ rest, files })

    const full = await mgr.downloadMediaURL(7)
    const thumb = await mgr.downloadMediaURL(7, { thumb: true })
    await flush() // saveFile — fire-and-forget

    expect(full).not.toBe(thumb)
    expect(blobGets).toEqual(['/media/7/content', '/media/7/content?v=thumb'])
    expect(files.saveFile.mock.calls.map((c) => c[0])).toEqual(['media_7', 'media_7_thumb'])
  })

  it('промах контекста + попадание корзины (reload-симуляция) — URL без сети', async () => {
    const { rest, blobGets } = fakeRest()
    const files = fakeFiles({ media_7: new Blob(['cached']) })
    const mgr = newMediaManager({ rest, files })

    const url = await mgr.downloadMediaURL(7)

    expect(url).toMatch(/^blob:/)
    expect(blobGets).toEqual([])
    expect(files.getFile).toHaveBeenCalledWith('media_7')
    // и повторный запрос — уже из контекста, даже корзину не трогаем
    expect(await mgr.downloadMediaURL(7)).toBe(url)
    expect(files.getFile).toHaveBeenCalledTimes(1)
  })

  it('файл больше MAX_FILE_SAVE_SIZE в корзину не пишется, меньший — пишется', async () => {
    const { rest, setPayload } = fakeRest()
    const files = fakeFiles()
    const mgr = newMediaManager({ rest, files })

    setPayload(() => new SizedBlob(MAX_FILE_SAVE_SIZE + 1))
    await mgr.downloadMediaURL(1)
    await flush()
    expect(files.saveFile).not.toHaveBeenCalled()

    setPayload(() => new SizedBlob(MAX_FILE_SAVE_SIZE))
    await mgr.downloadMediaURL(2)
    await flush()
    expect(files.saveFile).toHaveBeenCalledTimes(1)
    expect(files.saveFile.mock.calls[0][0]).toBe('media_2')
  })

  it('resetDownloads: контекст пуст, objectURL отозваны, корзина стёрта', async () => {
    const { rest, blobGets } = fakeRest()
    const files = fakeFiles()
    const revoke = vi.spyOn(URL, 'revokeObjectURL')
    const mgr = newMediaManager({ rest, files })
    const url = await mgr.downloadMediaURL(7)
    await flush()

    mgr.resetDownloads()

    expect(revoke).toHaveBeenCalledWith(url)
    expect(files.deleteAll).toHaveBeenCalledTimes(1)
    // контекст и корзина пусты — свежий запрос идёт за байтами заново
    const again = await mgr.downloadMediaURL(7)
    expect(again).not.toBe(url)
    expect(blobGets).toEqual(['/media/7/content', '/media/7/content'])
  })

  // Гонка перехода сессии (по образцу fetchToken/tokenGen): скачивание улетело с
  // ПРЕЖНИМ session-токеном, ответ вернулся после перехода. Закэшируй его — и
  // владелец раздавал бы вкладкам медиа прошлого аккаунта.
  it('ответ, стартовавший до сброса, не кэшируется и не публикуется; звонящий получает URL новой сессии', async () => {
    const { rest, blobGets, hold, answer } = fakeRest()
    const files = fakeFiles()
    const published: MediaUrlEvt[] = []
    const mgr = newMediaManager({ rest, files, onMediaUrl: (e) => published.push(e) })
    hold()
    const p = mgr.downloadMediaURL(7)

    mgr.resetDownloads()
    await flush() // промах корзины первого запроса → его getBlob в полёте
    answer() // ответ прошлой сессии
    await flush() // гейт поколения → повторный запрос → его getBlob в полёте
    answer() // повторный запрос, уже под текущей

    const url = await p
    expect(blobGets).toEqual(['/media/7/content', '/media/7/content'])
    // публикация ровно одна — новой сессии; стейл-ответ не публиковался
    expect(published).toHaveLength(1)
    expect(published[0].url).toBe(url)
    // стейл-ответ не кэшировался нигде: ни в корзине (одна запись — новой
    // сессии), ни в контексте (повторный запрос отдаёт URL новой сессии)
    expect(files.saveFile).toHaveBeenCalledTimes(1)
    expect(await mgr.downloadMediaURL(7)).toBe(url)
    expect(blobGets).toHaveLength(2)
  })

  it('при DNP-ON байты полного медиа идут каналом, thumb — worker-fetch (у канала нет thumb-варианта)', async () => {
    const { rest, blobGets } = fakeRest()
    const downloadMedia = vi.fn(async () => new Blob(['chan']))
    const mgr = newMediaManager({ rest, files: fakeFiles(), fileDownload: { downloadMedia } as never })

    await mgr.downloadMediaURL(5)
    expect(downloadMedia).toHaveBeenCalledWith(5)
    expect(blobGets).toEqual([])

    await mgr.downloadMediaURL(5, { thumb: true })
    expect(blobGets).toEqual(['/media/5/content?v=thumb'])
  })
})
