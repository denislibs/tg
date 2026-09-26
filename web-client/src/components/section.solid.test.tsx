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
import Section, { SectionName, appendSectionContent, type SectionParts } from './section.solid'

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

describe('section.solid: место подписи (tweb section.tsx:90, :109, :112)', () => {
  it('по умолчанию подпись — ПОСЛЕДНИЙ ребёнок контейнера, вне карточки (:112)', () => {
    const el = mount(() => <Section name="TranslateMessages" caption="ClearOtherSessionsHelp"><div /></Section>)

    const container = el.querySelector<HTMLElement>('.sidebar-left-section-container')!
    const card = container.querySelector<HTMLElement>('.sidebar-left-section')!
    const caption = container.querySelector<HTMLElement>('.sidebar-left-section-caption')!

    expect(caption).not.toBeNull()
    expect(card.contains(caption)).toBe(false)
    expect(caption.parentElement).toBe(container)
    expect(container.lastElementChild).toBe(caption)
    expect(caption.classList.contains('sidebar-left-section-content')).toBe(true)
  })

  it('captionOld кладёт подпись ВНУТРЬ карточки — после контент-блока (:109)', () => {
    const el = mount(() => <Section caption="ClearOtherSessionsHelp" captionOld><div /></Section>)

    const container = el.querySelector<HTMLElement>('.sidebar-left-section-container')!
    const card = el.querySelector<HTMLElement>('.sidebar-left-section')!
    const caption = el.querySelector<HTMLElement>('.sidebar-left-section-caption')!

    expect(caption.parentElement).toBe(card)
    expect(card.lastElementChild).toBe(caption)
    expect(container.children.length).toBe(1)
  })

  it('captionTop кладёт подпись ПЕРВЫМ ребёнком контейнера, над карточкой (:90)', () => {
    const el = mount(() => <Section caption="ClearOtherSessionsHelp" captionTop captionOld><div /></Section>)

    const container = el.querySelector<HTMLElement>('.sidebar-left-section-container')!
    const card = container.querySelector<HTMLElement>('.sidebar-left-section')!
    const captions = el.querySelectorAll('.sidebar-left-section-caption')

    // captionTop побеждает captionOld: подпись одна и стоит сверху
    expect(captions.length).toBe(1)
    expect(container.firstElementChild).toBe(captions[0])
    expect(captions[0].nextElementSibling).toBe(card)
  })

  it('noContent — одна подпись, без карточки (:91)', () => {
    const el = mount(() => <Section caption="ClearOtherSessionsHelp" noContent />)

    const container = el.querySelector<HTMLElement>('.sidebar-left-section-container')!
    expect(container.querySelector('.sidebar-left-section')).toBeNull()
    expect(container.children.length).toBe(1)
    expect(container.firstElementChild!.className).toBe('sidebar-left-section-content sidebar-left-section-caption')
  })
})

describe('section.solid: классы контейнера и карточки (tweb section.tsx:84-100)', () => {
  it('noMarginBottom — класс на КОНТЕЙНЕРЕ (:86), не на карточке и не атрибутом', () => {
    const el = mount(() => <Section noMarginBottom class="extra"><div /></Section>)

    const container = el.querySelector<HTMLElement>('.sidebar-left-section-container')!
    const card = container.querySelector<HTMLElement>('.sidebar-left-section')!

    expect(container.className).toBe('sidebar-left-section-container no-margin-bottom extra')
    expect(card.classList.contains('no-margin-bottom')).toBe(false)
    expect(container.hasAttribute('nomarginbottom')).toBe(false)
  })

  it('fakeGradientDelimiter — div.gradient-delimiter первым в карточке, до контент-блока (:100)', () => {
    const el = mount(() => <Section fakeGradientDelimiter innerClass="inner"><div /></Section>)

    const card = el.querySelector<HTMLElement>('.sidebar-left-section')!
    expect(card.className).toBe('sidebar-left-section inner')
    expect(card.firstElementChild!.className).toBe('gradient-delimiter')
    expect(card.firstElementChild!.nextElementSibling!.classList.contains('sidebar-left-section-content')).toBe(true)
  })

  it('contentProps целиком уходят на контент-блок (:44-58, :101)', () => {
    let contentRef: HTMLDivElement | undefined
    const el = mount(() => (
      <Section contentProps={{ class: 'search-group-content', ref: (r: HTMLDivElement) => contentRef = r, 'data-x': '1', style: { color: 'red' } } as never}>
        <div />
      </Section>
    ))

    const content = el.querySelector<HTMLElement>('.sidebar-left-section > .sidebar-left-section-content')!
    expect(content.className).toBe('sidebar-left-section-content search-group-content')
    expect(content.dataset.x).toBe('1')
    expect(content.style.color).toBe('red')
    expect(contentRef).toBe(content)
  })
})

describe('section.solid: заголовок — SectionName внутри контент-блока (tweb section.tsx:60-71, :101-107)', () => {
  it('заголовок — первый ребёнок -content, div.sidebar-left-h2.sidebar-left-section-name; nameRight — div в конце', () => {
    let nameRef: HTMLDivElement | undefined
    const el = mount(() => (
      <Section name="TranslateMessages" nameRef={(r) => nameRef = r} nameRight={<span class="r" />}>
        <div class="child" />
      </Section>
    ))

    const content = el.querySelector<HTMLElement>('.sidebar-left-section > .sidebar-left-section-content')!
    const name = content.firstElementChild as HTMLElement
    expect(name.className).toBe('sidebar-left-h2 sidebar-left-section-name')
    expect(nameRef).toBe(name)
    expect(name.lastElementChild!.className).toBe('sidebar-left-section-name-right')
    expect(name.lastElementChild!.querySelector('.r')).not.toBeNull()
    expect(name.nextElementSibling!.className).toBe('child')
  })

  it('SectionName экспортирован отдельно и без right не рисует правую часть', () => {
    const el = mount(() => <SectionName class="letter">A</SectionName>)

    const name = el.firstElementChild as HTMLElement
    expect(name.className).toBe('sidebar-left-h2 sidebar-left-section-name letter')
    expect(name.textContent).toBe('A')
    expect(name.querySelector('.sidebar-left-section-name-right')).toBeNull()
  })
})

describe('section.solid: appendSectionContent (tweb section.tsx:123-146)', () => {
  it('добавляет второй -content в ту же карточку, после первого', () => {
    const el = mount(() => <Section><div class="first" /></Section>)
    const container = el.querySelector<HTMLElement>('.sidebar-left-section-container')!

    const content = appendSectionContent(container)

    const card = container.querySelector<HTMLElement>('.sidebar-left-section')!
    expect(content.className).toBe('sidebar-left-section-content')
    expect(content.parentElement).toBe(card)
    expect(card.querySelectorAll(':scope > .sidebar-left-section-content').length).toBe(2)
    expect(card.lastElementChild).toBe(content)
  })

  it('на noContent бросает — дописывать некуда', () => {
    const el = mount(() => <Section caption="ClearOtherSessionsHelp" noContent />)
    const container = el.querySelector<HTMLElement>('.sidebar-left-section-container')!

    expect(() => appendSectionContent(container)).toThrow(/no content element/)
  })

  it('не-элемент (функция-мемо из dev-сборки) — бросает с причиной', () => {
    expect(() => appendSectionContent((() => null) as never)).toThrow(/expected the section element, got function/)
  })

  it('SectionParts описывает части секции', () => {
    const parts: SectionParts = { container: document.createElement('div'), content: document.createElement('div') }
    expect(parts.title).toBeUndefined()
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
