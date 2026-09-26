// ── ПИН tweb 5b1636d61: кнопка меню бота живёт, только пока она на экране ──────
//
// `.new-message-bot-commands` лежит в строке ввода всегда, когда у бота есть
// меню, но показывает её сдвиг строки `has-offset` c `data-offset="commands"`
// (_chat.scss). Когда сдвиг отдан send-as (`data-offset="as"`) или уезжает
// назад, кнопка спрятана — и клик по ней не должен открывать мини-приложение
// (tweb input.ts:987-989: `hasOffset.type !== 'commands' || !forwards` →
// return). Ширина кнопки — текст + паддинги 2 × .75rem (было 2 × .6875rem).
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import type { VoiceRecorder } from '../core/hooks/useVoiceRecorder'
import Composer from './Composer'
import { ManagersProvider } from '../core/hooks/useManagers'

const rec = { recording: false, paused: false, secs: 0, bars: [] as number[] } as unknown as VoiceRecorder

function renderComposer(props: Partial<React.ComponentProps<typeof Composer>>) {
  render(
    <ManagersProvider managers={{ peers: { fillMirror: async () => {} } } as never}>
    <Composer
      reply={null}
      editing={null}
      forward={null}
      rec={rec}
      onSend={vi.fn()}
      onTyping={vi.fn()}
      onCancelReply={vi.fn()}
      onCancelEdit={vi.fn()}
      onCancelForward={vi.fn()}
      onForwardOption={vi.fn()}
      onForwardAnother={vi.fn()}
      onOpenAttach={vi.fn()}
      {...props}
    />
    </ManagersProvider>,
  )
  return document.querySelector<HTMLElement>('.new-message-bot-commands')!
}

afterEach(cleanup)

describe('Composer — кнопка меню бота (tweb 5b1636d61)', () => {
  it('сдвиг строки отдан ей — клик открывает меню', () => {
    const onClick = vi.fn()
    const btn = renderComposer({ botMenuButton: { text: 'Меню', onClick } })
    btn.click()
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('сдвиг отдан send-as (кнопка спрятана) — клик не делает ничего', () => {
    const onClick = vi.fn()
    const btn = renderComposer({
      botMenuButton: { text: 'Меню', onClick },
      sendAs: { peers: [{ peerId: 1, title: 'Я' }], currentId: 1, onSelect: () => {} },
    })
    btn.click()
    expect(onClick).not.toHaveBeenCalled()
  })

  it('ширина кнопки — текст + 24 (паддинги 2 × .75rem)', () => {
    Object.defineProperty(HTMLElement.prototype, 'scrollWidth', { configurable: true, get: () => 50 })
    try {
      renderComposer({ botMenuButton: { text: 'Меню', onClick: () => {} } })
      const wrapper = document.querySelector<HTMLElement>('.new-message-wrapper')!
      expect(wrapper.style.getPropertyValue('--commands-size')).toBe('74px')
    } finally {
      delete (HTMLElement.prototype as { scrollWidth?: number }).scrollWidth
    }
  })
})
