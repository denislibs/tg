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

describe('иконка строки — плашка 30×30 (tweb 2197fee9c, _row.scss)', () => {
  it('.row-icon — абсолютная плашка .75rem от края, 1.875rem, скругление .625rem, глиф по центру', () => {
    const r = rule('.row-with-padding .row-icon')!
    expect(r).toMatch(/inset-inline-start:\s*0?\.75rem/)
    expect(r).toMatch(/width:\s*1\.875rem/)
    expect(r).toMatch(/height:\s*1\.875rem/)
    expect(r).toMatch(/border-radius:\s*0?\.625rem/)
    expect(r).toMatch(/display:\s*flex/)
    expect(r).toMatch(/justify-content:\s*center/)
    expect(r).toMatch(/font-size:\s*1\.5rem/)
  })

  it('глиф внутри наследует кегль плашки, на цветной плашке он белый', () => {
    expect(rule('.row-with-padding .row-icon-icon')).toMatch(/font-size:\s*inherit/)
    expect(rule('.row-with-padding .row-icon-colored')).toMatch(/color:\s*#fff/)
  })

  it('строка без подписи — 3.375rem (было 3rem)', () => {
    expect(css).toMatch(/\.row\.no-subtitle,\s*\.row\.row-small\s*\{[^}]*min-height:\s*3\.375rem/)
  })
})

describe('переключатель перерисован (tweb 2197fee9c, _checkbox.scss)', () => {
  it('дорожка 2.625rem × 1.5rem с рамкой 2px, прозрачная в выключенном', () => {
    const r = rule('.checkbox-field-toggle .checkbox-toggle')!
    expect(r).toMatch(/--toggle-width:\s*2\.625rem/)
    expect(r).toMatch(/height:\s*var\(--size\)/)
    expect(r).toMatch(/border:\s*2px solid var\(--secondary-color\)/)
    expect(r).toMatch(/background-color:\s*transparent/)
    expect(rule('.checkbox-field-toggle')).toMatch(/--size:\s*1\.5rem/)
  })

  it('кружок 1rem, в выключенном scale(.75), во включённом — цвета поверхности и scale(1)', () => {
    expect(rule('.checkbox-field-toggle .checkbox-toggle-circle')).toMatch(/scale\(0\.75\)/)
    expect(css).toMatch(/\.checkbox-field-toggle \[type=checkbox\]:checked:not\(\.is-fake-disabled\) \+ \.checkbox-toggle \.checkbox-toggle-circle\s*\{[^}]*background-color:\s*var\(--surface-color\)[^}]*scale\(1\)/)
  })
})

describe('поля строки — по классам row-* (tweb 803f9599d → ef41b29db, _row.scss)', () => {
  it('раскладка чекбокса/радио строки целится в row-checkbox-field / row-radio-field', () => {
    expect(rule('.row .row-checkbox-field')).toMatch(/position:\s*absolute/)
    expect(rule('.row .row-radio-field')).toMatch(/margin-top:\s*0/)
    expect(rule('.row-grid > .row-checkbox-field')).toMatch(/grid-area:\s*left/)
  })

  it('чужой чекбокс внутри строки раскладку строки не подхватывает', () => {
    expect(css).not.toMatch(/\.row \.checkbox-field\b/)
    expect(css).not.toMatch(/\.row \.radio-field\b/)
  })

  it('ряд заголовка/подписи в grid-строке и правый контрол (ef41b29db)', () => {
    expect(rule('.row-grid .row-title-row')).toMatch(/grid-area:\s*title/)
    expect(rule('.row-grid .row-subtitle-row')).toMatch(/grid-area:\s*subtitle/)
    expect(rule('.row-title-right-with-control')).toMatch(/gap:\s*0?\.5rem/)
  })
})

// Регрессия стенда (волна 2A): с ef41b29db `_row.scss` даёт
// `.row .row-checkbox-field { position: absolute }`, а тумблер строки лежит в
// `.row-title-right` (ноль ширины, `overflow: hidden`) — с этим классом он
// обрезается целиком, и на экране «Уведомления и звуки» пропали все тумблеры.
// Тумблер строки носит только `row-checkbox-field-toggle` — как у tweb HEAD
// (ef41b29db снял с него `row-checkbox-field`, `rowTsx.tsx:482-492`; у нас —
// `components/rowFieldClasses.ts`); здесь — что именно этот набор классов не
// выбивает его из потока.
describe('тумблер строки остаётся в потоке (классы tweb HEAD, rowFieldClasses.ts)', () => {
  function toggleIn(extra: string) {
    const style = document.createElement('style')
    style.textContent = css
    document.head.append(style)
    document.body.innerHTML = `<label class="row no-subtitle row-with-toggle"><div class="row-row row-title-row">
      <div class="row-title">Звук</div><div class="row-title row-title-right">
      <label class="checkbox-field checkbox-without-caption checkbox-field-toggle ${extra}"></label>
      </div></div></label>`
    const pos = getComputedStyle(document.querySelector('.checkbox-field-toggle')!).position
    style.remove()
    document.body.replaceChildren()
    return pos
  }

  it('с классами наших строк — relative (виден)', () => {
    expect(toggleIn('row-checkbox-field-toggle')).toBe('relative')
  })

  it('с набором 803f9599d (`row-checkbox-field` + toggle) — absolute, потому ef41b29db его и снял', () => {
    expect(toggleIn('row-checkbox-field row-checkbox-field-toggle')).toBe('absolute')
  })
})
