/** @jsxImportSource solid-js */
/**
 * Пины порта `topbarPlate.solid.tsx` (tweb `chat/topbarPlate.tsx`): контроллер
 * `createTopbarPlate` — то, через что шапка (`topbar.setFloating`) видит плашки.
 */
import { describe, expect, it, vi } from 'vitest'
import TopbarPlate, { createTopbarPlate } from './topbarPlate.solid'

describe('createTopbarPlate', () => {
  it('строит .pinned-container.pinned-<modifier> скрытым, классы частей — по модификатору', () => {
    const plate = createTopbarPlate({
      modifier: 'requests',
      height: 48,
      render: () => (
        <TopbarPlate.Body>
          <TopbarPlate.Content>
            <TopbarPlate.Title>title</TopbarPlate.Title>
            <TopbarPlate.Subtitle>subtitle</TopbarPlate.Subtitle>
          </TopbarPlate.Content>
        </TopbarPlate.Body>
      ),
    })

    const { container } = plate
    expect(container.classList.contains('pinned-container')).toBe(true)
    expect(container.classList.contains('pinned-requests')).toBe(true)
    expect(container.classList.contains('hide')).toBe(true)
    expect(plate.isVisible()).toBe(false)
    expect(plate.height).toBe(48)
    expect(container.querySelector('.pinned-container-wrapper.pinned-requests-wrapper')).not.toBeNull()
    expect(container.querySelector('.pinned-requests-title')?.textContent).toBe('title')
    expect(container.querySelector('.pinned-requests-subtitle')?.textContent).toBe('subtitle')
    plate.destroy()
  })

  it('setHidden переключает `hide` и зовёт onVisibilityChange только на смене', () => {
    const onVisibilityChange = vi.fn()
    const plate = createTopbarPlate({
      modifier: 'actions',
      height: 'auto',
      onVisibilityChange,
      render: () => <div />,
    })

    plate.setHidden(false)
    plate.setHidden(false)
    expect(plate.container.classList.contains('hide')).toBe(false)
    expect(plate.isVisible()).toBe(true)
    expect(onVisibilityChange).toHaveBeenCalledTimes(1)
    expect(onVisibilityChange).toHaveBeenLastCalledWith(true)

    plate.setHidden(true)
    expect(plate.container.classList.contains('hide')).toBe(true)
    expect(onVisibilityChange).toHaveBeenLastCalledWith(false)
    plate.destroy()
  })

  it('destroy снимает узел из родителя', () => {
    const plate = createTopbarPlate({ modifier: 'live', height: 48, initiallyHidden: false, render: () => <div /> })
    const host = document.createElement('div')
    host.append(plate.container)
    plate.destroy()
    expect(host.childElementCount).toBe(0)
  })
})
