// Пояснение экрана «Обсуждение» — подпись секции БЕЗ карточки (форма tweb
// `<Section noContent caption>`, `section.tsx:91`, `:112`): у tweb это `div.caption`
// вне секций (`chatDiscussion.tsx:292`), не текст на фоне карточки. Прежняя разметка
// клала подпись первым ребёнком `.sidebar-left-section` — с моделью отступов
// `_section.scss` HEAD там действует правило `captionOld`
// (`.sidebar-left-section > .sidebar-left-section-caption { margin-top: -.375rem }`),
// и текст прилипал к верхнему краю карточки.
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { DiscussionScreen } from './DiscussionScreen'
import type { GroupEdit } from '../../../core/hooks/useGroupEdit'

afterEach(cleanup)

describe('DiscussionScreen: пояснение — подпись без карточки', () => {
  it('подпись — единственный ребёнок своего контейнера, карточки вокруг неё нет', () => {
    const g = {
      card: { fullChat: {} },
      loadDiscussionCandidates: () => Promise.resolve([]),
      loadDiscussionGroup: () => Promise.resolve(null),
    } as unknown as GroupEdit
    const { container: host } = render(<DiscussionScreen g={g} onBack={() => {}} />)

    const caption = host.querySelector<HTMLElement>('.sidebar-left-section-caption')!
    const container = caption.parentElement!

    expect(container.className).toBe('sidebar-left-section-container')
    expect(container.children.length).toBe(1)
    expect(caption.closest('.sidebar-left-section')).toBeNull()
  })
})
