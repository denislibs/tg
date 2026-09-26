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
import { applyLang } from '@/test/lang'
import SettingsView, { settingsItems } from './SettingsView'
import { getRowIconBackground, ROW_ICON_COLORS } from '@helpers/rowIconBackground'

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

  const rows = Array.from(document.querySelectorAll('.profile-buttons > .row'))
  const row = rows[index + 1]
  return row.querySelector('.row-title-right-secondary')!.textContent
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
      await applyLang('ru')
    })

    expect(languageRowValue()).toBe('Русский')
  })
})

// Иконки корня настроек — tweb 2197fee9c (`sidebarLeft/tabs/settings.tsx`):
// залитые глифы на цветных плашках, цвет — из реестра `rowIconBackground`.
describe('иконки корня настроек — цветные плашки tweb', () => {
  afterEach(() => cleanup())

  it('пункты несут те же иконки, что у tweb', () => {
    expect(Object.fromEntries(settingsItems.map((it) => [it.label, it.icon]))).toEqual({
      'AccountSettings.Notifications': 'bell_filled',
      DataSettings: 'data_filled',
      PrivacySettings: 'key_filled',
      'Telegram.GeneralSettingsViewController': 'general_filled',
      'ChatList.Filter.List.Title': 'limit_folders_filled',
      StickersName: 'reactions_filled',
      'AccountSettings.SpeakersAndCamera': 'speaker_filled',
      Devices: 'devices_filled',
      'AccountSettings.Language': 'web_filled',
      'KeyboardShortcuts.Title': 'keyboard_filled',
    })
  })

  it('строки списка — .row с плашкой нужного цвета (Notifications красная, Data зелёная, Privacy серая)', async() => {
    await applyLang('en')
    render(<SettingsView onBack={() => {}} onToggleMode={() => {}} />, { wrapper })
    const plates = Array.from(document.querySelectorAll<HTMLElement>('.profile-buttons > .row > .row-icon.row-icon-colored'))
    // «Ночной режим» + пункты таблицы.
    expect(plates).toHaveLength(settingsItems.length + 1)
    const bg = (i: number) => plates[i + 1].style.backgroundImage
    expect(bg(0)).toBe(getRowIconBackground(ROW_ICON_COLORS.red))
    expect(bg(1)).toBe(getRowIconBackground(ROW_ICON_COLORS.green))
    expect(bg(2)).toBe(getRowIconBackground(ROW_ICON_COLORS.grey))
    expect(bg(4)).toBe(getRowIconBackground(ROW_ICON_COLORS.blue))
  })
})
