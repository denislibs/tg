// Док-бабл во время аплоада (tweb ProgressivePreloader): кольцо прогресса с
// крестиком-отменой на иконке, подстрока «отдано / всего», реальное имя файла.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import type { ReactElement } from 'react'

// mediaUrl на импорте стартует SharedWorker (нет в happy-dom) — мокаем.
// (токен остался только видео-путям бабла; картинки — useMediaUrl, Task 7)
vi.mock('../../core/mediaUrl', () => ({
  mediaContentUrl: (id: number) => `/media/${id}`,
  hasMediaToken: () => true,
  primeMediaToken: vi.fn(),
  useMediaTokenVersion: () => 0,
}))

import RealMediaBubble from './RealMediaBubble'
import { saveDocument, type DocumentAttribute, type MyDocument } from '../../core/media/messageMedia'
import { ManagersProvider } from '../../core/hooks/useManagers'
import type { Managers } from '../../client/bootstrap'
import { useUploadsStore } from '../../stores/uploadsStore'
import { useAudioStore } from '../../stores/audioStore'

// Документ в форме оригинала: `type`/`file_name`/`duration` выводит из атрибутов
// `saveDocument` — тот же механизм, что `appDocsManager.saveDoc` у tweb.
const document_ = (mime: string, size: number, attributes: DocumentAttribute[]): MyDocument =>
  saveDocument({ _: 'document', id: 7, mime_type: mime, size, attributes })

// Task 7: картинки бабла резолвит useMediaUrl → managers.media.downloadMediaURL.
// Здесь баблы документ/трек — конвейер не зовётся, но провайдер обязателен.
const fakeManagers = { media: { downloadMediaURL: vi.fn(async (id: number) => `blob:media-${id}`) } } as unknown as Managers
const withManagers = (ui: ReactElement) => (
  <ManagersProvider managers={fakeManagers}>{ui}</ManagersProvider>
)

describe('RealMediaBubble: аплоад документа', () => {
  beforeEach(() => {
    useUploadsStore.setState({ byId: {} })
  })
  afterEach(cleanup) // без vitest globals RTL не чистит DOM сам

  it('пока грузится: имя файла, «отдано / всего», кольцо и крестик-отмена', () => {
    useUploadsStore.getState().setProgress('c-9', 0.5)
    const onCancel = vi.fn()
    const { container } = render(withManagers(
      <RealMediaBubble
        type="document"
        media={document_('application/pdf', 2 * 1024 * 1024, [{ _: 'documentAttributeFilename', file_name: 'оферта.pdf' }])}
        clientId="c-9"
        onCancelUpload={onCancel}
      />,
    ))
    expect(screen.getByText('оферта.pdf')).toBeTruthy()
    expect(screen.getByText('1.0 МБ / 2.0 МБ')).toBeTruthy()
    const ring = container.querySelector('[data-radial-progress]')
    expect(ring).toBeTruthy()
    fireEvent.click(ring!.parentElement!)
    expect(onCancel).toHaveBeenCalledWith('c-9')
  })

  it('после аплоада: обычная иконка расширения и размер, без кольца', () => {
    const { container } = render(withManagers(
      <RealMediaBubble
        type="document"
        mediaId={7}
        media={document_('application/pdf', 2 * 1024 * 1024, [{ _: 'documentAttributeFilename', file_name: 'оферта.pdf' }])}
        clientId="c-10"
      />,
    ))
    expect(container.querySelector('[data-radial-progress]')).toBeNull()
    expect(screen.getByText('pdf')).toBeTruthy()
    expect(screen.getByText('2.0 МБ')).toBeTruthy()
  })
})

// Дерево трека 1:1 с tweb (audio.ts:349-393 + живой DOM 03-reply-audio.json):
// .audio-title = title ?? file_name, .audio-time = длительность, описание —
// отдельный .audio-description с performer, а без него — размер файла.
describe('RealMediaBubble: музыкальный бабл', () => {
  beforeEach(() => {
    useUploadsStore.setState({ byId: {} })
    useAudioStore.setState({ track: null, playing: false, currentTime: 0, duration: 0 })
  })
  afterEach(cleanup)

  // Трек — документ с documentAttributeAudio: из него `saveDocument` выводит
  // `doc.type === 'audio'` (tweb appDocsManager), а ID3-теги бабл читает прямо
  // из атрибута (audio.ts:352). Имя файла — отдельным атрибутом.
  const track = (tags: { title?: string; performer?: string } = {}) => withManagers(
    <RealMediaBubble
      type="audio"
      mediaId={42}
      media={document_('audio/mpeg', 3.3 * 1024 * 1024, [
        { _: 'documentAttributeAudio', duration: 139, ...tags },
        { _: 'documentAttributeFilename', file_name: 'я тимлид.mp3' },
      ])}
      out
      mid={21402}
    />,
  )

  it('в покое: заголовок из тега, длительность и исполнитель в описании', () => {
    const { container } = render(track({ title: 'я тимлид', performer: 'denis1488' }))
    const el = container.querySelector('audio-element')!
    expect(el.classList.contains('audio')).toBe(true)
    expect(el.classList.contains('is-out')).toBe(true)
    // audio-show-progress только с первого play (tweb audio.ts:405-413)
    expect(el.classList.contains('audio-show-progress')).toBe(false)
    expect(el.getAttribute('data-mid')).toBe('21402')
    expect(container.querySelector('.audio-title')!.textContent).toBe('я тимлид')
    expect(container.querySelector('.audio-time')!.textContent).toBe('2:19')
    expect(container.querySelector('.audio-description')!.textContent).toBe(' • denis1488')
    expect(container.querySelector('.progress-line')).toBeNull()
  })

  it('без тегов: имя файла в заголовке, размер в описании (tweb formatBytes-ветка)', () => {
    const { container } = render(track())
    expect(container.querySelector('.audio-title')!.textContent).toBe('я тимлид.mp3')
    expect(container.querySelector('.audio-description')!.textContent).toBe(' • 3.3 МБ')
  })

  it('во время игры: audio-show-progress, currentTime и заполненная полоса вместо описания', () => {
    useAudioStore.setState({
      track: { mediaId: 42, title: 'я тимлид', subtitle: 'denis1488' },
      playing: true, currentTime: 106, duration: 139,
    })
    const { container } = render(track({ title: 'я тимлид', performer: 'denis1488' }))
    const el = container.querySelector('audio-element')!
    expect(el.classList.contains('audio-show-progress')).toBe(true)
    expect(container.querySelector('.audio-time')!.textContent).toBe('1:46')
    expect(container.querySelector('.audio-description')).toBeNull()
    const filled = container.querySelector('.progress-line__filled') as HTMLElement
    expect(filled.style.width.startsWith('76.2')).toBe(true)
    expect(container.querySelector('input.progress-line__seek')).toBeTruthy()
  })
})
