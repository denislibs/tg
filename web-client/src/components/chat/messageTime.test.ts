// Время бабла — порт `MessageRender.setTime` (tweb messageRender.ts:209-393).
//
// Главный пин — ДВОЙНОЙ РЕНДЕР: части лежат и в самом `span.time`, и дублем в
// `div.time-inner`. Это не избыточность: первый занимает место в потоке текста
// (иначе последняя строка подписи налезала бы на время), второй позиционируется
// абсолютно и виден.
import { describe, expect, it } from 'vitest'
import { makeMessage } from '@core/messages/testMessage'
import type { MyMessage } from '@core/models'
import { createMessageTime } from './messageTime'

const at = (iso: string, over: Partial<{ editedAt: string; views: number }> = {}): MyMessage => {
  const m = makeMessage({ peerId: 7, fromId: 2, id: 1, text: 'привет', createdAt: iso })
  return {
    ...m,
    ...(over.editedAt ? { edit_date: Math.floor(new Date(over.editedAt).getTime() / 1000) } : {}),
    ...(over.views != null ? { views: over.views } : {}),
  } as MyMessage
}

describe('createMessageTime', () => {
  it('время лежит И в .time, И дублем в .time-inner', () => {
    const el = createMessageTime(at('2026-08-15T12:34:00'))

    const inner = el.querySelector('.time-inner')!
    expect(el.classList.contains('time')).toBe(true)
    expect(inner).not.toBeNull()
    // Обе копии несут одно и то же время.
    expect(el.textContent).toContain('12:34')
    expect(inner.textContent).toContain('12:34')
  })

  it('полная дата — подсказкой у .time-inner', () => {
    const inner = createMessageTime(at('2026-08-15T12:34:00')).querySelector<HTMLElement>('.time-inner')!
    expect(inner.title).not.toBe('')
  })

  it('правленое сообщение несёт метку edited в ОБЕИХ копиях', () => {
    const el = createMessageTime(at('2026-08-15T12:34:00', { editedAt: '2026-08-15T12:40:00' }))

    expect(el.querySelectorAll('.time-edited')).toHaveLength(2)
  })

  it('неправленое метки не несёт', () => {
    const el = createMessageTime(at('2026-08-15T12:34:00'))
    expect(el.querySelector('.time-edited')).toBeNull()
  })

  it('просмотры поста идут ПЕРЕД временем (порядок частей оригинала)', () => {
    const el = createMessageTime(at('2026-08-15T12:34:00', { views: 9200 }))

    const views = el.querySelector('.post-views')!
    expect(views.textContent).toBe('9200')
    // Время последнее — :340-342.
    expect(el.firstElementChild).toBe(views)
  })
})
