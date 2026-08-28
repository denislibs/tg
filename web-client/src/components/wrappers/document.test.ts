// Поведение ванильного `wrapDocument` (порт tweb components/wrappers/document.ts).
// Эталон дерева — живой дамп tweb `docs/tweb/dom/dumps/03-document.json`:
//
//   div.document.ext-pdf
//     div.document-ico > span.document-ico-text "pdf"
//     div.document-name > middle-ellipsis-element "…pdf"
//     div.document-size > span > (размер + скрытый дубль " / размер")
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { saveDocument } from '@core/media/messageMedia'

// Байты файла качаются прямым fetch по токен-URL (санкционированный путь для
// не-картинок) — в тесте и токен, и сеть подменены.
vi.mock('@core/mediaUrl', () => ({
  resolveMediaContentUrl: (id: number) => `https://media/${id}`,
  mediaContentUrl: (id: number) => `https://media/${id}`,
  resolveStreamUrl: (id: number) => `https://media/${id}`,
  primeMediaToken: () => Promise.resolve(),
  hasMediaToken: () => true,
  applyMediaToken: () => {},
  resetMediaToken: () => {},
  subscribeMediaToken: () => () => {},
}))
vi.mock('@core/mediaRead', () => ({ markMediaPlayed: vi.fn() }))

const wrapDocument = (await import('./document')).default
const { MiddleEllipsisElement } = await import('@components/middleEllipsis')
const { getMiddleware } = await import('@helpers/middleware')

/** Управляемый поток байтов вместо сети. */
function makeStream() {
  const queue: Array<{ done: boolean, value?: Uint8Array }> = []
  let wake: (() => void) | null = null

  const push = (bytes: number) => {
    queue.push({ done: false, value: new Uint8Array(bytes) })
    wake?.()
  }
  const close = () => {
    queue.push({ done: true, value: undefined })
    wake?.()
  }

  const reader = {
    read(): Promise<{ done: boolean, value?: Uint8Array }> {
      const next = queue.shift()
      if(next) return Promise.resolve(next)
      return new Promise((resolve) => {
        wake = () => {
          wake = null
          resolve(queue.shift()!)
        }
      })
    },
  }

  return { push, close, reader }
}

let stream: ReturnType<typeof makeStream>

beforeEach(() => {
  document.body.textContent = ''
  stream = makeStream()
  vi.stubGlobal('fetch', () => Promise.resolve({
    ok: true,
    body: { getReader: () => stream.reader },
    headers: { get: () => '100' },
  }))
  vi.stubGlobal('URL', Object.assign(Object.create(URL), {
    createObjectURL: () => 'blob:doc',
    revokeObjectURL: () => {},
  }))
  // сохранение на диск — клик по <a download>; в happy-dom он не нужен
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
})

// Документ — в форме оригинала: `type`/`file_name` рукой не задаются, их
// выводит `saveDocument` из атрибутов и mime (порт `appDocsManager.saveDoc`).
const doc = ({ id = 7, fileName = 'Оферта_Маркетплейс.pdf', size = 318_464, mime = 'application/pdf' } = {}) =>
  saveDocument({
    _: 'document',
    id,
    mime_type: mime,
    size,
    attributes: [{ _: 'documentAttributeFilename', file_name: fileName }],
  })

function wrap(over: Partial<Parameters<typeof wrapDocument>[0]> = {}) {
  const helper = getMiddleware()
  const element = wrapDocument({ doc: doc(), middleware: helper.get(), ...over })
  document.body.append(element)
  return { element, helper }
}

describe('wrapDocument — дерево и классы tweb', () => {
  it('структура совпадает с живым дампом 03-document.json', () => {
    const { element } = wrap()

    expect(element.tagName).toBe('DIV')
    expect(element.classList.contains('document')).toBe(true)
    expect(element.classList.contains('ext-pdf')).toBe(true)
    expect(element.dataset.docId).toBe('7')

    const children = Array.from(element.children).map((child) => child.className)
    expect(children).toEqual(['document-ico', 'document-name', 'document-size'])

    expect(element.querySelector('.document-ico > .document-ico-text')?.textContent).toBe('pdf')
    expect(element.querySelector('.document-name')?.firstElementChild)
      .toBeInstanceOf(MiddleEllipsisElement)
  })

  it('имя файла — из данных сообщения, текстовым узлом', () => {
    const { element } = wrap()
    const name = element.querySelector('.document-name')?.firstElementChild as HTMLElement

    expect(name.textContent).toBe('Оферта_Маркетплейс.pdf')
    expect(name.dataset.fontWeight).toBe('500')
    expect(name.dataset.fontSize).toBe('16')
  })

  it('пользовательское имя не становится разметкой (норма безопасности)', () => {
    const { element } = wrap({ doc: doc({ fileName: '<img src=x onerror=alert(1)>.pdf' }) })
    const name = element.querySelector('.document-name')?.firstElementChild as HTMLElement

    expect(name.querySelector('img')).toBeNull()
    expect(name.textContent).toContain('<img')
  })

  it('размер — из данных сообщения, плюс скрытый дубль ради стабильной ширины', () => {
    const { element } = wrap()
    const span = element.querySelector('.document-size > span') as HTMLElement

    expect(span.textContent).toBe('311 KB / 311 KB')
    const hidden = span.lastElementChild as HTMLElement
    expect(hidden.style.visibility).toBe('hidden')
    expect(hidden.textContent).toBe(' / 311 KB')
  })
})

