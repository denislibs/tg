// Правая колонка: каждая кастомная проперти, которую её правила читают БЕЗ
// фолбэка, обязана быть объявлена — в CSS или в JS.
//
// Зачем пин: `var(--нет-такой)` без фолбэка делает объявление «invalid at
// computed-value time», и свойство откатывается к НАЧАЛЬНОМУ значению. Для
// `transform` это `none` — правило просто исчезает, молча, без единой ошибки в
// консоли. Ни сборка, ни тайпчек, ни линт этого не видят.
//
// Ровно так сломалась правая колонка: партиал `_rightSidebar.scss` портировали
// дословно, а определение `--safe-area-inset-inline-end` (tweb `base.scss:37`,
// где у него и комментарий «0 here is the no-env() fallback so calc() consumers
// never see an undefined var») в порт не попало. Закрытое состояние
// `#column-right` считается через эту переменную, поэтому `transform` стал
// `none`: панель не уезжала за край — «не закрывается», — а открытое и закрытое
// состояния совпали, так что анимировать открытие было нечего. Одна пропущенная
// строка, два симптома, найдено только глазами на стенде.
//
// Периметр — только `#column-right`. Общий скан по всему бандлу показывает ещё
// ~76 неопределённых имён, но подавляющее большинство из них — токены темы,
// которые ставит рантайм (`themeController`), и отделить их от настоящих дыр
// можно только отдельным разбором. Это отдельная задача, а не предмет этого
// теста.
//
// Тест гоняет НАСТОЯЩИЙ скомпилированный `styles/index.scss` — по образцу
// `mediaLayering.test.ts`.
import { describe, expect, it, beforeAll } from 'vitest'
import { join } from 'node:path'
import * as sass from 'sass'

/**
 * Проперти правой колонки, которые CSS сознательно не объявляет: их ставит JS.
 * Список — документация контракта; расширять только вместе со ссылкой на место,
 * где переменная реально выставляется.
 */
const SET_BY_JS = new Set<string>([
  // core/dom/updateColumnWidths.ts
  '--right-column-width',
  '--page-chats-padding',
])

let css: string

beforeAll(() => {
  css = sass.compile(join(__dirname, 'index.scss'), {
    loadPaths: [__dirname, join(__dirname, '..', '..', 'node_modules')],
    // Предупреждения вендорного tweb-SCSS к предмету теста отношения не имеют.
    silenceDeprecations: ['import', 'global-builtin', 'color-functions', 'legacy-js-api', 'slash-div'],
    quietDeps: true,
  }).css
})

/** Тела правил, чей селектор упоминает #column-right. */
function columnRightBodies(source: string): string[] {
  const out: string[] = []
  for (const m of source.matchAll(/([^{}]*#column-right[^{}]*)\{([^{}]*)\}/g)) out.push(m[2])
  return out
}

describe('правая колонка: чтения кастомных пропертей объявлены', () => {
  it('правила #column-right не читают необъявленных переменных без фолбэка', () => {
    const declared = new Set([...css.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]))
    const bodies = columnRightBodies(css)
    // Страховка от «тест позеленел, потому что ничего не нашёл»: селектор мог
    // измениться при следующем порте, и тогда пин обязан упасть, а не молчать.
    expect(bodies.length).toBeGreaterThan(0)

    const missing = new Set<string>()
    for (const body of bodies) {
      // Вторая группа — символ сразу за именем: запятая означает фолбэк
      // (`var(--x, 0px)`), такое чтение безопасно даже без объявления.
      for (const m of body.matchAll(/var\(\s*(--[\w-]+)\s*([,)])/g)) {
        if (m[2] === ',') continue
        if (declared.has(m[1]) || SET_BY_JS.has(m[1])) continue
        missing.add(m[1])
      }
    }
    expect([...missing].sort()).toEqual([])
  })

  it('закрытое состояние #column-right реально уезжает за край', () => {
    // Само правило обязано существовать: без него панель остаётся на экране,
    // даже когда `body.is-right-column-shown` снят.
    const closed = columnRightBodies(css).find((b) => /transform:\s*translate3d\(calc\(/.test(b))
    expect(closed).toBeTruthy()
    expect(closed).toMatch(/--right-column-width/)
  })
})

describe('константы tweb base.scss, чьи потребители к нам доехали', () => {
  /**
   * Каждая из этих пропертей читается нашими правилами БЕЗ фолбэка, и каждая
   * когда-то отсутствовала — вместе с правилом, которое её читает. Это тот же
   * класс дефекта, что и `--safe-area-inset-inline-end`, найденный на стенде:
   * партиал портируют, определение из `base.scss` — нет.
   */
  const PORTED = [
    '--z-below',
    '--reaction-paid-transition',
    '--call-button-size',
    '--call-button-margin',
    '--premium-gradient',
    '--input-message-placeholder-color',
    '--premium-color',
    '--avatar-border-radius-forum',
  ]

  it.each(PORTED)('%s объявлена', (name) => {
    expect(css).toMatch(new RegExp(`${name}\\s*:`))
  })

  /**
   * Палитра аватарок: генератор `avatar-color` (`_functions.scss`) у нас был, а
   * восьми его вызовов (tweb base.scss:168-176) не было — то есть миксин стоял
   * мёртвым, а `--color-top`/`--color-bottom` в `tweb/_avatar.scss` умирали.
   * "saved" закомментирован и в оригинале, поэтому его здесь нет.
   */
  const AVATAR_COLORS = ['red', 'orange', 'violet', 'green', 'cyan', 'blue', 'pink', 'archive']

  it.each(AVATAR_COLORS)('палитра аватарки "%s" объявлена сверху и снизу', (color) => {
    expect(css).toMatch(new RegExp(`--peer-avatar-${color}-top\\s*:`))
    expect(css).toMatch(new RegExp(`--peer-avatar-${color}-bottom\\s*:`))
  })
})
