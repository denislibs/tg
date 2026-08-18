// Превью записи кружка (`RoundRecordPreview`, порт tweb
// `chat/recording/videoRecordingPanel.tsx`).
//
// Пиним ровно то, что задача сводила к общему модулю: кольцо в панели — узел
// ОБЩЕГО `components/progressRing` (а не третья JSX-копия разметки), он
// смонтирован внутрь `.video-recording-circle`, как <ProgressRing> в JSX
// оригинала, и прогресс едет через `setProgress` на смене секунды. Сама
// разметка/арифметика кольца проверены в `components/progressRing.test.ts` —
// здесь только проводка потребителя.
import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import RoundRecordPreview from './RoundRecordPreview'

// happy-dom валидирует тип `srcObject` — нужен настоящий MediaStream (пустой
// сойдёт: превью в тесте не играет, проверяем кольцо).
const STREAM = new MediaStream()

describe('RoundRecordPreview — кольцо общего модуля внутри коробки', () => {
  it('svg.progress-ring.video-recording-progress-ring лежит в .video-recording-circle', () => {
    const { container } = render(<RoundRecordPreview stream={STREAM} secs={0} />)

    const box = container.querySelector('.video-recording-circle')!
    const svg = box.querySelector(':scope > svg.progress-ring')
    expect(svg).toBeTruthy()
    expect(svg!.classList.contains('video-recording-progress-ring')).toBe(true)
    // размер сцены оригинала (videoRecordingPanel.tsx:19)
    expect(svg!.getAttribute('width')).toBe('360')
    // порядок оригинала: сначала превью-видео, кольцо поверх
    expect(box.firstElementChild!.tagName.toLowerCase()).toBe('video')
    expect(box.lastElementChild).toBe(svg)
  })

  it('прозрачность штриха — 0.9 панели записи, а не 0.3 кружка в ленте', () => {
    const { container } = render(<RoundRecordPreview stream={STREAM} secs={0} />)
    const circle = container.querySelector('.progress-ring__circle')!
    expect(circle.getAttribute('stroke-opacity')).toBe('0.9')
  })

  it('секунды двигают заполнение: 0 → пустое, 30 из 60 → половина, 60+ → полное', () => {
    const { container, rerender } = render(<RoundRecordPreview stream={STREAM} secs={0} />)
    const circle = container.querySelector('.progress-ring__circle') as SVGCircleElement
    const full = parseFloat(circle.style.strokeDashoffset)
    expect(full).toBeGreaterThan(0)

    rerender(<RoundRecordPreview stream={STREAM} secs={30} />)
    expect(parseFloat(circle.style.strokeDashoffset)).toBeCloseTo(full / 2, 6)

    rerender(<RoundRecordPreview stream={STREAM} secs={90} />)
    expect(parseFloat(circle.style.strokeDashoffset)).toBeCloseTo(0, 6)
  })

  it('размонтирование убирает кольцо из DOM (панель живёт только во время записи)', () => {
    const { container, unmount } = render(<RoundRecordPreview stream={STREAM} secs={0} />)
    expect(container.querySelector('.progress-ring')).toBeTruthy()
    unmount()
    expect(container.querySelector('.progress-ring')).toBeNull()
  })
})
