// Реестр активного рендерера градиента обоев — порт `appChatBackground
// .getActiveGradientRenderer()` / `onActiveGradientRendererChange`
// (tweb chatBackground.tsx:762-775).
//
// САМ СДВИГ здесь не проверяется: он живёт у прокручивающего
// (`chat/bubbles.ts::scrollToBubble`, порт tweb bubbles.ts:4710-4714), и его
// пин — `chat/bubbles.gradient.test.ts`.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import ChatBackgroundGradientRenderer from './gradientRenderer'
import {
  setActiveGradientRenderer,
  getActiveGradientRenderer,
  onActiveGradientRendererChange,
} from './activeGradient'

const toNextPosition = vi.fn()

beforeEach(() => {
  toNextPosition.mockClear()
  setActiveGradientRenderer(undefined)
})

// tweb appChatBackground.onActiveGradientRendererChange (chatBackground.tsx:762-775).
// Потребитель — колонка папок: без подписки она не узнала бы про смену обоев и
// осталась бы с зеркалом мёртвого рендерера.
describe('onActiveGradientRendererChange', () => {
  it('обои без градиента (своё фото/цвет) — рендерера нет', () => {
    expect(getActiveGradientRenderer()).toBeUndefined()
  })

  it('зовёт слушателя текущим значением сразу при подписке', () => {
    const renderer = { toNextPosition } as unknown as ChatBackgroundGradientRenderer
    setActiveGradientRenderer(renderer, { isDarkMaskPattern: true })

    const seen: unknown[][] = []
    onActiveGradientRendererChange((r, meta) => seen.push([r, meta]))

    expect(seen).toEqual([[renderer, { isDarkMaskPattern: true }]])
  })

  it('смена обоев доезжает до подписчика вместе с метой; отписка её прекращает', () => {
    setActiveGradientRenderer(undefined)
    const seen: unknown[][] = []
    const off = onActiveGradientRendererChange((r, meta) => seen.push([r, meta]))
    seen.length = 0

    const renderer = { toNextPosition } as unknown as ChatBackgroundGradientRenderer
    setActiveGradientRenderer(renderer, { isDarkMaskPattern: false })
    expect(seen).toEqual([[renderer, { isDarkMaskPattern: false }]])

    off()
    setActiveGradientRenderer(undefined)
    expect(seen).toHaveLength(1)
  })
})
