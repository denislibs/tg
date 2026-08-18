// Волна голосового в React-ленте строится ПРЯМО ИЗ СООБЩЕНИЯ — 1:1 tweb
// `wrapVoiceMessage`, где пики лежат в `documentAttributeAudio.waveform`
// документа сообщения. До появления `media_waveform` в витрине истории и в
// live-кадре бабл добирал их отдельным запросом меты медиа (`GET /media/{id}`)
// и дорисовывал волну вторым кадром — этот путь снят, и тест держит его снятым.
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import type { ReactElement } from 'react'

// mediaUrl на импорте стартует SharedWorker (нет в happy-dom) — мокаем.
vi.mock('../../core/mediaUrl', () => ({
  mediaContentUrl: (id: number) => `/media/${id}`,
  resolveMediaContentUrl: (id: number) => `/media/${id}`,
  resolveStreamUrl: (id: number) => `/media/${id}`,
  hasMediaToken: () => true,
  primeMediaToken: vi.fn(),
  useMediaTokenVersion: () => 0,
}))

import VoiceMessage from './VoiceMessage'
import { ManagersProvider } from '../../core/hooks/useManagers'
import { pack5bit } from '../../core/audio/voiceWaveformAnalyser'
import type { Managers } from '../../client/bootstrap'

// Мета медиа — ПИН: волна обязана строиться без неё. Любое возвращение добора
// (waveform или duration отдельным запросом) красит тест.
const meta = vi.fn(() => new Promise(() => {}))
const fakeManagers = { media: { meta } } as unknown as Managers
const withManagers = (ui: ReactElement) => (
  <ManagersProvider managers={fakeManagers}>{ui}</ManagersProvider>
)

/** 100 пиков → 63 байта → base64, ровно как их шлёт запись голосового. */
const peaksB64 = (values: number[]) => btoa(String.fromCharCode(...pack5bit(values)))

afterEach(() => {
  cleanup()
  meta.mockClear()
})

describe('VoiceMessage: волна из пиков сообщения', () => {
  it('пики есть — волна нарисована сразу, запроса меты медиа нет', () => {
    const waveform = peaksB64(Array.from({ length: 100 }, (_, i) => (i * 7) % 32))
    const { container } = render(withManagers(
      <VoiceMessage mediaId={101} msgId={5} chatId={1} waveform={waveform} duration={10} out onPlay={() => {}} />,
    ))

    const svg = container.querySelector('.audio-waveform-background > svg.audio-waveform-bars')
    expect(svg).toBeTruthy()
    // ширина волны растёт с длительностью: clamp(10/60*256, 190, 256) = 190,
    // число баров = 190 / (2 + 2) = 47 (порт tweb createWaveformBars)
    expect(svg?.getAttribute('width')).toBe('190')
    expect(container.querySelectorAll('.audio-waveform-background rect.audio-waveform-bar').length).toBe(47)
    // подпись времени — длительность из меты сообщения, тоже без запроса
    expect(container.querySelector('.audio-time')?.textContent).toBe('0:10')
    expect(meta).not.toHaveBeenCalled()
  })

  it('пиков нет — волны нет вовсе и файл ради неё не качается (tweb 1:1)', () => {
    const { container } = render(withManagers(
      <VoiceMessage mediaId={102} msgId={6} chatId={1} duration={10} out onPlay={() => {}} />,
    ))

    expect(container.querySelector('.audio-waveform')).toBeNull()
    expect(meta).not.toHaveBeenCalled()
  })
})
