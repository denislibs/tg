// Порт tweb `components/quizHint.ts` (812502980): разметка подсказки, въезд
// классом `active`, уход по `duration` и снятие через 200 мс, вытеснение
// предыдущей подсказки новой.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setQuizHint } from './quizHint'

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => {
  vi.useRealTimers()
  document.body.replaceChildren()
})

const text = (value: string) => {
  const span = document.createElement('span')
  span.textContent = value
  return span
}

describe('setQuizHint', () => {
  it('div.quiz-hint.from-bottom.active > .quiz-hint-container > иконка + текст; уходит по duration', () => {
    const appendTo = document.createElement('div')
    document.body.append(appendTo)
    setQuizHint({ appendTo, from: 'bottom', duration: 2500, icon: 'premium_lock', class: 'Hint', textElement: text('Set.') })

    const hint = appendTo.querySelector<HTMLElement>('.quiz-hint')!
    expect([...hint.classList]).toEqual(['quiz-hint', 'from-bottom', 'Hint', 'active'])
    const container = hint.firstElementChild!
    expect(container.className).toBe('quiz-hint-container')
    expect([...container.children].map((el) => el.className)).toEqual(['tgico quiz-hint-icon', 'quiz-hint-text'])
    expect(container.querySelector('.quiz-hint-text')!.textContent).toBe('Set.')

    vi.advanceTimersByTime(2500)
    expect(hint.classList.contains('active')).toBe(false)
    expect(hint.isConnected).toBe(true)
    vi.advanceTimersByTime(200)
    expect(hint.isConnected).toBe(false)
  })

  it('новая подсказка вытесняет предыдущую', () => {
    const appendTo = document.createElement('div')
    document.body.append(appendTo)
    setQuizHint({ appendTo, from: 'bottom', duration: 2500, textElement: text('one') })
    const first = appendTo.querySelector('.quiz-hint')!
    setQuizHint({ appendTo, from: 'bottom', duration: 2500, textElement: text('two') })

    expect(first.classList.contains('active')).toBe(false)
    vi.advanceTimersByTime(200)
    expect(first.isConnected).toBe(false)
    expect(appendTo.querySelectorAll('.quiz-hint')).toHaveLength(1)
  })
})
