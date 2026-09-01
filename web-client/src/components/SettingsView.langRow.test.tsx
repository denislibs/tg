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
import { useI18nStore } from '@/i18n'
import { applyLang } from '@/test/lang'
import SettingsView, { settingsItems } from './SettingsView'

// Менеджеры — ШОВ (граница с воркером), всё остальное настоящее: рисуется САМ
// экран настроек, а не его пересказ. Пересказ здесь уже был и оказался
// тавтологией: собственный компонент повторял рендер строки и зеленел, даже
// когда в настоящем экране стояло жёсткое «English».
const managers = {
  peers: { fillMirror: async () => {} },
  media: { downloadMediaURL: async () => undefined },
  sessions: { list: async () => [] },
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
  // Адресуется ПОЗИЦИЕЙ в списке, а не формой узла. Прежний локатор брал
  // единственную строку из трёх детей с `<div>` последним — и это перестало
  // быть приметой языка, как только строка «Devices» получила счётчик сессий
  // (задача #112, пункт 5): у неё стало столько же детей той же формы.
  // Собственная проверка локатора («ровно одна такая строка») это и поймала —
  // молча читать чужую строку он не начал.
  //
  // Позиция берётся из ЭКСПОРТИРОВАННОЙ таблицы, а не из константы в тесте:
  // перестановка пунктов в продукте не должна требовать правки пина. Первой
  // строкой секции идёт «Ночной режим», отсюда сдвиг на единицу.
  const index = settingsItems.findIndex((it) => it.value)
  expect(settingsItems.filter((it) => it.value)).toHaveLength(1)

  const rows = Array.from(document.querySelectorAll('[class*="rowClickable"]'))
  const row = rows[index + 1]
  return row.lastElementChild!.textContent
}

describe('строка «Язык» в настройках', () => {
  afterEach(async () => {
    cleanup()
    await applyLang('en')
  })

  it('на английском подписана «English»', async() => {
    await applyLang('en')
    render(<SettingsView onBack={() => {}} onToggleMode={() => {}} />, { wrapper })

    expect(languageRowValue()).toBe('English')
  })

  it('после смены языка подписана его самоназванием', async() => {
    render(<SettingsView onBack={() => {}} onToggleMode={() => {}} />, { wrapper })
    expect(languageRowValue()).toBe('English')

    await act(async () => {
      useI18nStore.getState().setLang('ru')
      await applyLang('ru')
    })

    expect(languageRowValue()).toBe('Русский')
  })
})
