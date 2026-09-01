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
import { createReactionsElement } from './reactions'

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

  // Проверяется ФОРМА, а не «строка непустая»: подсказку строит `getFullDate`
  // с набором опций ПО УМОЛЧАНИЮ (tweb `messageRender.ts:257` —
  // `getFullDate(new Date(message.date * 1000))`), и любой лишний аргумент
  // (`shortYear`, `monthAsNumber`, `noSeconds`) молча даёт другую подсказку.
  // Месяц здесь английский во всех языках — так у оригинала, см. `messageTime.ts`.
  it('полная дата — подсказкой у .time-inner, в форме `getFullDate` по умолчанию', () => {
    const inner = createMessageTime(at('2026-08-15T12:34:00')).querySelector<HTMLElement>('.time-inner')!
    expect(inner.title).toBe('15 August 2026, 12:34:00')
  })

  it('правленое сообщение несёт метку edited в ОБЕИХ копиях', () => {
    const el = createMessageTime(at('2026-08-15T12:34:00', { editedAt: '2026-08-15T12:40:00' }))

    expect(el.querySelectorAll('.time-edited')).toHaveLength(2)
  })

  it('неправленое метки не несёт', () => {
    const el = createMessageTime(at('2026-08-15T12:34:00'))
    expect(el.querySelector('.time-edited')).toBeNull()
  })

  it('время ПЕРЕЕЗЖАЕТ внутрь реакций, а не остаётся рядом с ними', () => {
    // tweb :9855 `reactionsElement.append(timeSpan)` — чипы и время образуют
    // одну строку-обёртку. Если время останется соседом, оно уедет на свою
    // строку под чипами.
    const reactions = createReactionsElement({
      _: 'messageReactions',
      results: [{ _: 'reactionCount', reaction: { _: 'reactionEmoji', emoticon: '👍' }, count: 1 }],
    })!
    const time = createMessageTime(at('2026-08-15T12:34:00'))

    reactions.append(time)

    expect(reactions.lastElementChild).toBe(time)
    expect(time.parentElement!.classList.contains('reactions')).toBe(true)
  })

  it('просмотры поста идут ПЕРЕД временем и пишутся КОМПАКТНО', () => {
    const el = createMessageTime(at('2026-08-15T12:34:00', { views: 9200 }))

    const views = el.querySelector('.post-views')!
    // tweb messageRender.ts:276 — `formatNumber(message.views, 1)`. Тем же
    // форматом пишет живое обновление счётчика (`messages_views` у ленты),
    // иначе первый кадр менял бы не число, а формат.
    expect(views.textContent).toBe('9.2K')
    // Время последнее — :340-342.
    expect(el.firstElementChild).toBe(views)
  })
})
