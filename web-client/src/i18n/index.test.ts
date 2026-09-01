// `t()` React-стора проверяется ПОВЕДЕНИЕМ: что увидит вызывающий на символическом
// ключе, на форме числа и на подстановке. Строки берутся настоящие — английский
// источник `src/lang.ts` и настоящий `dict.ru.ts`, а не фикстура: разъехавшуюся
// проводку (слияние с английским низом, выбор формы) видно только на них.
//
// ── Что задача 9 отсюда УБРАЛА ────────────────────────────────────────────────
// Блок «старая форма ключа» (`t('Archived Chats')`) — вместе с самой формой: моста
// `legacyDict` больше нет, и такой ключ теперь неотличим от незнакомого. И блок
// `substituteArgs` — вместе с самой функцией: своей подстановки у стора не осталось,
// `t()` зовёт `I18n.format`, а его номера аргументов пинит `lib/langPack.test.ts`.
import { beforeEach, describe, expect, it } from 'vitest'

import I18n, { i18n } from '@lib/langPack'
import { applyLang } from '@/test/lang'

import { useI18nStore } from './index'

const t = (key: string) => (useI18nStore.getState().t as (k: string) => string)(key)
const tArgs = (key: string, args: (string | number)[]) =>
  (useI18nStore.getState().tArgs as (k: string, a: (string | number)[]) => string)(key, args)

beforeEach(async () => {
  await applyLang('en')
})

describe('символический ключ', () => {
  it('на английском отдаёт текст источника, а не имя ключа', () => {
    // Текст ключа и его имя различаются — иначе проверка зеленела бы на «вернули ключ».
    expect(t('ArchivedChats')).toBe('Archived Chats')
    expect(t('Story.AddToProfile')).toBe('Post to Profile')
  })

  it('после загрузки языка отдаёт перевод', async () => {
    await applyLang('ru')
    expect(t('ArchivedChats')).toBe('Архив')
  })

  it('непереведённый ключ падает на английский, а не на имя ключа', async () => {
    await applyLang('ru')
    // `AutoDownloadPm` в русском словаре есть, `Chat.CopySelectedText` — нет.
    expect(t('AutoDownloadPm')).toBe('Личные чаты')
    expect(t('Chat.CopySelectedText')).toBe('Copy Selected Text')
  })

  it('незнакомого ключа не выдумывает', () => {
    expect(t('Nope.NoSuchKey')).toBe('Nope.NoSuchKey')
  })

  // Старая форма ключа («ключ = английская строка») снята задачей 9 ЦЕЛИКОМ, и это
  // проверяемое утверждение, а не запись в отчёте: строка, которая раньше
  // переводилась мостом, теперь возвращается сама собой — как любой незнакомый ключ.
  it('старая форма ключа больше не переводится — её нет ни в данных, ни в коде', async () => {
    await applyLang('ru')
    expect(t('Archived Chats')).toBe('Archived Chats')
    expect(t('ArchivedChats')).toBe('Архив')
  })
})

describe('форма числа выбирается языком', () => {
  it('русский склоняет 1/2/5', async () => {
    await applyLang('ru')
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
    await applyLang('ru')
    expect(tArgs('AutoDownloadOnUpToFor', ['100 МБ', 'Фото'])).toBe('До 100 МБ для: Фото')
  })

  it('безномерные подставляются по порядку', () => {
    expect(tArgs('Stories.StealthMode.Cooldown', ['5:00'])).toBe('Available in 5:00')
  })
})

// ── ЯДРО И `t()` — ОДИН ИСТОЧНИК (задача 9) ──────────────────────────────────────
//
// До задачи 9 источников было два: `I18n.strings` и своя плоская карта стора, а
// совпадение их ответов держалось проводкой (`applyToCore`) и вот этой проверкой.
// Теперь `t()` — обёртка над `I18n.format`, то есть расхождение стало НЕВЫРАЗИМЫМ;
// проверка осталась, потому что осталось утверждение, ради которого она писалась:
// пользователь читает одно и то же, из какого бы слоя ни пришла подпись.
describe('ядро и t() отвечают из одной карты', () => {
  it('английский: узел ядра несёт текст источника, а не имя ключа', () => {
    expect(i18n('ArchivedChats').textContent).toBe('Archived Chats')
    expect(i18n('Story.AddToProfile').textContent).toBe('Post to Profile')
  })

  it('после смены языка узел ядра говорит по-русски', async () => {
    await applyLang('ru')
    expect(i18n('ArchivedChats').textContent).toBe('Архив')
    // Непереведённый ключ падает на английский нижний слой — то же правило, что у `t()`.
    expect(i18n('Chat.CopySelectedText').textContent).toBe('Copy Selected Text')
  })

  it('форма числа у ядра выбирается тем же языком', async () => {
    await applyLang('ru')
    expect(i18n('Notifications.Count', [2]).textContent).toBe('2 уведомления')
    expect(i18n('Notifications.Count', [5]).textContent).toBe('5 уведомлений')
  })

  it('ядро и t() отвечают ОДНО И ТО ЖЕ на одном и том же ключе', async () => {
    await applyLang('ru')
    // Ключи взяты разной судьбы: переведённый, непереведённый и свой-английский.
    for (const key of ['ArchivedChats', 'Chat.CopySelectedText', 'Story.AddToProfile']) {
      expect(i18n(key as never).textContent).toBe(t(key))
    }
  })

  // Разметка словаря разбирается ОДИНАКОВО обоими. Раньше `t()` имел свою урезанную
  // подстановку без разметки и отдавал звёздочки текстом — то есть на строке с
  // `**жирным**` два слоя интерфейса показывали разное.
  it('микроразметка словаря не доезжает до пользователя звёздочками', async () => {
    await applyLang('ru')
    const rendered = tArgs('Search.Empty', ['кабачок'])
    expect(rendered).not.toContain('**')
    expect(rendered).toBe(i18n('Search.Empty', ['кабачок']).textContent)
  })
})

// Язык, от которого пользователь уже ушёл, не должен доехать ни до `t()`, ни до ядра.
describe('опоздавший пакет чужого языка', () => {
  it('не применяется — сверку делает само применение', async () => {
    await applyLang('ru')
    // Пакет собран для немецкого, а текущий язык — русский: `applyLangPack`
    // обязан не сделать НИЧЕГО (порт tweb :275-277).
    I18n.applyLangPack({
      _: 'langPackDifference',
      lang_code: 'de',
      from_version: 0,
      version: 1,
      strings: [{ _: 'langPackString', key: 'ArchivedChats', value: 'Archiv' }],
    })

    expect(I18n.getLastRequestedLangCode()).toBe('ru')
    expect(t('ArchivedChats')).toBe('Архив')
    expect(useI18nStore.getState().lang).toBe('ru')
  })
})
