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
import { afterEach, beforeAll, describe, expect, it } from 'vitest'

import { useI18nStore } from '@/i18n'
import { applyLang } from '@/test/lang'
import Button from './button'
import { ButtonMenuItem } from './buttonMenu'
import CheckboxField from './checkboxField'
import RadioField from './radioField'
import PopupElement from './popups/popupElement'
import PopupPeer from './popups/popupPeer'
import Row from './row'
import SettingSection from './settingSection'
import { toastNew, hideToast } from './toast'

beforeAll(async () => {
  useI18nStore.setState({ lang: 'ru' })
  await applyLang('ru')
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

  // Две стороны, ради которых задача 7 и делалась: ДО неё обе ждали ГОТОВУЮ строку,
  // и на этом пользователь дважды увидел латинское имя ключа.
  it('пункт контекстного меню', () => {
    const [item] = ButtonMenuItem({ icon: 'stop', text: 'Terminate', onClick: () => {} })
    expect(item.querySelector('.btn-menu-item-text')!.textContent).toBe('Завершить')
  })

  it('кнопка попапа (и авто-кнопка отмены)', () => {
    const popup = PopupElement.createPopup(PopupPeer, 'popup-i18n-contract', {
      titleLangKey: 'AreYouSureSessionTitle',
      descriptionLangKey: 'TerminateSessionText',
      buttons: [{ langKey: 'Terminate', isDanger: true }],
    })
    popup.show()

    const root = document.querySelector('.popup-i18n-contract')!
    expect(root.querySelector('.popup-title')!.textContent).toBe('Завершить сеанс')
    expect(root.querySelector('.popup-description')!.textContent).toBe('Вы действительно хотите завершить этот сеанс?')

    const buttons = Array.from(root.querySelectorAll('.popup-button')).map((b) => b.textContent)
    expect(buttons).toEqual(['Завершить', 'Отмена'])

    popup.forceHide()
  })

  it('подпись чекбокса и радио-строки', () => {
    // `DeleteMessagesOptionAlso` = «Также удалить у %1$s»: имя подставляет СТРОКА,
    // а не вызывающий — раньше он склеивал префикс «Также удалить у» с именем сам.
    const checkbox = new CheckboxField({ text: 'DeleteMessagesOptionAlso', textArgs: ['Майя'] })
    expect(checkbox.label.querySelector('.checkbox-caption')!.textContent).toBe('Также удалить у Майя')

    const radio = new RadioField({ langKey: 'Checkbox.Enabled', name: 'x' })
    expect(radio.main.textContent).toBe('Включено')
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

// Узел `i18n()` ЖИВОЙ: он записан в `weakMap` ядра, и применение языка
// перерисовывает его на месте, без перемонтирования (tweb :307-317). Прежний
// `i18nSpan` этого не умел — он нёс текст, снятый один раз в момент постройки, и
// смена языка оставляла на экране старую подпись до перерисовки владельцем.
//
// Перерисовка достаётся ТОЛЬКО узлам, вставленным в документ: `applyLangPack`
// обходит `document.querySelectorAll('.i18n')`. Это поведение оригинала, и здесь
// оно проверяется явно — чтобы «не обновилось» не списывали на него молча.
describe('уже построенная подпись переживает смену языка', () => {
  afterEach(async () => {
    document.body.replaceChildren()
    useI18nStore.setState({ lang: 'ru' })
    await applyLang('ru')
  })

  it('узел в документе перерисовывается применением языка', async () => {
    const button = Button('btn', { text: 'Cancel' })
    document.body.append(button)
    expect(button.textContent).toBe('Отмена')

    useI18nStore.setState({ lang: 'en' })
    await applyLang('en')
    expect(button.textContent).toBe('Cancel')
  })
})
