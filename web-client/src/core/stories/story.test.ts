import { describe, expect, it } from 'vitest'
import { storyCanShare, storyPrivacy, type StoryItem } from './story'

const item = (pFlags: Record<string, true>): StoryItem =>
  ({ _: 'storyItem', id: 1, date: 0, expire_date: 0, pFlags } as unknown as StoryItem)

// «Поделиться» и «Репост» — только у публичной истории (tweb viewer.tsx:2222-2224);
// сервер для остальных отвечает 403, поэтому пункты меню не показываются.
describe('storyCanShare', () => {
  it('публичная — можно', () => {
    expect(storyCanShare(item({ public: true }))).toBe(true)
    expect(storyPrivacy(item({ public: true }))).toBe('everyone')
  })
  it.each([
    ['contacts', { contacts: true }],
    ['close', { close_friends: true }],
    ['selected', { selected_contacts: true }],
    ['без флагов', {}],
  ])('%s — нельзя', (_name, flags) => {
    expect(storyCanShare(item(flags as Record<string, true>))).toBe(false)
  })
  it('нет истории — нельзя', () => {
    expect(storyCanShare(undefined)).toBe(false)
  })
})
