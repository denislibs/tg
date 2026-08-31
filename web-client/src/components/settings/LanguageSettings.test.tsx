// Экран выбора языка: список СЕРВЕРНЫЙ (задача 8).
//
// Дыра, ради которой пин заведён: экран нёс таблицу из 33 языков, у 27 из
// которых кода не было вовсе — клик по «Italiano» зажигал кружок и не делал
// НИЧЕГО. Ни тайпчек, ни сборка мёртвую строку не видят: она отличается от
// живой одним отсутствующим полем.
//
// Фикстура повторяет выдачу сервера, включая ПОРЯДОК (`position`, миграция
// 0129): предложенные первыми, дальше по алфавиту английского имени. Порядок
// здесь не алфавитный ни по коду, ни по самоназванию — сортировка на клиенте,
// заведённая по недосмотру, на такой фикстуре краснеет.
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react'

import type { LangPackLanguage } from '@layer'
import I18n from '@lib/langPack'
import { ManagersProvider } from '@core/hooks/useManagers'
import type { Managers } from '@/client/bootstrap'

import { loadLang, useI18nStore } from '@/i18n'
import LanguageSettings from './LanguageSettings'

const lang = (code: string, name: string, native: string) => ({
  _: 'langPackLanguage',
  pFlags: { official: true },
  name,
  native_name: native,
  lang_code: code,
  plural_code: code,
  strings_count: 1288,
  translated_count: 640,
  translations_url: '',
}) as LangPackLanguage

// Порядок сервера: en, ru, fr, de, es, uk (`langsource.languageOrder`).
const SERVER_LANGS = [
  lang('en', 'English', 'English'),
  lang('ru', 'Russian', 'Русский'),
  lang('fr', 'French', 'Français'),
  lang('de', 'German', 'Deutsch'),
  lang('es', 'Spanish', 'Español'),
  lang('uk', 'Ukrainian', 'Українська'),
]

function renderScreen(getLanguages: () => Promise<LangPackLanguage[]>) {
  const managers = { langPack: { getLanguages } } as unknown as Managers
  return render(
    <ManagersProvider managers={managers}>
      <LanguageSettings onBack={() => {}} />
    </ManagersProvider>,
  )
}

describe('экран выбора языка', () => {
  afterEach(() => {
    cleanup()
    useI18nStore.getState().setLang('en')
  })

  it('рисует языки сервера в порядке сервера', async() => {
    renderScreen(async () => SERVER_LANGS)

    await waitFor(() => expect(screen.getByText('Russian')).toBeTruthy())
    // Порядок строк — тот, что отдал сервер, а не алфавит: русский ВТОРОЙ.
    const rows = Array.from(document.querySelectorAll('[data-lang-code]'))
    expect(rows.map((el) => el.getAttribute('data-lang-code'))).toEqual(['en', 'ru', 'fr', 'de', 'es', 'uk'])
    // Английское имя титулом, самоназвание подписью — оба с сервера.
    expect(rows[5].textContent).toContain('Ukrainian')
    expect(rows[5].textContent).toContain('Українська')
  })

  it('языков, которых у сервера нет, на экране нет вовсе', async() => {
    renderScreen(async () => SERVER_LANGS)

    await waitFor(() => expect(screen.getByText('Russian')).toBeTruthy())
    // «Italiano» была мёртвой строкой прежнего местного списка.
    expect(screen.queryByText('Italiano')).toBeNull()
    expect(screen.queryByText('Vietnamese')).toBeNull()
  })

  it('клик по строке меняет язык у ВЛАДЕЛЬЦА, а не только кружок', async() => {
    renderScreen(async () => SERVER_LANGS)
    await waitFor(() => expect(screen.getByText('Russian')).toBeTruthy())

    fireEvent.click(screen.getByText('Russian'))

    expect(I18n.getLastRequestedLangCode()).toBe('ru')
    expect(useI18nStore.getState().lang).toBe('ru')
    // Чанк словаря `setLang` запускает через `void` — дожидаемся, иначе он
    // догрузится уже после сноса тестового окружения.
    await loadLang('ru')
  })

  it('кружок горит у выбранного языка, а не у первой строки', async() => {
    useI18nStore.getState().setLang('uk')
    await loadLang('uk')
    renderScreen(async () => SERVER_LANGS)
    await waitFor(() => expect(screen.getByText('Ukrainian')).toBeTruthy())

    // Кружок — единственный узел с `data-on`; ищем строку, в которой он лежит.
    expect(document.querySelectorAll('[data-on]')).toHaveLength(1)
    const on = document.querySelector('[data-on]')!
    expect(on.closest('[data-lang-code]')!.getAttribute('data-lang-code')).toBe('uk')
  })

  it('отказ сети не роняет экран — секция языков пустая', async() => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    renderScreen(async () => { throw new Error('offline') })

    await waitFor(() => expect(screen.getByText('Show Translate Button')).toBeTruthy())
    expect(screen.queryByText('English')).toBeNull()
    spy.mockRestore()
  })
})
