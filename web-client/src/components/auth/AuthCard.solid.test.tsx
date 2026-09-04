/** @jsxImportSource solid-js */
/**
 * Тесты порта `AuthCard.solid.tsx` (оболочка карточки auth-флоу, tweb
 * `AuthCard.tsx:50-60`): узел несёт `.card` + модификатор страницы, `header`
 * рендерится НАД `.input-wrapper`, обёртка снимается пропом `inputWrapper={false}`.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { render } from 'solid-js/web'
import AuthCard from './AuthCard.solid'
import styles from './AuthFlow.module.scss'

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

describe('AuthCard.solid', () => {
  it('несёт styles.card + класс страницы, header — над .input-wrapper', () => {
    const el = mount(() => (
      <AuthCard class={styles.pageSignIn} header={<h1>шапка</h1>}>
        <div class="payload">поле</div>
      </AuthCard>
    ))

    const card = el.firstElementChild as HTMLElement
    expect(card.classList.contains(styles.card)).toBe(true)
    expect(card.classList.contains(styles.pageSignIn)).toBe(true)

    // header — первый ребёнок, ДО .input-wrapper
    expect(card.children[0].tagName).toBe('H1')
    const wrapper = card.querySelector('.input-wrapper')!
    expect(wrapper).not.toBeNull()
    expect(wrapper.querySelector('.payload')).not.toBeNull()
  })

  it('по умолчанию оборачивает children в .input-wrapper', () => {
    const el = mount(() => (
      <AuthCard>
        <button>кнопка</button>
      </AuthCard>
    ))
    const card = el.firstElementChild as HTMLElement
    expect(card.querySelector('.input-wrapper button')).not.toBeNull()
  })

  it('inputWrapper={false} — children рендерятся БЕЗ обёртки', () => {
    const el = mount(() => (
      <AuthCard inputWrapper={false}>
        <div class="raw">без обёртки</div>
      </AuthCard>
    ))
    const card = el.firstElementChild as HTMLElement
    expect(card.querySelector('.input-wrapper')).toBeNull()
    expect(card.querySelector('.raw')).not.toBeNull()
  })
})
