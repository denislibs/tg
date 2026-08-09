// Док-бабл во время аплоада (tweb ProgressivePreloader): кольцо прогресса с
// крестиком-отменой на иконке, подстрока «отдано / всего», реальное имя файла.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'

// mediaUrl на импорте стартует SharedWorker (нет в happy-dom) — мокаем.
vi.mock('../../core/mediaUrl', () => ({
  mediaContentUrl: (id: number) => `/media/${id}`,
  mediaThumbUrl: (id: number) => `/media/${id}?v=thumb`,
  hasMediaToken: () => true,
  primeMediaToken: vi.fn(),
  useMediaTokenVersion: () => 0,
}))

import RealMediaBubble from './RealMediaBubble'
import { useUploadsStore } from '../../stores/uploadsStore'
import { useAudioStore } from '../../stores/audioStore'

describe('RealMediaBubble: аплоад документа', () => {
  beforeEach(() => {
    useUploadsStore.setState({ byId: {} })
  })
  afterEach(cleanup) // без vitest globals RTL не чистит DOM сам

  it('пока грузится: имя файла, «отдано / всего», кольцо и крестик-отмена', () => {
    useUploadsStore.getState().setProgress('c-9', 0.5)
    const onCancel = vi.fn()
    const { container } = render(
      <RealMediaBubble
        type="document"
        fileName="оферта.pdf"
        size={2 * 1024 * 1024}
        clientId="c-9"
        onCancelUpload={onCancel}
      />,
    )
    expect(screen.getByText('оферта.pdf')).toBeTruthy()
    expect(screen.getByText('1.0 МБ / 2.0 МБ')).toBeTruthy()
    const ring = container.querySelector('[data-radial-progress]')
    expect(ring).toBeTruthy()
    fireEvent.click(ring!.parentElement!)
    expect(onCancel).toHaveBeenCalledWith('c-9')
  })

  it('после аплоада: обычная иконка расширения и размер, без кольца', () => {
    const { container } = render(
      <RealMediaBubble
        type="document"
        mediaId={7}
        fileName="оферта.pdf"
        size={2 * 1024 * 1024}
        clientId="c-10"
      />,
    )
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

  const track = (extra: Record<string, unknown> = {}) => (
    <RealMediaBubble
      type="document"
      mime="audio/mpeg"
      mediaId={42}
      fileName="я тимлид.mp3"
      duration={139}
      size={3.3 * 1024 * 1024}
      out
      mid={21402}
      {...extra}
    />
  )

  it('в покое: заголовок из тега, длительность и исполнитель в описании', () => {
    const { container } = render(track({ mediaTitle: 'я тимлид', mediaPerformer: 'denis1488' }))
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
    const { container } = render(track({ mediaTitle: 'я тимлид', mediaPerformer: 'denis1488' }))
    const el = container.querySelector('audio-element')!
    expect(el.classList.contains('audio-show-progress')).toBe(true)
    expect(container.querySelector('.audio-time')!.textContent).toBe('1:46')
    expect(container.querySelector('.audio-description')).toBeNull()
    const filled = container.querySelector('.progress-line__filled') as HTMLElement
    expect(filled.style.width.startsWith('76.2')).toBe(true)
    expect(container.querySelector('input.progress-line__seek')).toBeTruthy()
  })
})
