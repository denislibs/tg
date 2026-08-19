import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { ReactionChip, MessageReactions } from './MessageReactions'
import { useReactionEffectStore } from '../../stores/reactionEffectStore'

// ReactionIcon и StackedAvatars тянут контекст (managers/каталог реакций) —
// мокаем: тестируем ветвление «аватары vs число» (tweb reaction.ts
// renderCounter/renderAvatars), а не рендер самой иконки (см. ReactionIcon.test.tsx).
// `data-play` пробрасывает проп play наружу — нужен блоку ниже, который проверяет
// именно проводку play/эффекта вокруг (ревью R6, Important 2).
vi.mock('./ReactionIcon', () => ({
  default: ({ emoji, play }: { emoji: string; play: boolean }) => (
    <span data-testid="icon" data-play={String(play)}>{emoji}</span>
  ),
}))
vi.mock('./StackedAvatars', () => ({
  default: ({ peerIds }: { peerIds: number[] }) => (
    <div data-testid="stacked">{peerIds.length}</div>
  ),
}))
// ReactionAroundEffect (НЕ мокнут ниже — играет по-настоящему) сам тянет каталог
// реакций и StickerMedia — те же заглушки, что в ReactionAroundEffect.test.tsx.
vi.mock('../../core/hooks/useReactions', () => ({
  useReactions: () => [
    { emoji: '❤', title: 'Red Heart', position: 1, premium: false, inactive: false,
      staticMediaId: 3, centerMediaId: 7, selectMediaId: 9, aroundMediaId: 8 },
  ],
}))
vi.mock('../StickerMedia', () => ({
  default: ({ mediaId, onComplete }: { mediaId: number; onComplete?: () => void }) => (
    <div data-testid="effect-media" data-media={mediaId} onClick={onComplete} />
  ),
}))

afterEach(cleanup)

const noop = () => {}
const chipProps = { msgId: 1, live: false, isLast: true, onToggle: noop, onShow: noop }

describe('ReactionChip — аватары vs счётчик', () => {
  // `recent` — ключи пиров, а не карточки (см. `core/models.ts::ReactionCount`).
  const recent = [2, 3]

  it('аватары показываются, когда это разрешено и реакций мало', () => {
    render(<ReactionChip r={{ emoji: '👍', count: 2, mine: false, recent }} canRenderAvatars {...chipProps} />)
    expect(screen.getByTestId('stacked').textContent).toBe('2')
  })

  it('count >= порога → число, даже если recent есть', () => {
    const { container } = render(
      <ReactionChip r={{ emoji: '👍', count: 5, mine: false, recent }} canRenderAvatars {...chipProps} />,
    )
    expect(screen.queryByTestId('stacked')).toBeNull()
    expect(container.textContent).toContain('5')
  })

  it('аватары запрещены (список скрыт / реакций много) → число', () => {
    const { container } = render(
      <ReactionChip r={{ emoji: '👍', count: 2, mine: false, recent }} canRenderAvatars={false} {...chipProps} />,
    )
    expect(screen.queryByTestId('stacked')).toBeNull()
    expect(container.textContent).toContain('2')
  })

  it('нет recent → число', () => {
    const { container } = render(
      <ReactionChip r={{ emoji: '❤️', count: 2, mine: false }} canRenderAvatars {...chipProps} />,
    )
    expect(screen.queryByTestId('stacked')).toBeNull()
    expect(container.textContent).toContain('2')
  })
})

