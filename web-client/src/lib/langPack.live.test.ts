// ЖИВАЯ СМЕНА ЯЗЫКА (задача 8): уже открытые экраны переводятся НА МЕСТЕ, без
// перемонтирования.
//
// Механика вся в `applyLangPack` (порт tweb :316-322): узел, построенный
// `i18n()`/`_i18n()`, записан в `weakMap`, и применение языка обходит
// `document.querySelectorAll('.i18n')` и зовёт каждому `update()`. Отсюда же
// ОГРАНИЧЕНИЕ ОРИГИНАЛА, которое здесь и закреплено: перерисовываются только
// узлы, ВСТАВЛЕННЫЕ В ДОКУМЕНТ. Узел, лежащий в памяти (меню, ещё не
// смонтированное в body; вкладка, снятая со страницы), смену языка пропускает и
// останется на прежнем до своей следующей постройки.
//
// Путь смены — ПРОДУКТОВЫЙ (`useI18nStore.setLang`), а не прямой вызов ядра:
// проверяется то, что делает пользователь на экране выбора языка.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import Row from '@components/row'
import SettingSection from '@components/settingSection'
import PopupMute from '@components/popups/popupMute'
import type { AvatarManagers } from '@components/avatar'
import { i18n } from '@lib/langPack'
import { loadLang, useI18nStore } from '@/i18n'

/** Смена языка так, как её делает экран выбора языка. */
async function switchTo(lang: string) {
  useI18nStore.getState().setLang(lang)
  await loadLang(lang)
}

beforeEach(async () => {
  document.body.replaceChildren()
  await switchTo('en')
})

afterEach(async () => {
  document.body.replaceChildren()
  await switchTo('en')
})

describe('открытая вкладка переводится на лету', () => {
  it('заголовок секции и подпись строки меняют язык без перестроения', async() => {
    const section = new SettingSection({ name: 'SessionsTitle' })
    const row = new Row({ titleLangKey: 'Terminate', subtitleLangKey: 'OtherSessions' })
    section.content.append(row.container)
    document.body.append(section.container)

    const title = section.container.querySelector('.sidebar-left-section-name')!
    expect(title.textContent).toBe('Active Sessions')
    expect(row.title.textContent).toBe('Terminate')

    await switchTo('ru')

    // ТЕ ЖЕ узлы, не пересозданные — их и держит вкладка.
    expect(title.textContent).toBe('Активные сеансы')
    expect(row.title.textContent).toBe('Завершить')
    expect(row.container.isConnected).toBe(true)
  })

  it('вернуться на прежний язык — тот же узел возвращается к прежнему тексту', async() => {
    const row = new Row({ titleLangKey: 'Terminate' })
    document.body.append(row.container)

    await switchTo('ru')
    expect(row.title.textContent).toBe('Завершить')

    await switchTo('en')
    expect(row.title.textContent).toBe('Terminate')
  })
})

describe('открытый попап переводится на лету', () => {
  const managers = () => ({ peers: { fillMirror: vi.fn(async() => {}) } }) as unknown as AvatarManagers

  it('строки списка и кнопки меняют язык, пока попап открыт', async() => {
    new PopupMute(1, managers(), vi.fn())

    const root = document.querySelector('.popup-mute')!
    const rows = root.querySelectorAll('[role="radio"]')
    expect(rows[0].textContent).toContain('For 1 Hour')
    const button = root.querySelector('.popup-button')!
    expect(button.textContent).toBe('Mute')

    await switchTo('ru')

    expect(rows[0].textContent).toContain('На 1 час')
    expect(button.textContent).toBe('Без звука')
  })
})

describe('ограничение оригинала: обходятся только узлы в документе', () => {
  it('узел, не вставленный в документ, смену языка пропускает', async() => {
    const detached = i18n('Terminate')
    expect(detached.textContent).toBe('Terminate')

    await switchTo('ru')

    // Порт tweb :316-317 (`document.querySelectorAll('.i18n')`): до узла в
    // памяти обход не доходит. Так же ведёт себя оригинал — это не дефект, а
    // граница механики: вставленный ПОСЛЕ смены узел строится уже на новом
    // языке (проверка ниже), а вставленный ДО — перерисовывается.
    expect(detached.textContent).toBe('Terminate')

    document.body.append(detached)
    expect(detached.textContent).toBe('Terminate')

    // Построенный после смены — сразу по-русски.
    expect(i18n('Terminate').textContent).toBe('Завершить')
  })
})
