// Пины базы хелперов автокомплита (П-6, Б-34; порт tweb `chat/autocompleteHelper.ts` и
// `autocompleteHelperController.ts`): показ одного хелпера прячет остальные, кроме
// «соседей» (эмодзи + стикеры видны вместе); Esc (запись `autocomplete-helper` в стеке
// навигации) прячет хелпер; стрелки и Enter выбирают пункт списка.
import { afterEach, describe, expect, test, vi } from 'vitest'
import appNavigationController from '@core/navigation/appNavigationController'
import AutocompleteHelper from './autocompleteHelper'
import AutocompleteHelperController from './autocompleteHelperController'

class TestHelper extends AutocompleteHelper {
  constructor(appendTo: HTMLElement, controller: AutocompleteHelperController, onSelect = vi.fn()) {
    super({ appendTo, controller, listType: 'y', onSelect })
  }

  public show(items: string[]) {
    if(!this.list) {
      this.list = document.createElement('div')
      this.container.append(this.list)
    }

    this.list.replaceChildren(...items.map((text) => {
      const div = document.createElement('div')
      div.textContent = text
      return div
    }))
    this.toggle(false)
  }

  public get isHidden() {
    return this.hidden
  }
}

const visible = (helper: AutocompleteHelper) => helper.container.classList.contains('forwards')

afterEach(() => {
  document.body.replaceChildren()
})

describe('AutocompleteHelper + контроллер', () => {
  test('показ одного прячет другие; соседи остаются видимы вместе', () => {
    const root = document.createElement('div')
    document.body.append(root)
    const controller = new AutocompleteHelperController()
    const a = new TestHelper(root, controller)
    const b = new TestHelper(root, controller)
    const c = new TestHelper(root, controller)
    a.addSibling(b)

    c.show(['c'])
    expect(visible(c)).toBe(true)

    a.show(['a'])
    expect(visible(a)).toBe(true)
    expect(c.isHidden).toBe(true)

    b.show(['b'])
    expect(a.isHidden).toBe(false)
    expect(b.isHidden).toBe(false)

    controller.hideOtherHelpers()
    expect(a.isHidden && b.isHidden && c.isHidden).toBe(true)
  })

  test('Esc (запись стека навигации) прячет видимый хелпер', () => {
    const root = document.createElement('div')
    document.body.append(root)
    const helper = new TestHelper(root, new AutocompleteHelperController())
    helper.show(['a'])
    expect(helper.isHidden).toBe(false)

    appNavigationController.back('autocomplete-helper')
    expect(helper.isHidden).toBe(true)
  })

  test('стрелка вниз и Enter выбирают пункт списка', () => {
    const root = document.createElement('div')
    document.body.append(root)
    const onSelect = vi.fn()
    const helper = new TestHelper(root, new AutocompleteHelperController(), onSelect)
    helper.show(['first', 'second'])

    // * клавиши летят из поля ввода — слушатель навигации стоит на документе в фазе захвата
    root.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }))
    root.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))

    expect(onSelect).toHaveBeenCalledTimes(1)
    expect((onSelect.mock.calls[0][0] as HTMLElement).textContent).toBe('second')
  })
})
