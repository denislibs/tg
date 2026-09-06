// Отступы между частями времени бабла живут ТОЛЬКО в CSS.
//
// Части (`i.time-edited`, `span.post-views`, иконка «глаз», само время) стоят в
// `span.time` вплотную — ни пробелов, ни разделителей между ними рендер не
// кладёт. Разводит их одно правило: `.time-part { margin-inline-end: .375rem }`
// (tweb `src/scss/partials/_chatBubble.scss:1744-1747`, наш порт —
// `styles/tweb/_chatBubble.scss:1744-1747`), а класс на части вешает сборка
// времени (tweb `src/components/chat/messageRender.ts:278` — иконка просмотров,
// `:57` — метка правки).
//
// ЗАЧЕМ ОТДЕЛЬНЫЙ СТИЛЕВОЙ ПИН. Дефект, который он ловит, — «122:50» в ленте
// канала: счётчик просмотров вплотную к времени (минимум просмотров у поста — 1,
// `backend/internal/domain/mtmessage.go:355-361`, так что слипалось на каждом).
// Пины разметки (`components/chat/messageTime.test.ts`) сверяют ИМЕНА классов с
// живым дампом tweb и остаются зелёными, если правило `.time-part` обнулить или
// вынести из партиала: классы на месте, отступа нет, «122:50» вернулось. Поэтому
// здесь — НАСТОЯЩИЙ скомпилированный `styles/index.scss` поверх НАСТОЯЩЕЙ метки
// времени (`createMessageTime`), тем же способом, что `mediaLayering.test.ts`:
// удаление правила из партиала краснит прогон.
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { join } from 'node:path'
import * as sass from 'sass'
import { makeMessage } from '@core/messages/testMessage'
import type { MyMessage } from '@core/models'
import { createMessageTime } from '@components/chat/messageTime'
import '../test/lang'

let css: string

beforeAll(() => {
  css = sass.compile(join(__dirname, 'index.scss'), {
    loadPaths: [__dirname, join(__dirname, '..', '..', 'node_modules')],
    // Предупреждения вендорного tweb-SCSS к предмету теста отношения не имеют.
    silenceDeprecations: ['import', 'global-builtin', 'color-functions', 'legacy-js-api', 'slash-div'],
    quietDeps: true,
  }).css
})

afterEach(() => {
  document.head.replaceChildren()
  document.body.replaceChildren()
})

/** Пост канала: просмотры есть всегда, метка правки — по требованию. */
const post = (views: number, editedAt?: string): MyMessage => {
  const m = makeMessage({ peerId: 7, id: 1, text: 'привет', createdAt: '2026-08-15T22:50:00' })
  return {
    ...m,
    views,
    ...(editedAt ? { edit_date: Math.floor(new Date(editedAt).getTime() / 1000) } : {}),
  } as MyMessage
}

/**
 * Метка времени поста в её боевом окружении.
 *
 * Предок `.bubble` обязателен: правило компилируется в `.bubble .time-part`
 * (`&-part` вложен в `.time` внутри `.bubble`), и на весу метка отступа не
 * получит. Цепочка обёрток — из живого дампа tweb
 * (`docs/tweb/dom/dumps/20-channel-01-post-formatted.json:1` — дамп в одну
 * строку JSON; фрагмент `div.bubble.channel-post…` → `div.bubble-content-wrapper`
 * → `div.bubble-content` → `div.message.spoilers-container` → `span.time`).
 */
function mountPostTime(message: MyMessage): HTMLElement {
  const style = document.createElement('style')
  style.textContent = css
  document.head.append(style)

  const bubble = document.createElement('div')
  bubble.className = 'bubble channel-post is-in'
  const wrapper = document.createElement('div')
  wrapper.className = 'bubble-content-wrapper'
  const content = document.createElement('div')
  content.className = 'bubble-content'
  const text = document.createElement('div')
  text.className = 'message spoilers-container'

  const time = createMessageTime(message)
  text.append(time)
  content.append(text)
  wrapper.append(content)
  bubble.append(wrapper)
  document.body.append(bubble)

  return time
}

/**
 * Отступ ПОСЛЕ элемента — числом; отсутствие правила (пустая строка) считается
 * нулём. Сравнивается только «ноль или не ноль»: величина остаётся в тех
 * единицах, в которых записана в партиале, складывать их между собой незачем.
 */
function gapAfter(element: HTMLElement): number {
  const raw = getComputedStyle(element).marginInlineEnd.trim()
  if (raw === '') return 0
  const parsed = /^(-?\d*\.?\d+)(px|rem|em)?$/.exec(raw)
  if (!parsed) throw new Error(`отступ записан неожиданно: «${raw}»`)
  return Number(parsed[1])
}

describe('отступы частей времени бабла', () => {
  it('счётчик просмотров отделён от времени — иначе «1» и «22:50» читаются как «122:50»', () => {
    const time = mountPostTime(post(1))

    // Между счётчиком и временем стоит ровно один узел — иконка «глаз» (tweb
    // `messageRender.ts:278`, `:286`), она и несёт отступ.
    const icon = time.querySelector<HTMLElement>('.post-views')!.nextElementSibling as HTMLElement
    expect(icon.nextElementSibling!.textContent).toBe('22:50')

    expect(gapAfter(icon)).toBeGreaterThan(0)
  })

  it('отступ даёт класс `time-part` оригинала, а не соседние классы иконки', () => {
    const time = mountPostTime(post(1))
    const icon = time.querySelector<HTMLElement>('.time-icon-views')!
    const withPart = gapAfter(icon)
    expect(withPart).toBeGreaterThan(0)

    // Снятие класса оригинала обязано обнулить отступ. Если он приезжает
    // откуда-то ещё (`tgico`, `time-icon`, `time-icon-views`), пин смотрит не на
    // то правило и обнуления `.time-part` не заметит.
    icon.classList.remove('time-part')
    expect(gapAfter(icon)).toBe(0)

    icon.classList.add('time-part')
    expect(gapAfter(icon)).toBe(withPart)
  })

  // Второй отступ, который чинила ветка: метка правки идёт ПЕРЕД просмотрами
  // (tweb `messageRender.ts:298` — `args.unshift`) и отделена от них тем же
  // `time-part` (`:57` — `classList.add('time-edited', 'time-part')`). Метка
  // приходит в любом чате, не только в канале: обнуление правила слепляет
  // «edited» с соседней частью везде.
  it('метка edited отделена от просмотров тем же `time-part`', () => {
    const time = mountPostTime(post(780, '2026-08-15T22:55:00'))

    const edited = time.querySelector<HTMLElement>('.time-edited')!
    expect(time.firstElementChild).toBe(edited)
    expect(edited.nextElementSibling!.className).toBe('post-views')

    expect(gapAfter(edited)).toBeGreaterThan(0)

    edited.classList.remove('time-part')
    expect(gapAfter(edited)).toBe(0)
  })
})
