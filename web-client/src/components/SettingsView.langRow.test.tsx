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
import { render, screen, cleanup } from '@testing-library/react'

import { loadLang, useI18nStore, useT } from '@/i18n'
import { settingsItems } from './SettingsView'

function LanguageRow() {
  const t = useT()
  const item = settingsItems.find((i) => i.label === 'Telegram.LanguageViewController')!
  return <div>{item.value ? t(item.value) : null}</div>
}

describe('строка «Язык» в настройках', () => {
  afterEach(async () => {
    cleanup()
    await loadLang('en')
  })

  it('на английском подписана «English»', async() => {
    await loadLang('en')
    render(<LanguageRow />)

    expect(screen.getByText('English')).toBeTruthy()
  })

  it('после смены языка подписана его самоназванием', async() => {
    render(<LanguageRow />)

    useI18nStore.getState().setLang('ru')
    await loadLang('ru')

    expect(screen.getByText('Русский')).toBeTruthy()
    expect(screen.queryByText('English')).toBeNull()
  })
})
