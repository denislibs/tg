// Проводка «сообщение → голосовой бабл»: пики волны и длительность бабл берёт
// ИЗ САМОГО СООБЩЕНИЯ (1:1 tweb, где waveform лежит в documentAttributeAudio
// документа). Пропусти любой из двух пропсов — и волна исчезнет (или встанет
// не той ширины) у каждого голосового, а ни один другой тест этого не заметит.
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, cleanup } from '@testing-library/react'

// mediaUrl на импорте стартует SharedWorker (нет в happy-dom) — мокаем.
vi.mock('../../core/mediaUrl', () => ({
  mediaContentUrl: (id: number) => `/media/${id}`,
  resolveMediaContentUrl: (id: number) => `/media/${id}`,
  resolveStreamUrl: (id: number) => `/media/${id}`,
  hasMediaToken: () => true,
  primeMediaToken: vi.fn(),
  useMediaTokenVersion: () => 0,
}))

// Сам бабл к предмету не относится (и тянет плеер/менеджеры) — подменяем узлом,
// который лишь записывает полученные пропсы.
const voiceProps = vi.fn()
vi.mock('./VoiceMessage', () => ({
  default: (props: Record<string, unknown>) => {
    voiceProps(props)
    return <div data-testid="voice" />
  },
}))

import MessageContent from './MessageContent'
import type { ConvMsg } from '../../data'
import type { FeedFns } from './MessageRow'

const feedFns = { playVoice: vi.fn(), mediaPlayed: vi.fn() } as unknown as FeedFns

const voice = {
  id: 5, chatId: 1, senderId: 2, type: 'voice', text: '', at: '', time: '10:00',
  mediaId: 55, mediaDuration: 7, mediaWaveform: 'HwAq/wc=',
} as unknown as ConvMsg

afterEach(() => {
  cleanup()
  voiceProps.mockClear()
})

describe('MessageContent → VoiceMessage', () => {
  it('отдаёт баблу пики и длительность из сообщения', () => {
    render(
      <MessageContent
        m={voice}
        out={false}
        firstInGroup
        lastInGroup
        selecting={false}
        showReactions={false}
        rowLive={false}
        canSeeReactionList
        feedFns={feedFns}
      />,
    )

    expect(voiceProps).toHaveBeenCalled()
    expect(voiceProps.mock.calls[0][0]).toMatchObject({ waveform: 'HwAq/wc=', duration: 7, mediaId: 55 })
  })
})
