// Автозагрузка файла не должна сохранять его на диск (порт tweb
// `components/wrappers/document.ts:342` + `appDownloadManager.ts:257,300`).
//
// Механика оригинала: автозагрузка приезжает СИМУЛИРОВАННЫМ кликом
// (`simulateClickEvent`, document.ts:420), у которого `isTrusted === false`;
// `load` по этому признаку считает `save = false` и зовёт
// `downloadToDisc(..., justAttach = true)` — байты качаются, но якорь сохранения
// не создаётся. Настоящий клик пользователя (`isTrusted === true`) сохраняет.
//
// Без этого разбора «автозагрузка файлов» роняет КАЖДЫЙ документ ленты в папку
// «Загрузки» без ведома пользователя.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const downloadToDisc = vi.fn()

vi.mock('@lib/appDownloadManager', () => ({
  downloadToDisc: (...args: unknown[]) => {
    downloadToDisc(...args)
    const p = Promise.resolve(new Blob()) as Promise<Blob> & { notifyAll?: unknown, addNotifyListener?: unknown }
    p.addNotifyListener = () => {}
    return p
  },
  isDownloading: () => false,
  getDownload: () => undefined,
}))

const { default: wrapDocument } = await import('./document')
const { getMiddleware } = await import('@helpers/middleware')
const { saveDocument } = await import('@core/media/messageMedia')

// Документ в форме оригинала; `type`/`file_name` выводит `saveDocument`.
const doc = saveDocument({
  _: 'document',
  id: 1,
  mime_type: 'application/pdf',
  size: 1000,
  attributes: [{ _: 'documentAttributeFilename', file_name: 'report.pdf' }],
})

const wrap = (autoDownloadSize?: number) => {
  const helper = getMiddleware()
  const element = wrapDocument({ doc, middleware: helper.get(), autoDownloadSize })
  document.body.append(element)
  return element
}

beforeEach(() => {
  document.body.textContent = ''
  downloadToDisc.mockClear()
})

describe('wrapDocument — автозагрузка не сохраняет файл на диск', () => {
  it('автозагрузка качает с justAttach = true', () => {
    wrap(5000) // порог больше размера файла → автозагрузка

    expect(downloadToDisc).toHaveBeenCalledTimes(1)
    expect(downloadToDisc.mock.calls[0][1]).toBe(true)
  })

  it('настоящий клик пользователя сохраняет (justAttach = false)', () => {
    const element = wrap(0) // автозагрузка выключена
    expect(downloadToDisc).not.toHaveBeenCalled()

    // isTrusted у события из тестовой среды false, поэтому дёргаем `load` тем же
    // путём, что и настоящий клик, — через loadFunc с доверенным событием.
    const docDiv = element.classList.contains('document') ? element : element.querySelector('.document')!
    // attachClickEvent глушит клик, «уехавший» с места нажатия
    // (`hasMouseMovedSinceDown`) — нажатие обязано быть на том же узле.
    docDiv.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    const trusted = new MouseEvent('click', { bubbles: true })
    Object.defineProperty(trusted, 'isTrusted', { value: true })
    docDiv.dispatchEvent(trusted)

    expect(downloadToDisc).toHaveBeenCalledTimes(1)
    expect(downloadToDisc.mock.calls[0][1]).toBe(false)
  })
})
