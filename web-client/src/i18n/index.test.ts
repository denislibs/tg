// Хранилище языка проверяется ПОВЕДЕНИЕМ `t()`: что увидит вызывающий на
// символическом ключе, на старой английской строке и на форме числа. Строки берутся
// настоящие — английский источник `src/lang.ts` и настоящий `dict.ru.ts`, а не фикстура:
// разъехавшуюся проводку (`toStrings`, нижний слой английского, выбор формы) видно
// только на них.
import { beforeEach, describe, expect, it } from 'vitest'

import { loadLang, substituteArgs, useI18nStore } from './index'

const t = (key: string) => useI18nStore.getState().t(key)
const tArgs = (key: string, args: (string | number)[]) =>
  (useI18nStore.getState().tArgs as (k: string, a: (string | number)[]) => string)(key, args)

beforeEach(async () => {
  useI18nStore.setState({ lang: 'en' })
  await loadLang('en')
})

describe('символический ключ', () => {
  it('на английском отдаёт текст источника, а не имя ключа', () => {
    // Текст ключа и его имя различаются — иначе проверка зеленела бы на «вернули ключ».
    expect(t('ArchivedChats')).toBe('Archived Chats')
    expect(t('Story.AddToProfile')).toBe('Post to Profile')
  })

  it('после загрузки языка отдаёт перевод', async () => {
    useI18nStore.setState({ lang: 'ru' })
    await loadLang('ru')
    expect(t('ArchivedChats')).toBe('Архив')
  })

  it('непереведённый ключ падает на английский, а не на имя ключа', async () => {
    useI18nStore.setState({ lang: 'ru' })
    await loadLang('ru')
    // `AutoDownloadPm` в русском словаре есть, `Call.CameraOff` — нет.
    expect(t('AutoDownloadPm')).toBe('Личные чаты')
    expect(t('Call.CameraOff')).toBe('Turn off camera')
  })

  it('незнакомого ключа не выдумывает', () => {
    expect(t('Nope.NoSuchKey')).toBe('Nope.NoSuchKey')
  })
})

// Кодмод задачи 6 идёт по подсистемам, и между её коммитами часть интерфейса ещё зовёт
// `t('Archived Chats')`. Сломать её нельзя — обе формы обязаны переводить одинаково.
describe('старая форма ключа (до задачи 9)', () => {
  it('переводится наравне с символической', async () => {
    useI18nStore.setState({ lang: 'ru' })
    await loadLang('ru')
    expect(t('Archived Chats')).toBe('Архив')
    expect(t('ArchivedChats')).toBe('Архив')
  })

  it('английское исключение остаётся исключением', () => {
    // 'Story.AddToProfile' — старый ключ, чей текст с ним не совпадает.
    expect(t('Story.AddToProfile')).toBe('Post to Profile')
  })
})

describe('форма числа выбирается языком', () => {
  it('русский склоняет 1/2/5', async () => {
    useI18nStore.setState({ lang: 'ru' })
    await loadLang('ru')
    expect(tArgs('Notifications.Count', [1])).toBe('1 уведомление')
    expect(tArgs('Notifications.Count', [2])).toBe('2 уведомления')
    expect(tArgs('Notifications.Count', [5])).toBe('5 уведомлений')
  })

  it('английский различает один и остальные', () => {
    expect(tArgs('Notifications.Count', [1])).toBe('1 notification')
    expect(tArgs('Notifications.Count', [7])).toBe('7 notifications')
  })
})

describe('подстановка аргументов', () => {
  it('нумерованные аргументы идут по своим номерам', () => {
    // Оба аргумента разные, и порядок в строке проверяемый: перепутанные местами
    // дают «Up to Photos for 100 MB».
    expect(tArgs('AutoDownloadOnUpToFor', ['100 MB', 'Photos'])).toBe('Up to 100 MB for Photos')
  })

  it('русский переставляет их вместе со строкой', async () => {
    useI18nStore.setState({ lang: 'ru' })
    await loadLang('ru')
    expect(tArgs('AutoDownloadOnUpToFor', ['100 МБ', 'Фото'])).toBe('До 100 МБ для: Фото')
  })

  it('безномерные подставляются по порядку', () => {
    expect(tArgs('Stories.StealthMode.Cooldown', ['5:00'])).toBe('Available in 5:00')
  })

  // На наших строках ошибка «номер аргумента прочитан как порядок» НЕ ВЫРАЗИМА: в
  // словаре нет ни одной строки, где `%2$s` стоит раньше `%1$s`, и оба поведения дают
  // одинаковый результат. Поэтому номера проверяются на строке, где порядок обратный, —
  // такие у оригинала есть (tweb `Chat.Forwarded` = 'From %2$s to %1$s'), и наш словарь
  // до них дорастёт.
  it('номер аргумента сильнее его порядка', () => {
    expect(substituteArgs('From %2$s to %1$s', ['Saved Messages', 'Alice'])).toBe('From Alice to Saved Messages')
  })

  it('лишний плейсхолдер остаётся текстом, а не «undefined»', () => {
    expect(substituteArgs('Up to %1$s for %2$s', ['100 MB'])).toBe('Up to 100 MB for %2$s')
  })
})
