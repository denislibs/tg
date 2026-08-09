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
