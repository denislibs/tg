/** @jsxImportSource solid-js */
// Примитив плашек шапки — порт tweb `chat/topbarPlate.tsx`: разметка классов
// `pinned-container`/`pinned-${modifier}-*` и императивный контроллер для классов.
import { describe, expect, it, vi } from 'vitest'
import '@/test/lang'
import TopbarPlate, { createTopbarPlate } from './topbarPlate.solid'

describe('createTopbarPlate', () => {
  it('строит дерево tweb с модификатором и прячет плашку до первого контента', () => {
    const onClick = vi.fn()
    const plate = createTopbarPlate({
      modifier: 'message',
      height: 48,
      render: () => (
        <TopbarPlate.Body onClick={onClick}>
          <TopbarPlate.Content>
            <TopbarPlate.Title>T</TopbarPlate.Title>
            <TopbarPlate.Subtitle>S</TopbarPlate.Subtitle>
          </TopbarPlate.Content>
        </TopbarPlate.Body>
      ),
    })

    const root = plate.container
    expect(root.className).toBe('pinned-container pinned-message hide')
    const wrapper = root.querySelector('.pinned-container-wrapper.pinned-message-wrapper')!
    expect(wrapper).not.toBeNull()
    // кликабельное тело делает содержимое кнопкой (tweb PlateBodyContext)
    const content = wrapper.querySelector('.pinned-container-content.pinned-message-content')!
    expect(content.tagName).toBe('BUTTON')
    expect(content.querySelector('.pinned-container-title.pinned-message-title')!.textContent).toBe('T')
    expect(content.querySelector('.pinned-container-subtitle.pinned-message-subtitle')!.textContent).toBe('S')
    // Solid делегирует клики документу — плашка должна стоять в DOM
    document.body.append(root)
    ;(wrapper as HTMLElement).click()
    expect(onClick).toHaveBeenCalledTimes(1)

    plate.destroy()
  })

  it('setHidden переключает `hide` и зовёт onVisibilityChange только на смену', () => {
    const onVisibilityChange = vi.fn()
    const plate = createTopbarPlate({ modifier: 'audio', height: 48, onVisibilityChange, render: () => <span /> })

    expect(plate.isVisible()).toBe(false)
    plate.setHidden(false)
    plate.setHidden(false)
    expect(plate.container.classList.contains('hide')).toBe(false)
    expect(plate.isVisible()).toBe(true)
    expect(onVisibilityChange).toHaveBeenCalledTimes(1)
    expect(onVisibilityChange).toHaveBeenLastCalledWith(true)

    plate.setHidden(true)
    expect(plate.container.classList.contains('hide')).toBe(true)
    expect(onVisibilityChange).toHaveBeenLastCalledWith(false)

    document.body.append(plate.container)
    plate.destroy()
    expect(plate.container.isConnected).toBe(false)
  })

  it('реактивный class добавляется к корню', () => {
    const plate = createTopbarPlate({ modifier: 'message', height: 48, initiallyHidden: false, class: () => 'is-many', render: () => <span /> })
    expect(plate.container.className).toBe('pinned-container pinned-message is-many')
    plate.destroy()
  })
})
