// Кликабельная накладка варианта опроса живёт ТОЛЬКО в CSS.
//
// В оригинале по варианту кликают не по строке, а по накладке поверх неё:
// `.clickableArea` — абсолютный слой на всю строку варианта, и обработчик
// голосования висит на нём (tweb `src/components/chat/bubbleParts/
// pollMessageContent/PollOption.tsx:120-130`, стиль — `styles.module.scss:198-217`).
// Строка варианта (`.pollOption`) для него — база позиционирования
// (`position: relative`, `styles.module.scss:31-33`), поэтому `inset: 0` +
// `100%×100%` дают накладке ровно габариты варианта.
//
// ЗАЧЕМ ОТДЕЛЬНЫЙ СТИЛЕВОЙ ПИН. На узел накладки `ripple()` вешает ВТОРОЙ класс —
// глобальный `rp` (наш `components/ripple.ts`, порт tweb `src/components/ripple.ts`;
// в оригинале это директива `use:ripple`, PollOption.tsx:128). Глобальное правило
// `.rp { position: relative }` (`styles/tweb/_ripple.scss:1-3` = tweb
// `src/scss/partials/_ripple.scss:1-3`) равно по специфичности модульному
// `.clickableArea`, а значит спор решает ПОРЯДОК правил в итоговом css. У tweb
// порядок «правильный» сам собой: тело опроса приезжает динамическим импортом
// (tweb `src/components/chat/bubbles.ts:8763`), css-модуль уходит в отдельный
// асинхронный чанк и подключается после основной таблицы. У нас модуль
// импортируется статически (`components/chat/bubbles.ts:141`) и в собранном
// `index-*.css` лежит ПЕРЕД партиалами — побеждал `.rp`.
//
// Цена проигрыша — не косметика: накладка переставала быть абсолютной,
// становилась обычным flex-ребёнком строки варианта и
//   • теряла высоту (`height: 100%` от неопределённой высоты flex-родителя → 0),
//     так что мышью проголосовать было НЕЛЬЗЯ вовсе (замер в Chrome по
//     настоящей разметке: `clickableArea` 187.3×0, 15 из 15 точек сетки 3×5 по
//     площади варианта попадали в `.pollOption`, а не в накладку);
//   • съедала ширину у подписи (`labelText` 11.3px — перенос по одной букве,
//     высота варианта 318px вместо 48).
// После починки те же замеры: накладка 264.6×48 — ровно габариты варианта,
// подпись 194.6px, вариант 48px, все 15 точек попадают внутрь накладки.
//
// Пины разметки (`components/chat/bubbles.poll.test.ts`) этого не ловят: они
// кликают по узлу программно (`dispatchEvent`), и обработчику всё равно, какого
// размера его элемент. Поэтому здесь — НАСТОЯЩИЙ скомпилированный css поверх
// НАСТОЯЩЕЙ разметки опроса (`createPollMessageContent`), тем же способом, что
// `mediaLayering.test.ts` и `timePart.test.ts`.
import { beforeAll, afterEach, describe, expect, it } from 'vitest'
import { join } from 'node:path'
import * as sass from 'sass'
import { createPollMessageContent } from '@components/messages/pollMessageContent'
import { pollOptionKey, type MessageMediaPoll } from '@core/media/messageMedia'
import styles from '@components/messages/pollMessageContent.module.scss'
import '../test/lang'

let globalCss: string
let moduleCss: string

const compile = (file: string) => sass.compile(file, {
  loadPaths: [__dirname, join(__dirname, '..', '..', 'node_modules')],
  // Предупреждения вендорного tweb-SCSS к предмету теста отношения не имеют.
  silenceDeprecations: ['import', 'global-builtin', 'color-functions', 'legacy-js-api', 'slash-div'],
  quietDeps: true,
}).css

beforeAll(() => {
  globalCss = compile(join(__dirname, 'index.scss'))

  // Sass компилирует модуль с ЛОКАЛЬНЫМИ именами классов (`.clickableArea`), а в
  // DOM они приезжают уже хешированными: разметку строит настоящая фабрика,
  // берущая имена из импорта `styles`. Переводим селекторы тем же словарём —
  // иначе css и разметка не сошлись бы и пин охранял бы пустоту.
  //
  // Ключи у `styles` не перечислить (вне сборки это прокси без собственных
  // свойств, `Object.keys` даёт пусто), поэтому имена берём из самого css — и
  // только из строк-СЕЛЕКТОРОВ: у `sass` в развёрнутом выводе это ровно строки,
  // кончающиеся на `{`. Обёртки `:global(…)` разворачиваются в глобальные
  // селекторы — в сборке это делает vite, здесь мы.
  const names = styles as unknown as Record<string, string>
  moduleCss = compile(join(__dirname, '..', 'components', 'messages', 'pollMessageContent.module.scss'))
    .split('\n')
    .map((line) => {
      if (!line.trimEnd().endsWith('{')) return line
      // Содержимое `:global(…)` прячем за номер, чтобы переименование его не
      // задело, и возвращаем на место уже без обёртки.
      const globals: string[] = []
      return line
        .replace(/:global\(([^)]*)\)/g, (_, selector: string) => ` ${globals.push(selector) - 1} `)
        .replace(/\.(-?[A-Za-z_][\w-]*)/g, (_, local: string) => `.${names[local]}`)
        .replace(/ (\d+) /g, (_, index: string) => globals[+index])
    })
    .join('\n')
})

