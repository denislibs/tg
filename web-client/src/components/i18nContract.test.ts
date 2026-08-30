// ── КОНТРАКТ ПОДПИСИ: ключ на входе, ПЕРЕВОД на экране ────────────────────────────
//
// Задача 7 сняла раскол: до неё часть ванильных компонентов брала ключ и переводила
// сама (`Button`, `Row`, `SettingSection`, `toastNew`), а часть ждала уже переведённую
// строку (`ButtonMenuItem.text`, `PopupButton.text`) — и по сигнатуре `text?: string`
// одно от другого не отличалось. Волна 2 на этом показала пользователю сырой ключ
// «Terminate» в контекстном меню, задача 6 — сырую надпись на кнопке подтверждения во
// всех попапах сразу.
//
// Проверка идёт по ВЫДАЧЕ и на РУССКОМ языке. Английский тут бесполезен: у нашего
// источника текст ключа часто совпадает с его именем, и «перевели» неотличимо от
// «напечатали ключ». На русском они различаются всегда.
//
// Мутация, ради которой файл и написан: «передать ключ мимо `i18n`» (положить
// `key` текстом в узел вместо `i18n(key)`) — краснеет каждый блок ниже.
import { beforeAll, describe, expect, it } from 'vitest'

import { loadLang, useI18nStore } from '@/i18n'
import Button from './button'
import Row from './row'
import SettingSection from './settingSection'
import { toastNew, hideToast } from './toast'

beforeAll(async () => {
  useI18nStore.setState({ lang: 'ru' })
  await loadLang('ru')
})

describe('ванильные подписи показывают перевод, а не ключ', () => {
  it('кнопка', () => {
    expect(Button('btn', { text: 'Cancel' }).textContent).toBe('Отмена')
  })

  it('строка настроек — заголовок и подзаголовок', () => {
    const row = new Row({ titleLangKey: 'CurrentSession', subtitleLangKey: 'ClearOtherSessionsHelp' })
    expect(row.title.textContent).toBe('Это устройство')
    expect(row.subtitle.textContent).toBe('Завершает сеансы на всех устройствах, кроме этого.')
  })

  it('заголовок секции настроек и её подпись', () => {
    const section = new SettingSection({ name: 'SessionsTitle', caption: 'ClearOtherSessionsHelp' })
    expect(section.title!.textContent).toBe('Активные сеансы')
    expect(section.caption!.textContent).toBe('Завершает сеансы на всех устройствах, кроме этого.')
  })

  it('всплывашка', () => {
    toastNew({ langPackKey: 'Error.AnError' })
    expect(document.querySelector('.toast')!.textContent).toBe('Произошла ошибка. Пожалуйста, попробуйте позже.')
    hideToast()
  })
})

// Аргументы подстановки — вторая половина контракта: до задачи 7 `*LangArgs` не были
// портированы ни в одном из этих компонентов (строковый `t()` их не умел), и число в
// подпись приходилось подставлять вызывающему, отдавая внутрь ГОТОВУЮ строку — тот же
// раскол, только с другой стороны.
describe('аргументы подставляются внутри компонента, а не вызывающим', () => {
  it('форму числа выбирает язык, а не вызывающий', () => {
    const section = new SettingSection({ name: 'Notifications.Count', nameArgs: [5] })
    expect(section.title!.textContent).toBe('5 уведомлений')

    const row = new Row({ titleLangKey: 'Notifications.Count', titleLangArgs: [2] })
    expect(row.title.textContent).toBe('2 уведомления')
  })

  it('узел-аргумент остаётся узлом, а не «[object HTMLElement]»', () => {
    const b = document.createElement('b')
    b.textContent = 'Алиса'
    // `Stories.StealthMode.Cooldown` = «Available in %@» — одна подстановка.
    const button = Button('btn', { text: 'Stories.StealthMode.Cooldown', textArgs: [b] })
    expect(button.querySelector('b')).toBe(b)
    expect(button.textContent).toContain('Алиса')
  })
})
