/** @jsxImportSource solid-js */
import { describe, expect, it } from 'vitest'
import { createSignal } from 'solid-js'
import { render } from 'solid-js/web'

// Тест не про наш код, а про СБОРКУ: он краснеет, если `vite-plugin-solid` не
// подключён к vitest или его маска не покрывает `*.solid.test.tsx` — тогда JSX
// уедет в React-рантайм и `render` получит объект React-элемента вместо узла.
describe('сборка: Solid-JSX в файлах *.solid.tsx', () => {
  it('компилируется Solid-рантаймом и даёт настоящий DOM', () => {
    const host = document.createElement('div')
    const dispose = render(() => <span class="probe">привет</span>, host)

    expect(host.querySelector('.probe')?.textContent).toBe('привет')
    dispose()
  })

  it('реактивность живая: сигнал меняет уже вставленный узел', () => {
    const host = document.createElement('div')
    const [n, setN] = createSignal(1)
    const dispose = render(() => <b>{n()}</b>, host)

    expect(host.querySelector('b')?.textContent).toBe('1')
    setN(2)
    expect(host.querySelector('b')?.textContent).toBe('2')
    dispose()
  })
})
