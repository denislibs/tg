// ── КЛАСС `i18n` УШЁЛ ИЗ REACT-РАЗМЕТКИ (задача #122) ────────────────────────
//
// В tweb `.i18n` ставит ЯДРО на узлы, созданные `i18n()`, и служит якорем обхода
// `applyLangPack`. CSS у класса нет ни там, ни у нас. В нашей JSX-разметке он
// писался руками — узел в `weakMap` не записан, обход его молча пропускает, а
// текст обновляет перерисовка React по `language_apply`. То есть класс не делал
// ничего и при этом читался как «узел живой». Разбор и скан — в
// `src/i18n/noFakeI18nAnchor.test.ts`.
//
// Поэтому пины разметки ниже класс больше не проверяют: сверяется всё
// остальное, а живость подписи там, где она настоящая, держат свои пины
// (`I18n.weakMap.get(node)`).
// Страна по умолчанию на экране входа — порт tweb `SignInCard.tryAgain`:
// `help.getNearestDc` подставляет страну, но только пока поля не трогали.
// У нас её отдаёт `GET /auth/nearest_country` (менеджер `auth.nearestCountry`).
import { describe, it, expect, afterEach } from 'vitest'
import { render, waitFor, cleanup, fireEvent } from '@testing-library/react'
import AuthFlow from './AuthFlow'
import { ManagersProvider } from '../../core/hooks/useManagers'
import type { Managers } from '../../client/bootstrap'

function renderFlow(nearestCountry: () => Promise<string>) {
  const managers = { auth: { nearestCountry } } as unknown as Managers
  render(
    <ManagersProvider managers={managers}>
      <AuthFlow onComplete={() => {}} onToggleMode={() => {}} />
    </ManagersProvider>,
  )
  // Поле номера — единственный contenteditable карточки signIn после селектора страны.
  const tel = () => [...document.querySelectorAll('#auth-pages [contenteditable]')].pop()!
  return { tel }
}

describe('AuthFlow: страна по умолчанию', () => {
  afterEach(cleanup)

  it('пустой ответ ручки — остаётся фолбэк (+7)', async () => {
    const { tel } = renderFlow(() => Promise.resolve(''))
    await waitFor(() => expect(tel().textContent).toBe('+7'))
    // дать эффекту отработать и убедиться, что поле не «мигнуло»
    await new Promise((r) => setTimeout(r, 0))
    expect(tel().textContent).toBe('+7')
  })

  it('код страны с сервера подставляется в номер', async () => {
    const { tel } = renderFlow(() => Promise.resolve('DE'))
    await waitFor(() => expect(tel().textContent).toBe('+49'))
  })

  it('поле, которое уже трогали, ответом не перебивается (tweb: только пока поля пусты)', async () => {
    let resolve!: (v: string) => void
    const { tel } = renderFlow(() => new Promise<string>((r) => (resolve = r)))
    const el = tel()
    el.textContent = '+380 50'
    fireEvent.input(el)
    resolve('DE')
    await new Promise((r) => setTimeout(r, 0))
    expect(tel().textContent).not.toBe('+49')
  })
})

// ЗАДАЧА 7. `Login.StartText` — ОДИН ключ с переводом строки внутри (tweb
// langSign.ts:5), и `<br>` из `\n` делает разбор разметки словаря, а не вызывающий:
// раньше здесь стоял `t(...).split('\n')` в самой карточке.
describe('подзаголовок экрана входа: перенос строки внутри одного ключа', () => {
  afterEach(cleanup)

  it('строка словаря разворачивается в две половины через <br>', async () => {
    renderFlow(() => Promise.resolve(''))
    const subtitle = await waitFor(() => {
      const el = [...document.querySelectorAll('#auth-pages span')]
        .find((node) => node.textContent?.includes('country code'))
      expect(el).not.toBeUndefined()
      return el!
    })

    expect(subtitle.textContent).toBe('Please confirm your country codeand enter your phone number.')
    expect(subtitle.querySelectorAll('br')).toHaveLength(1)
  })
})