describe('wrapDocument — расширение файла', () => {
  it.each([
    ['архив.zip', 'ext-zip'],
    ['ПРЕЗЕНТАЦИЯ.PDF', 'ext-pdf'],
    ['app.apk', 'ext-apk'],
    ['file with spaces.tar gz', 'ext-tar'], // tweb берёт первое слово расширения
    ['без-точки', 'ext-file'],
    ['', 'ext-file'],
  ])('%s → %s', (fileName, expected) => {
    const { element } = wrap({ doc: doc({ fileName }) })
    expect(element.classList.contains(expected)).toBe(true)
    expect(element.querySelector('.document-ico-text')?.textContent).toBe(expected.slice(4))
  })
})

describe('wrapDocument — кольцо прогресса скачивания', () => {
  it('появляется по клику, показывает скачанное и снимается по завершении', async () => {
    vi.useFakeTimers()
    try {
      const { element } = wrap({ doc: doc({ id: 71 }) })

      // до клика кольцо стоит в ручном режиме (tweb setManual) и не качает
      const preloader = element.querySelector('.document-ico .preloader-container') as HTMLElement
      expect(preloader).not.toBeNull()
      expect(preloader.classList.contains('manual')).toBe(true)
      expect(element.classList.contains('downloading')).toBe(false)

      element.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await vi.advanceTimersByTimeAsync(0)

      expect(element.classList.contains('downloading')).toBe(true)
      // размер подменён на «скачано / всего» (tweb addByteProgress)
      const size = element.querySelector('.document-size') as HTMLElement
      const progressSpan = size.lastElementChild as HTMLElement
      expect(progressSpan.textContent).toBe('0 B / 311 KB')

      stream.push(50)
      await vi.advanceTimersByTimeAsync(0)
      expect(progressSpan.textContent).toBe('50 B / 311 KB')
      // дуга кольца — доля скачанного (tweb ProgressivePreloader.setProgress)
      const circle = element.querySelector('.preloader-path-new') as SVGCircleElement
      expect(circle.style.strokeDasharray).not.toBe('')

      stream.close()
      await vi.advanceTimersByTimeAsync(1000)

      // кольцо снято: класс загрузки убран, размер вернулся, кольцо снова ручное
      expect(element.classList.contains('downloading')).toBe(false)
      expect((element.querySelector('.document-size > span') as HTMLElement).style.visibility).toBe('')
      expect(size.querySelectorAll('span')).toHaveLength(2) // sizeContainer убран
      expect(element.querySelector('.preloader-container')?.classList.contains('manual')).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('автозагрузка ниже порога стартует сама (tweb autoDownloadSize)', async () => {
    vi.useFakeTimers()
    try {
      const { element } = wrap({ doc: doc({ id: 72 }), autoDownloadSize: 1_000_000 })
      await vi.advanceTimersByTimeAsync(0)

      expect(element.classList.contains('downloading')).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('autoDownloadSize=0 — сама не качает, только по клику', async () => {
    vi.useFakeTimers()
    try {
      const { element } = wrap({ doc: doc({ id: 73 }), autoDownloadSize: 0 })
      await vi.advanceTimersByTimeAsync(0)

      expect(element.classList.contains('downloading')).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('пересозданный бабл цепляет кольцо к УЖЕ идущей загрузке (tweb isDownloading)', async () => {
    vi.useFakeTimers()
    try {
      const first = wrap({ doc: doc({ id: 74 }) })
      first.element.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await vi.advanceTimersByTimeAsync(0)

      // тот же файл в новом узле (бабл переехал через окно ленты)
      const second = wrap({ doc: doc({ id: 74 }) })
      await vi.advanceTimersByTimeAsync(0)

      expect(second.element.classList.contains('downloading')).toBe(true)
      expect(second.element.querySelector('.preloader-container')).not.toBeNull()

      stream.close()
      await vi.advanceTimersByTimeAsync(1000)
      expect(second.element.classList.contains('downloading')).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })
})
