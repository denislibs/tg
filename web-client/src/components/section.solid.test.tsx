/** @jsxImportSource solid-js */
/**
 * Тесты порта `section.solid.tsx`.
 *
 * Предмет — ДВА уровня узлов и МЕСТО подписи. Оба легко «упростить» в порту до
 * одного узла и одного места, и оба тогда молча разъедутся со стилями:
 * внешний `…-container` несёт только боковые отступы, внутренний
 * `sidebar-left-section` — фон, тень и скругление (`styles/tweb/_section.scss`).
 * Подпись под карточкой (по умолчанию) и подпись ВНУТРИ карточки (`captionOld`)
 * — разные визуальные роли, у них разные соседи по вертикали.
 *
 * Заодно закреплено, что заголовок и подпись едут КЛЮЧОМ: секция строит узел
 * ядром `i18n(key)`, а не берёт готовую строку. Иначе смена языка при открытой
 * вкладке оставила бы секцию на прежнем языке — та же половина раскола
 * контракта, что задача #113 вычищала у lang-key-опций.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { render } from 'solid-js/web'
import I18n from '@lib/langPack'
import Section from './section.solid'

let dispose: (() => void) | undefined
let host: HTMLDivElement | undefined

function mount(component: () => unknown) {
  host = document.createElement('div')
  document.body.append(host)
  dispose = render(component as () => never, host)
  return host
}

afterEach(() => {
  dispose?.()
  host?.remove()
  dispose = undefined
  host = undefined
})

describe('section.solid: структура карточки', () => {
  it('внешний контейнер и внутренняя карточка — РАЗНЫЕ узлы', () => {
    const el = mount(() => <Section><div class="child" /></Section>)

    const container = el.querySelector<HTMLElement>('.sidebar-left-section-container')!
    const card = container.querySelector<HTMLElement>('.sidebar-left-section')!

    expect(card).not.toBe(container)
    expect(card.parentElement).toBe(container)
    expect(card.querySelector('.sidebar-left-section-content .child')).not.toBeNull()
  })

  it('noShadow/noDelimiter садятся на КАРТОЧКУ, а не на контейнер', () => {
    const el = mount(() => <Section noShadow noDelimiter><div /></Section>)

    const container = el.querySelector<HTMLElement>('.sidebar-left-section-container')!
    const card = container.querySelector<HTMLElement>('.sidebar-left-section')!

    expect(card.classList.contains('no-shadow')).toBe(true)
    expect(card.classList.contains('no-delimiter')).toBe(true)
    expect(container.classList.contains('no-shadow')).toBe(false)
  })
})

describe('section.solid: место подписи', () => {
  it('по умолчанию подпись СНАРУЖИ карточки', () => {
    const el = mount(() => <Section caption="ClearOtherSessionsHelp"><div /></Section>)

    const container = el.querySelector<HTMLElement>('.sidebar-left-section-container')!
    const card = container.querySelector<HTMLElement>('.sidebar-left-section')!
    const caption = container.querySelector<HTMLElement>('.sidebar-left-section-caption')!

    expect(caption).not.toBeNull()
    expect(card.contains(caption)).toBe(false)
    expect(caption.parentElement).toBe(container)
  })

  it('captionOld кладёт подпись ВНУТРЬ карточки', () => {
    const el = mount(() => <Section caption="ClearOtherSessionsHelp" captionOld><div /></Section>)

    const card = el.querySelector<HTMLElement>('.sidebar-left-section')!
    const caption = el.querySelector<HTMLElement>('.sidebar-left-section-caption')!

    expect(card.contains(caption)).toBe(true)
  })
})

describe('section.solid: заголовок и подпись — ключи, а не строки', () => {
  it('заголовок строится ядром i18n и попадает в его weakMap', () => {
    const el = mount(() => <Section name="TranslateMessages"><div /></Section>)

    const name = el.querySelector<HTMLElement>('.sidebar-left-section-name')!
    // Узел заголовка кладёт `i18n(key)`; принадлежность ядру проверяется его
    // же реестром — снятая со строки подпись в weakMap не попала бы.
    const node = name.firstElementChild as HTMLElement
    expect(I18n.weakMap.get(node)).toBeDefined()
  })
})