afterEach(() => {
  document.head.replaceChildren()
  document.body.replaceChildren()
})

const media = (): MessageMediaPoll => ({
  _: 'messageMediaPoll',
  poll: {
    _: 'poll',
    id: 500,
    pFlags: {},
    question: { _: 'textWithEntities', text: 'Любимый цвет?', entities: [] },
    answers: ['Красный', 'Зелёный'].map((text, i) => ({
      _: 'pollAnswer' as const,
      text: { _: 'textWithEntities' as const, text, entities: [] },
      option: pollOptionKey(i),
    })),
  },
  results: {
    _: 'pollResults',
    total_voters: 0,
    results: ['Красный', 'Зелёный'].map((_, i) => ({
      _: 'pollAnswerVoters' as const,
      option: pollOptionKey(i),
      voters: 0,
      pFlags: {},
    })),
  },
})

/**
 * Опрос в боевом окружении: настоящее тело (`createPollMessageContent`) под
 * настоящими стилями.
 *
 * ПОРЯДОК ТАБЛИЦ ЗДЕСЬ ЗНАЧИМ и повторяет сборку: сперва css-модуль, потом
 * глобальные партиалы — ровно так их кладёт наш `vite build` (замер на сборке
 * ДО починки: `._clickableArea_*{…position:absolute}` на смещении 57188
 * `index-*.css`, `.rp{position:relative}` — на 128695). Поменяй порядок — и
 * спор равных по специфичности правил решится сам собой, а пин перестанет
 * что-либо охранять: с обратным порядком он зеленеет даже с вернувшимся
 * дефектом (проверено мутацией).
 */
function mountPoll() {
  const moduleStyle = document.createElement('style')
  moduleStyle.textContent = moduleCss
  const globalStyle = document.createElement('style')
  globalStyle.textContent = globalCss
  document.head.append(moduleStyle, globalStyle)

  const handle = createPollMessageContent({ media: media(), text: '', entities: undefined, isOutgoing: false })

  // Цепочка обёрток бабла — как её строит лента (`components/chat/bubbles.ts`,
  // порт tweb bubbles.ts:8810 `messageDiv.prepend(container)`).
  const bubble = document.createElement('div')
  bubble.className = 'bubble is-in poll-message'
  const wrapper = document.createElement('div')
  wrapper.className = 'bubble-content-wrapper'
  const content = document.createElement('div')
  content.className = 'bubble-content'
  const messageDiv = document.createElement('div')
  messageDiv.className = 'message spoilers-container'

  messageDiv.append(handle.element)
  content.append(messageDiv)
  wrapper.append(content)
  bubble.append(wrapper)
  document.body.append(bubble)

  const option = handle.element.querySelector<HTMLElement>('[data-poll-option-idx="0"]')!
  return { option, area: option.firstElementChild as HTMLElement }
}

describe('кликабельная накладка варианта опроса', () => {
  it('накладка абсолютна и растянута на весь вариант — иначе по варианту не кликнуть', () => {
    const { option, area } = mountPoll()

    // Она и правда несёт оба спорящих класса — иначе пин охранял бы пустоту.
    expect(area.classList.contains('rp')).toBe(true)

    const areaStyle = getComputedStyle(area)
    expect(areaStyle.position).toBe('absolute')
    expect([areaStyle.top, areaStyle.left]).toEqual(['0px', '0px'])
    expect([areaStyle.width, areaStyle.height]).toEqual(['100%', '100%'])

    // `100%` считаются от строки варианта, поэтому она обязана быть базой
    // позиционирования (tweb styles.module.scss:31-33).
    expect(getComputedStyle(option).position).toBe('relative')
  })

  it('накладка вне потока строки: ширину flex-строки делят чекбокс, распорка и подпись', () => {
    const { option, area } = mountPoll()

    const inFlow = Array.from(option.children).filter(
      (child) => getComputedStyle(child as HTMLElement).position !== 'absolute',
    )
    expect(inFlow).not.toContain(area)
    // Ровно трое: `checkContainer`, `pollOptionSpacerFirst`, `labelRow`
    // (tweb PollOption.tsx:131-156).
    expect(inFlow).toHaveLength(3)
    expect((inFlow[2] as HTMLElement).classList.contains(styles.labelRow)).toBe(true)
  })
})
