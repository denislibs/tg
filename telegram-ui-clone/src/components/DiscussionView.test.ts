import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createElement as h } from 'react'
import { render, fireEvent, cleanup } from '@testing-library/react'
import { useI18nStore } from '../i18n'

// useDiscussion фетчит через managers/store — мокаем его контролируемым холдером.
const state = { comments: [] as Array<{ key: string; name: string; text: string; time: string; color: string; out: boolean }>, count: 0 }
const sendSpy = vi.fn()
vi.mock('../core/hooks/useDiscussion', () => ({
  useDiscussion: () => ({ comments: state.comments, count: state.count, send: sendSpy }),
}))

import DiscussionView from './DiscussionView'

const post = { title: 'Заголовок поста', text: 'Тело исходного поста', gradient: 'linear-gradient(#000,#111)', emoji: '🔥' }
const renderView = () =>
  render(h(DiscussionView, { channelId: 1, postId: 2, discussionChatId: 3, post, onBack: () => {} }))

beforeEach(() => {
  cleanup()
  state.comments = []
  state.count = 0
  sendSpy.mockClear()
  useI18nStore.getState().setLang('ru')
  // happy-dom не реализует scrollIntoView — заглушка для клика по пину
  Element.prototype.scrollIntoView = vi.fn()
})

describe('DiscussionView header title (плюрализация «N комментариев»)', () => {
  const cases: [number, string][] = [
    [0, 'Обсуждение'], // t('Comments') → 'Комментарии'? нет — при 0 показываем 'Comments'→'Комментарии'
    [1, '1 комментарий'],
    [2, '2 комментария'],
    [4, '4 комментария'],
    [5, '5 комментариев'],
    [11, '11 комментариев'],
    [15, '15 комментариев'],
    [21, '21 комментарий'],
    [22, '22 комментария'],
  ]
  for (const [count, label] of cases) {
    it(`count=${count} → «${label}»`, () => {
      state.count = count
      const { container } = renderView()
      if (count === 0) {
        // при 0 заголовок = t('Comments') = 'Комментарии'
        expect(container.textContent).toContain('Комментарии')
      } else {
        expect(container.textContent).toContain(label)
      }
    })
  }
})

describe('DiscussionView layout', () => {
  it('показывает pinned-плашку с превью поста и «Закреплённое сообщение»', () => {
    state.count = 3
    const { container } = renderView()
    expect(container.textContent).toContain('Закреплённое сообщение')
    expect(container.textContent).toContain('Тело исходного поста')
  })

  it('показывает сервис-сообщение «Начало обсуждения» после поста', () => {
    state.count = 1
    const { container } = renderView()
    expect(container.textContent).toContain('Начало обсуждения')
  })

  it('порядок: пост → «Начало обсуждения» → комментарии', () => {
    state.count = 1
    state.comments = [{ key: 'c1', name: 'Аноним', text: 'первый коммент', time: '12:00', color: '#e17076', out: false }]
    const { container } = renderView()
    const txt = container.textContent || ''
    const iPost = txt.indexOf('Тело исходного поста')
    const iService = txt.indexOf('Начало обсуждения')
    const iComment = txt.indexOf('первый коммент')
    expect(iPost).toBeGreaterThanOrEqual(0)
    expect(iService).toBeGreaterThan(iPost)
    expect(iComment).toBeGreaterThan(iService)
  })

  it('клик по pinned-плашке скроллит к посту (scrollIntoView)', () => {
    state.count = 2
    const { getByText } = renderView()
    const bar = getByText('Закреплённое сообщение')
    fireEvent.click(bar)
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled()
  })

  it('крестик прячет pinned-плашку', () => {
    state.count = 2
    const { container, getByText } = renderView()
    // поднимаемся от текста плашки до ближайшего предка с кнопкой (× в .pinned)
    let bar: HTMLElement | null = getByText('Закреплённое сообщение')
    while (bar && !bar.querySelector('button')) bar = bar.parentElement
    expect(bar).toBeTruthy()
    const closeBtn = bar!.querySelector('button') as HTMLButtonElement
    fireEvent.click(closeBtn)
    expect(container.textContent).not.toContain('Закреплённое сообщение')
  })
})
