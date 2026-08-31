/**
 * Строка «Язык» в корне настроек подписана ИМЕНЕМ ТЕКУЩЕГО ЯЗЫКА на нём самом.
 *
 * Так это устроено у оригинала (`sidebarLeft/tabs/settings.tsx:254` —
 * `titleRight={i18n('LanguageName')}`): имя языка это обычный ключ словаря, и
 * каждый переводит его в своё самоназвание. До задачи 8 подпись бралась из
 * местной таблицы шести языков (`i18n/index.tsx::LANGS`) — второго ответа на
 * тот же вопрос больше нет, и пин держит именно это: подпись обязана меняться
 * ВМЕСТЕ С ЯЗЫКОМ и приходить из словаря.
 *
 * Рендерится не весь экран настроек, а его строка: корень тянет за собой
 * слайдер вкладок, свою карточку, аватарку и попапы — предмета проверки там
 * нет, а шумного окружения много.
 */
import { describe, expect, it, afterEach } from 'vitest'
import { render, cleanup, act } from '@testing-library/react'

import type { ReactNode } from 'react'

import type { Managers } from '@/client/bootstrap'
import { ManagersProvider } from '@core/hooks/useManagers'
import { loadLang, useI18nStore } from '@/i18n'
import SettingsView from './SettingsView'

// Менеджеры — ШОВ (граница с воркером), всё остальное настоящее: рисуется САМ
// экран настроек, а не его пересказ. Пересказ здесь уже был и оказался
// тавтологией: собственный компонент повторял рендер строки и зеленел, даже
// когда в настоящем экране стояло жёсткое «English».
const managers = {
  peers: { fillMirror: async () => {} },
  media: { downloadMediaURL: async () => undefined },
  sessions: { getAll: async () => [] },
} as unknown as Managers

const wrapper = ({ children }: { children: ReactNode }) => (
  <ManagersProvider managers={managers}>{children}</ManagersProvider>
)

/**
 * Подпись строки «Язык» — значение справа.
 *
 * Ищется СТРУКТУРОЙ, а не текстом: текстом искать нечего, у строки на русском
 * меняется и титул («Язык»), и значение — а проверяется именно их пара. Строка
 * со значением в этой секции ровно одна (у остальных пунктов `value` нет), и это
 * утверждается тут же — иначе локатор молча начал бы читать чужую строку.
 */
function languageRowValue() {
  const withValue = Array.from(document.querySelectorAll('[class*="rowClickable"]'))
    // Иконка + титул + ЗНАЧЕНИЕ. Третий узел бывает и у «Ночного режима», но там
    // это `<label>` тумблера, а не подпись.
    .filter((row) => row.children.length === 3 && row.lastElementChild!.tagName === 'DIV')
  expect(withValue).toHaveLength(1)
  return withValue[0].lastElementChild!.textContent
}

describe('строка «Язык» в настройках', () => {
  afterEach(async () => {
    cleanup()
    await loadLang('en')
  })

  it('на английском подписана «English»', async() => {
    await loadLang('en')
    render(<SettingsView onBack={() => {}} onToggleMode={() => {}} />, { wrapper })

    expect(languageRowValue()).toBe('English')
  })

  it('после смены языка подписана его самоназванием', async() => {
    render(<SettingsView onBack={() => {}} onToggleMode={() => {}} />, { wrapper })
    expect(languageRowValue()).toBe('English')

    await act(async () => {
      useI18nStore.getState().setLang('ru')
      await loadLang('ru')
    })

    expect(languageRowValue()).toBe('Русский')
  })
})
