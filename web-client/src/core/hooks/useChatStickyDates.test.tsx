// Проводка липкой даты вынута из Chat.tsx именно ради этих пинов: раньше она
// жила внутри useEffect компонента, который нигде не рендерится в vitest, и не
// ловилась ничем. Пинится то, что ломалось руками: уборка досыпанных сентинелов
// при перезапуске острова на ТОМ ЖЕ узле, однократность наблюдения секции и
// переподписка rootMargin.
import { StrictMode, useRef } from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'
import { useChatStickyDates } from './useChatStickyDates'

class IntersectionObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal('IntersectionObserver', IntersectionObserverStub)

function Feed({ days, revision = 0, pad = 0 }: { days: string[]; revision?: number; pad?: number }) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  useChatStickyDates({
    scrollRef,
    contentRef,
    feedRevision: revision,
    feedLoading: false,
    padTopPx: pad,
    padBottomPx: pad,
  })
  return (
    <div data-testid="scroll" ref={scrollRef}>
      <div data-testid="inner" ref={contentRef}>
        {days.map((day) => (
          <section key={day} className="bubbles-date-group">
            <div className="bubble service is-date" data-date={day} />
          </section>
        ))}
      </div>
    </div>
  )
}

const sentinels = (root: HTMLElement) => root.querySelectorAll('.sticky_sentinel')

describe('useChatStickyDates', () => {
  it('наблюдает каждую секцию дня — по одному сентинелу', () => {
    const { container } = render(<Feed days={['day-1', 'day-2']} />)
    expect(sentinels(container)).toHaveLength(2)
  })

  // Тот самый случай, ради которого проводка стала островом: StrictMode гоняет
  // mount → unmount → mount на ОДНОМ И ТОМ ЖЕ узле. Без уборки досыпанного
  // (`strays`) второй проход кладёт сентинел поверх первого, и дальше их число
  // растёт с каждым ремаунтом.
  it('StrictMode-ремаунт на том же узле не удваивает сентинелы', () => {
    const { container } = render(
      <StrictMode><Feed days={['day-1', 'day-2']} /></StrictMode>,
    )
    expect(sentinels(container)).toHaveLength(2)
  })

  it('новая секция дня наблюдается, старая не переподписывается', () => {
    const { container, rerender } = render(<Feed days={['day-1']} revision={0} />)
    expect(sentinels(container)).toHaveLength(1)

    rerender(<Feed days={['day-1', 'day-2']} revision={1} />)
    expect(sentinels(container)).toHaveLength(2)
  })

  it('смена паддингов переподписывает rootMargin, а не плодит сентинелы', () => {
    const disconnect = vi.spyOn(IntersectionObserverStub.prototype, 'disconnect')
    const { container, rerender } = render(<Feed days={['day-1']} pad={0} />)
    const before = disconnect.mock.calls.length

    rerender(<Feed days={['day-1']} pad={48} />)
    expect(disconnect.mock.calls.length).toBeGreaterThan(before)
    expect(sentinels(container)).toHaveLength(1)
    disconnect.mockRestore()
  })
})
