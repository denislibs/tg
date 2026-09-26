// React-двойник секции живёт, пока React-экраны не переехали на Solid `Section`
// (план волны 2D, задача 1). Стили у них общие (`styles/tweb/_section.scss` HEAD),
// поэтому и разметка обязана быть той же, что у tweb `section.tsx` (812502980):
// подпись — сосед карточки внутри контейнера (`:112`), заголовок — первым
// ребёнком контент-блока с классом `sidebar-left-h2` (`:101-107`). Сверено с
// дампами `14-left-14-settings-notifications` и `15-right-12-edit-group`.
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import SidebarSection from './SidebarSection'

afterEach(cleanup)

describe('SidebarSection: разметка tweb section.tsx', () => {
  it('подпись — последний ребёнок контейнера, вне карточки', () => {
    const { container: host } = render(
      <SidebarSection title="Звук" caption="Пояснение">
        <div className="child" />
      </SidebarSection>,
    )

    const container = host.querySelector<HTMLElement>('.sidebar-left-section-container')!
    const card = container.querySelector<HTMLElement>('.sidebar-left-section')!
    const caption = host.querySelector<HTMLElement>('.sidebar-left-section-caption')!

    expect(caption.parentElement).toBe(container)
    expect(card.contains(caption)).toBe(false)
    expect(container.lastElementChild).toBe(caption)
    expect(caption.className).toBe('sidebar-left-section-content sidebar-left-section-caption')
    expect(caption.textContent).toBe('Пояснение')
  })

  it('заголовок — первый ребёнок -content, div.sidebar-left-h2.sidebar-left-section-name', () => {
    const { container: host } = render(
      <SidebarSection title="Звук">
        <div className="child" />
      </SidebarSection>,
    )

    const content = host.querySelector<HTMLElement>('.sidebar-left-section > .sidebar-left-section-content')!
    const name = content.firstElementChild as HTMLElement

    expect(name.tagName).toBe('DIV')
    expect(name.className).toBe('sidebar-left-h2 sidebar-left-section-name')
    expect(name.textContent).toBe('Звук')
    expect(name.nextElementSibling!.className).toBe('child')
    // у карточки один ребёнок — контент-блок; заголовок не лежит рядом с ним
    expect(content.parentElement!.children.length).toBe(1)
  })

  it('без заголовка и подписи — контейнер > карточка > контент с детьми', () => {
    const { container: host } = render(
      <SidebarSection>
        <div className="child" />
      </SidebarSection>,
    )

    const container = host.firstElementChild as HTMLElement
    expect(container.className).toBe('sidebar-left-section-container')
    expect(container.children.length).toBe(1)
    const card = container.firstElementChild as HTMLElement
    expect(card.className).toBe('sidebar-left-section')
    expect(card.innerHTML).toBe('<div class="sidebar-left-section-content"><div class="child"></div></div>')
  })
})