// Ревью R6, Important 2: сама проводка play/эффекта вокруг не имела теста —
// удаление `play={justReacted}` (откат на `play={false}`) и снятие условного
// маунта `<ReactionAroundEffect>` в MessageReactions.tsx не красили ни один
// тест. Плюс сценарий из Important 1: эффект не должен реплеиться при
// повторном маунте того же чипа после досрочного размонтирования.
describe('ReactionChip — эффект вокруг + select-анимация иконки (justReacted)', () => {
  beforeEach(() => {
    useReactionEffectStore.setState({ active: new Set() })
  })

  const heart = { emoji: '❤', count: 1, mine: true }

  it('без триггера в сторе — select-анимация не играет, эффекта вокруг нет', () => {
    render(<ReactionChip r={heart} canRenderAvatars={false} {...chipProps} />)
    expect(screen.getByTestId('icon').getAttribute('data-play')).toBe('false')
    expect(screen.queryByTestId('effect-media')).toBeNull()
  })

  it('своя только что поставленная реакция — play=true, эффект вокруг монтируется своим aroundMediaId', () => {
    useReactionEffectStore.getState().trigger(1, '❤')
    render(<ReactionChip r={heart} canRenderAvatars={false} {...chipProps} />)
    expect(screen.getByTestId('icon').getAttribute('data-play')).toBe('true')
    expect(screen.getByTestId('effect-media').getAttribute('data-media')).toBe('8')
  })

  it('триггер у ДРУГОГО сообщения не включает play/эффект у этого чипа (ключ msgId:emoji)', () => {
    useReactionEffectStore.getState().trigger(2, '❤') // другое сообщение, тот же эмодзи
    render(<ReactionChip r={heart} canRenderAvatars={false} {...chipProps} />)
    expect(screen.getByTestId('icon').getAttribute('data-play')).toBe('false')
    expect(screen.queryByTestId('effect-media')).toBeNull()
  })

  it('клик по эффекту (конец анимации) снимает play и сам эффект', () => {
    useReactionEffectStore.getState().trigger(1, '❤')
    render(<ReactionChip r={heart} canRenderAvatars={false} {...chipProps} />)
    fireEvent.click(screen.getByTestId('effect-media'))

    expect(screen.getByTestId('icon').getAttribute('data-play')).toBe('false')
    expect(screen.queryByTestId('effect-media')).toBeNull()
    expect(useReactionEffectStore.getState().active.has('1:❤')).toBe(false)
  })

  it('размонтирование ДО завершения + повторный маунт того же чипа — эффект НЕ реплеится', () => {
    useReactionEffectStore.getState().trigger(1, '❤')
    const first = render(<ReactionChip r={heart} canRenderAvatars={false} {...chipProps} />)
    expect(first.getByTestId('effect-media')).toBeTruthy() // сыграл в первый раз

    // Ушли из чата / лента реконсилировалась ДО того, как анимация доиграла —
    // ReactionAroundEffect.onComplete здесь никогда не позовётся.
    first.unmount()

    const second = render(<ReactionChip r={heart} canRenderAvatars={false} {...chipProps} />)
    expect(second.getByTestId('icon').getAttribute('data-play')).toBe('false')
    expect(second.queryByTestId('effect-media')).toBeNull()
  })
})

describe('MessageReactions — порог считается по сумме реакций сообщения', () => {
  const rowProps = { msgId: 1, rowLive: false, canSeeList: true, onToggle: noop, onShow: noop, onStar: noop }
  const recent = [{ id: 2, name: 'B' }]

  it('суммарно меньше порога → аватары', () => {
    render(<MessageReactions reactions={[{ emoji: '👍', count: 2, mine: false, recent }]} {...rowProps} />)
    expect(screen.getByTestId('stacked')).toBeTruthy()
  })

  it('суммарно порог набран разными реакциями → у всех числа', () => {
    const { container } = render(
      <MessageReactions
        reactions={[
          { emoji: '👍', count: 2, mine: false, recent },
          { emoji: '❤️', count: 2, mine: false, recent },
        ]}
        {...rowProps}
      />,
    )
    expect(screen.queryByTestId('stacked')).toBeNull()
    expect(container.textContent).toContain('2')
  })

  it('список реагировавших недоступен (группа без can_see_list) → числа', () => {
    render(
      <MessageReactions
        reactions={[{ emoji: '👍', count: 1, mine: false, recent }]}
        {...rowProps}
        canSeeList={false}
      />,
    )
    expect(screen.queryByTestId('stacked')).toBeNull()
  })
})
