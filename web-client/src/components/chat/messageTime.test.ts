// Время бабла — порт `MessageRender.setTime` (tweb messageRender.ts:209-393).
//
// Главный пин — ДВОЙНОЙ РЕНДЕР: части лежат и в самом `span.time`, и дублем в
// `div.time-inner`. Это не избыточность: первый занимает место в потоке текста
// (иначе последняя строка подписи налезала бы на время), второй позиционируется
// абсолютно и виден.
import { afterEach, describe, expect, it } from 'vitest'
import { makeMessage } from '@core/messages/testMessage'
import { glyph } from '@core/tgico-icons'
import type { MyMessage } from '@core/models'
import I18n from '@lib/langPack'
import '../../test/lang'
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

/**
 * Части одной копии — «тег.класс.класс», в порядке DOM. Дубль (`div.time-inner`)
 * из выборки исключён: он не часть, а вторая копия всех частей сразу.
 *
 * Класса `i18n` у метки правки в нашем перечислении нет, хотя в дампе он есть:
 * оригинал ставит текст через `_i18n` (`messageRender.ts:58`), у нас метка —
 * обычный `textContent` из стора переводов. Расхождение прежнее, к этому
 * дефекту отношения не имеет.
 */
const shape = (scope: HTMLElement): string[] =>
  Array.from(scope.children)
    .filter((n) => !n.classList.contains('time-inner'))
    .map((n) => [n.tagName.toLowerCase(), ...Array.from(n.classList)].join('.'))

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

  // Просмотры бэкенд кладёт только посту канала (`domain/messagewire.go:164-166`),
  // а метка правки приходит в ЛЮБОМ чате — значит и её отступ (`time-part`)
  // нужен везде, не только под просмотрами.
  it('правленое сообщение несёт метку edited в ОБЕИХ копиях, с отступом', () => {
    const el = createMessageTime(at('2026-08-15T12:34:00', { editedAt: '2026-08-15T12:40:00' }))

    expect(el.querySelectorAll('.time-edited')).toHaveLength(2)
    const expected = ['i.time-edited.time-part', 'span.i18n']
    expect(shape(el)).toEqual(expected)
    expect(shape(el.querySelector<HTMLElement>('.time-inner')!)).toEqual(expected)
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
    expect(shape(el)).toEqual([
      'span.post-views',
      'span.tgico.time-icon.time-part.time-icon-views',
      'span.i18n',
    ])
  })

  // ── ПИН «122:50» ──────────────────────────────────────────────────────────
  //
  // Счётчик просмотров стоял вплотную к времени: у поста канала минимум
  // просмотров — 1 (`backend/internal/domain/mtmessage.go:355-361`), и «1» +
  // «22:50» читались как «122:50». Отступ между ними несёт НЕ пробел, а иконка
  // «глаз» с классом `time-part` (tweb `messageRender.ts:278`, `:286`;
  // `.time-part { margin-inline-end: .375rem }`), поэтому пин смотрит на
  // структуру, а не на строку.
  it('между просмотрами и временем стоит иконка «глаз» — числа не слипаются', () => {
    const el = createMessageTime(at('2026-08-15T22:50:00', { views: 1 }))

    for (const scope of [el, el.querySelector<HTMLElement>('.time-inner')!]) {
      const views = scope.querySelector<HTMLElement>('.post-views')!
      const icon = views.nextElementSibling as HTMLElement
      expect(icon.className).toBe('tgico time-icon time-part time-icon-views')
      // Глиф `channelviews` (tweb icon.ts:28-37 — содержимое `span.tgico`).
      expect(icon.textContent).toBe(glyph('channelviews'))
      // Время — сразу за иконкой, отдельным узлом.
      expect(icon.nextElementSibling!.textContent).toBe('22:50')
    }
  })

  // Эталон — живой DOM tweb, `docs/tweb/dom/dumps/20-channel-01-post-formatted.json`
  // (строки 90-101): `span.time` → `i.time-edited.time-part`, `span.post-views`,
  // `span.tgico.time-icon.time-part.time-icon-views`, `span.i18n` со временем,
  // и тот же набор дублем внутри `div.time-inner`.
  it('состав и порядок частей — как в дампе поста канала', () => {
    const el = createMessageTime(at('2026-08-15T19:25:00', { views: 780, editedAt: '2026-08-15T19:28:00' }))

    const expected = [
      'i.time-edited.time-part',
      'span.post-views',
      'span.tgico.time-icon.time-part.time-icon-views',
      'span.i18n',
    ]
    expect(shape(el)).toEqual(expected)
    expect(shape(el.querySelector<HTMLElement>('.time-inner')!)).toEqual(expected)
  })

  it('метка edited стоит ПЕРЕД просмотрами и несёт time-part', () => {
    const el = createMessageTime(at('2026-08-15T19:25:00', { views: 780, editedAt: '2026-08-15T19:28:00' }))

    for (const scope of [el, el.querySelector<HTMLElement>('.time-inner')!]) {
      const edited = scope.querySelector<HTMLElement>('.time-edited')!
      // tweb `messageRender.ts:298` — `args.unshift(makeEdited())`.
      expect(scope.firstElementChild).toBe(edited)
      // tweb `messageRender.ts:55-60` — `classList.add('time-edited', 'time-part')`.
      expect(edited.classList.contains('time-part')).toBe(true)
      expect(edited.nextElementSibling!.className).toBe('post-views')
    }
  })

  // ── ПИН ЗАДАЧИ #124 ───────────────────────────────────────────────────────
  //
  // Время бабла собиралось `padStart`-ом и попадало в `textContent` СТРОКОЙ.
  // Строка не переживает ничего: настройку 12/24 часа ведёт `I18n.setTimeFormat`
  // (`lib/langPack.ts:490-506`), а он обходит `.i18n` и зовёт `update()` у
  // ИНСТАНСОВ из `weakMap` — строка в текстовом узле для него не существует.
  // Пользователь, включивший 12-часовой формат, видел «18:05» до перезагрузки, а
  // после неё — снова «18:05».
  //
  // Проверяется не «текст правильный» (это оставалось верным и с дефектом), а
  // то, ЧЕМ время является: узлом ядра, который ядро может переписать.
  afterEach(() => {
    I18n.setTimeFormat('h23')
    document.body.replaceChildren()
  })

  it('время — ИНСТАНС ядра в weakMap, а не текст: обе копии', () => {
    const el = createMessageTime(at('2026-08-15T12:34:00'))

    // Обе копии (`span.time` и дубль `div.time-inner`) несут СВОЙ узел: один
    // узел не может лежать в двух местах DOM, а клонировать `.i18n` нельзя —
    // клон в `weakMap` не записан (tweb `messageRender.ts:375-382` исключает
    // такие узлы из клонирования поимённо).
    const nodes = Array.from(el.querySelectorAll<HTMLElement>('.i18n'))
    expect(nodes).toHaveLength(2)
    expect(nodes[0]).not.toBe(nodes[1])
    for (const node of nodes) expect(I18n.weakMap.get(node)).toBeDefined()
    expect(nodes.map((n) => n.textContent)).toEqual(['12:34', '12:34'])
  })

  it('12-часовой формат переписывает ТЕ ЖЕ узлы, без пересборки бабла', () => {
    const el = createMessageTime(at('2026-08-15T12:34:00'))
    // В документе, а не на весу: ядро находит узлы обходом
    // `document.querySelectorAll('.i18n')` — как и в бою.
    document.body.append(el)
    const [inFlow, inInner] = Array.from(el.querySelectorAll<HTMLElement>('.i18n'))

    I18n.setTimeFormat('h12')

    // Узлы те же самые — бабл никто не пересобирал, ядро дошло до них само.
    expect(Array.from(el.querySelectorAll('.i18n'))).toEqual([inFlow, inInner])
    expect(inFlow.textContent).toBe('12:34 PM')
    expect(inInner.textContent).toBe('12:34 PM')
  })
})
