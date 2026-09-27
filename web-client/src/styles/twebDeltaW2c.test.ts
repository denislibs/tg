// Пины на СКОМПИЛИРОВАННЫЙ `styles/index.scss` для CSS-правок волны 2C дельты
// tweb e52b5d931 → 812502980 («Оболочка попапов на Solid», docs/tweb/popups-solid.md § 4).
// Приём — тот же, что у `styles/twebDeltaW2a.test.ts`: настоящая компиляция sass,
// проверяется то, что уедет в браузер. Каждый describe — отдельный коммит tweb.
import { beforeAll, describe, expect, it } from 'vitest'
import { join } from 'node:path'
import * as sass from 'sass'

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

describe('кнопки-иконки — основным цветом текста (tweb 69a759cbc)', () => {
  it('.btn-icon — --primary-text-color (_button.scss)', () => {
    expect(rule('.btn-icon')).toMatch(/color:\s*var\(--primary-text-color\)/)
    expect(rule('.btn-icon')).not.toMatch(/(?:^|[;\s])color:\s*var\(--secondary-text-color\)/)
  })

  it('заплатки крестика попапа сняты: ни подмены --secondary-text-color, ни отката у .old (_popup.scss)', () => {
    expect(css).not.toMatch(/\.popup:not\(\.old\) \.popup-close\s*\{/)
    expect(rule('.popup.old .popup-header .btn-icon')).toBeUndefined()
    expect(rule('.popup-header .btn-icon')).not.toMatch(/(?:^|[;\s])color:/)
  })

  it('полоски бургера/стрелки рисуются цветом кнопки (_animatedIcon.scss)', () => {
    expect(rule('.animated-menu-icon')).toMatch(/--color:\s*currentColor/)
    expect(rule('.animated-close-icon, .animated-close-icon:before, .animated-close-icon:after')).toMatch(/background-color:\s*currentColor/)
  })

  it('строка ввода: иконки без своего серого, открытая панель — серая плашка вместо primary (_chat.scss)', () => {
    expect(rule('.rows-wrapper .btn-icon')).not.toMatch(/(?:^|[;\s])color:/)
    const active = rule('.rows-wrapper .btn-icon.active')!
    expect(active).toMatch(/color:\s*var\(--primary-text-color\)/)
    expect(active).toMatch(/background-color:\s*var\(--light-secondary-text-color\)/)
    expect(css).not.toMatch(/\.attach-file\.menu-open\s*\{[^}]*color:\s*var\(--primary-color\)/)
  })

  it('крестик в шапке профиля больше не перекрашивает полоски отдельно (_profile.scss)', () => {
    expect(css).not.toMatch(/\.animated-close-icon:before,\s*[^{]*\.animated-close-icon:after\s*\{\s*background-color:\s*currentColor;\s*\}/)
  })
})

describe('стыки скролла и футера (tweb 2556fc949, _popup.scss:211-273, _popupVariables.scss:6-9)', () => {
  it('скролл — flex-ребёнок контейнера, а не абсолютный слой', () => {
    const r = rule('.popup .popup-container > .popup-scrollable')!
    expect(r).toMatch(/position:\s*relative/)
    expect(r).toMatch(/flex:\s*1 1 auto/)
    expect(r).toMatch(/min-height:\s*0/)
  })

  it('тело внутри скролла заполняет его и ничего не режет', () => {
    const r = rule('.popup .popup-scrollable > .popup-body')!
    expect(r).toMatch(/min-height:\s*100%/)
    expect(r).toMatch(/flex:\s*1 0 auto/)
    expect(r).toMatch(/overflow:\s*visible/)
  })

  it('перед футером в потоке скролл берёт 5px ($popup-scroll-bleed) и отдаёт их отрицательным отступом', () => {
    const r = rule('.popup-scrollable:has(+ .popup-footer-shaded)')!
    expect(r).toMatch(/padding-bottom:\s*5px/)
    expect(r).toMatch(/margin-bottom:\s*-5px/)
  })

  it('под плавающим футером скролл знает свой полезный край (tweb 472e3e76b, :243-245)', () => {
    expect(rule('.popup-container:has(> .popup-footer-floating) .scrollable-y')).toMatch(/scroll-padding-bottom:\s*var\(--popup-footer-height\)/)
  })

  it('футер в потоке рисует линию и фон, только пока под ним есть контент', () => {
    const r = rule('.popup .popup-footer-shaded')!
    expect(r).toMatch(/position:\s*relative/)
    expect(r).toMatch(/z-index:\s*1/)
    expect(r).toMatch(/border-top:\s*1px solid transparent/)
    expect(r).toMatch(/background-color:\s*transparent/)
    const notEnd = rule('.popup .popup-footer-shaded:not(.scrolled-end)')!
    expect(notEnd).toMatch(/border-top-color:\s*var\(--border-color\)/)
    expect(notEnd).toMatch(/background-color:\s*var\(--popup-background-color\)/)
  })

  it('последняя секция перед футером — без нижнего отступа (хвост 2D, :266-273)', () => {
    expect(css).toMatch(/\.popup-body:has\(\+ \.popup-footer\) \.sidebar-left-section-container:last-child,\s*\.popup-scrollable:has\(\+ \.popup-footer\) \.sidebar-left-section-container:last-child\s*\{\s*padding-bottom:\s*0;?\s*\}/)
  })
})

describe('иконка в кнопке попапа — один кегль, симметричные отступы (tweb 3eb7a9020, _popup.scss:362-372)', () => {
  it('.popup-button-icon — 1.25rem; слева −.1875/.1875, справа .1875/−.1875', () => {
    expect(rule('.popup-button-icon')).toMatch(/font-size:\s*1\.25rem/)
    expect(rule('.popup-button-icon.left')).toMatch(/margin-inline:\s*-0?\.1875rem 0?\.1875rem/)
    const right = rule('.popup-button-icon.right')!
    expect(right).toMatch(/margin-inline:\s*0?\.1875rem -0?\.1875rem/)
    expect(right).not.toMatch(/font-size/)
  })
})
