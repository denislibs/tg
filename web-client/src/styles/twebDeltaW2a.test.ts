// Пины на СКОМПИЛИРОВАННЫЙ `styles/index.scss` для CSS-правок волны 2A дельты
// tweb e52b5d931 → 812502980 («Иконки и строки», docs/tweb/delta/README.md).
// Приём — тот же, что у `styles/twebDeltaW1.test.ts`: настоящая компиляция sass,
// проверяется то, что уедет в браузер. Каждый describe — отдельный коммит tweb.
import { beforeAll, describe, expect, it } from 'vitest'
import { join } from 'node:path'
import * as sass from 'sass'
import Icons from '@core/tgico-icons'

let css: string

beforeAll(() => {
  css = sass.compile(join(__dirname, 'index.scss'), {
    loadPaths: [__dirname, join(__dirname, '..', '..', 'node_modules')],
    silenceDeprecations: ['import', 'global-builtin', 'color-functions', 'legacy-js-api', 'slash-div'],
    quietDeps: true,
  }).css
})

/** Тела всех правил с ТОЧНО таким селектором (склеены), `undefined` — нет ни одного. */
function rule(selector: string): string | undefined {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const bodies = [...css.matchAll(new RegExp(`(?:^|[}\\n])\\s*${esc}\\s*\\{([^}]*)\\}`, 'g'))].map((m) => m[1])
  return bodies.length ? bodies.join('\n') : undefined
}

/** `content` глифа так, как его пишет sass: экранированный кодпоинт или сам символ. */
const glyphContent = (code: string) => new RegExp(`content:\\s*"(?:\\\\${code}|${String.fromCharCode(parseInt(code, 16))})"`)

describe('глиф цитаты в блоке quote (tweb 12eeb9b1c, _quote.scss)', () => {
  it('угловая иконка цитаты — `quote_filled`, а не контурный `quote`', () => {
    expect(rule('.quote-like-icon:after')).toMatch(glyphContent(Icons.quote_filled))
    expect(rule('.quote-like-icon:after')).not.toMatch(glyphContent(Icons.quote))
  })
})
