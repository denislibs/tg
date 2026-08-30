// Словари языков проверяются ПОВЕДЕНИЕМ: что показал `i18n()` на конкретном числе и
// что отдал старый `t()`. Сверять поля объекта строки бессмысленно — такая проверка
// зеленеет и на перепутанных местами формах числа (это уже случалось в волне дважды).
//
// Строки берутся из НАСТОЯЩИХ `dict.*.ts` и прогоняются через настоящее применение
// языка — тем же путём, каким они поедут в бою (задача 5).
import { describe, expect, it } from 'vitest'

import lang, { type LangPackKey } from '@/lang'
import I18n, { i18n } from '@lib/langPack'

import ru from './dict.ru'
import uk from './dict.uk'
import es from './dict.es'
import de from './dict.de'
import fr from './dict.fr'
import { toLegacyDict } from './legacyDict'
import { LEGACY_KEY_MAP } from './legacyKeyMap'

const DICTS = { ru, uk, es, de, fr }
type Code = keyof typeof DICTS

/** Применение языка — единственный вход, каким строки попадают в ядро. Английский
 *  источник кладётся под низ, как это делает загрузчик: перевода может не быть. */
function apply(code: Code) {
  const strings = I18n.formatLocalStrings(lang)
  strings.push(...DICTS[code])
  I18n.setLangCode(code)
  I18n.applyLangPack({ _: 'langPackDifference', lang_code: code, from_version: 0, version: 1, strings })
}

const text = (key: LangPackKey, args: (string | number)[]) => i18n(key, args).textContent

describe('формы числа выбирает язык, а не вызывающий', () => {
  // Числа выбраны по границам русского правила: 1 — one, 2 — few, 5 — many, 21 — снова
  // one. Именно 21 ловит «взяли форму по последней цифре наоборот» и «few вместо many».
  it('русский склоняет 1/2/5/21', () => {
    apply('ru')
    expect([1, 2, 5, 21].map((n) => text('Notifications.Count', [n]))).toEqual([
      '1 уведомление',
      '2 уведомления',
      '5 уведомлений',
      '21 уведомление',
    ])
  })

  it('украинский склоняет 1/2/5/21', () => {
    apply('uk')
    expect([1, 2, 5, 21].map((n) => text('Notifications.Count', [n]))).toEqual([
      '1 сповіщення',
      '2 сповіщення',
      '5 сповіщень',
      '21 сповіщення',
    ])
  })

  // У немецкого, испанского и французского форм всего две — и это не «недоперевод»,
  // а правило языка: пятёрка обязана дать ту же форму, что и двойка.
  it('у языков с двумя формами 2 и 5 дают одно и то же', () => {
    const got: Record<string, string[]> = {}
    for (const code of ['de', 'es', 'fr'] as const) {
      apply(code)
      got[code] = [1, 2, 5].map((n) => text('Notifications.Count', [n])!)
    }
    expect(got).toEqual({
      de: ['1 Benachrichtigung', '2 Benachrichtigungen', '5 Benachrichtigungen'],
      es: ['1 notificación', '2 notificaciones', '5 notificaciones'],
      fr: ['1 notification', '2 notifications', '5 notifications'],
    })
  })

  // Форму даёт КОД ЯЗЫКА пакета: те же данные под другим кодом склоняются иначе.
  // Без этого «правильный русский» мог бы оказаться правилом прошлого языка.
  it('смена языка меняет правило, а не только слова', () => {
    apply('ru')
    const before = text('Notifications.Count', [5])
    apply('de')
    expect(before).toBe('5 уведомлений')
    expect(text('Notifications.Count', [5])).toBe('5 Benachrichtigungen')
  })

  // Каждая форма, объявленная в словаре, обязана ДОЕХАТЬ до текста: недостающая
  // выдаёт себя тем, что ядро показывает сам ключ или чужой язык.
  it('в каждом словаре все формы всех числовых строк дают перевод', () => {
    const bad: string[] = []
    for (const code of Object.keys(DICTS) as Code[]) {
      apply(code)
      for (const string of DICTS[code]) {
        if (string._ !== 'langPackStringPluralized') continue
        const key = string.key as LangPackKey
        for (const n of [1, 2, 5, 21, 101]) {
          const got = text(key, [n])
          if (got === key) bad.push(`${code} ${key} на ${n}: показан ключ`)
          if (got === `${n} ${String(lang[key])}`) bad.push(`${code} ${key} на ${n}: английский текст`)
        }
      }
    }
    expect(bad).toEqual([])
  })
})

// Задача #102: пока английский был сам себе ключом, «строка осталась английской» и
// «перевода нет» были неразличимы. Теперь ключ символический — и совпадение перевода
// с английским источником означает, что переводить забыли.
//
// Проверка идёт по КИРИЛЛИЧЕСКИМ языкам: у них латинская строка почти наверняка
// недосмотр. Для de/es/fr она смысла не имеет — там десятки строк совпадают с
// английским законно («Album», «Navigation», «Discussion», «Spoiler»), и список
// исключений на 35 записей был бы затычкой, а не проверкой (числа — в отчёте задачи).
const SAME_AS_ENGLISH: Record<'ru' | 'uk', Partial<Record<LangPackKey, string>>> = {
  ru: {
    'Premium.Boarding.Title': 'название продукта — «Telegram Premium» не переводится',
    TelegramStars: 'название валюты — «Telegram Stars» не переводится',
    OK: 'интернационализм: в русском Telegram кнопка тоже «OK»',
    PaymentShippingEmailPlaceholder: '«Email» — заимствование, в русском Telegram так же',
    AttachGif: 'GIF — аббревиатура формата, не переводится',
  },
  uk: {
    'Premium.Boarding.Title': 'назва продукту — «Telegram Premium» не перекладається',
    PaymentShippingEmailPlaceholder: '«Email» — запозичення, в українському Telegram так само',
    AttachGif: 'GIF — абревіатура формату, не перекладається',
  },
}

describe('непереведённый ключ виден как отсутствие перевода', () => {
  for (const code of ['ru', 'uk'] as const) {
    it(`в ${code}-словаре нет ключей со значением, равным английскому источнику`, () => {
      const allowed = SAME_AS_ENGLISH[code]
      const suspicious = DICTS[code]
        .filter((string) => string._ === 'langPackString')
        .filter((string) => string.value === lang[string.key as LangPackKey])
        .map((string) => string.key)
        .filter((key) => !(key in allowed))
      expect(suspicious).toEqual([])
    })
  }

  it('исключения не протухли: каждое всё ещё совпадает с источником', () => {
    // Иначе список живёт своей жизнью и прикрывает ключи, которых давно нет.
    const stale: string[] = []
    for (const code of ['ru', 'uk'] as const) {
      const byKey = new Map(DICTS[code].map((string) => [string.key, string]))
      for (const key of Object.keys(SAME_AS_ENGLISH[code])) {
        const string = byKey.get(key)
        if (string?._ !== 'langPackString' || string.value !== lang[key as LangPackKey]) {
          stale.push(`${code} ${key}: исключение больше не нужно`)
        }
      }
    }
    expect(stale).toEqual([])
  })
})

// Старый `t('English string')` живёт до задачи 9, и данных под него больше нет —
// он считается из нового словаря. Проверяем именно то, что видит вызывающий.
describe('старый t() продолжает переводить', () => {
  const legacyRu = toLegacyDict(ru)

  it('обычная строка переводится по-старому ключу', () => {
    expect(legacyRu['Archived Chats']).toBe('Архив')
  })

  // Три старых ключа форм числа смотрят в одну строку с формами; каждый обязан
  // достать СВОЮ форму. Позиционное чтение слотов даёт «2 уведомлений».
  it('старый ключ формы числа достаёт именно свою форму', () => {
    expect([
      legacyRu['%d notification'],
      legacyRu['%d notifications (few)'],
      legacyRu['%d notifications'],
    ]).toEqual(['%d уведомление', '%d уведомления', '%d уведомлений'])
  })

  // Слитые строки: перевод теперь один на двоих, но исчезнуть не должна ни одна.
  it('обе строки объявленного слияния остаются переводимыми', () => {
    expect([legacyRu['Loading'], legacyRu['Loading…']]).toEqual(['Загрузка…', 'Загрузка…'])
    expect([legacyRu['Block User'], legacyRu['Block user']])
      .toEqual(['Заблокировать пользователя', 'Заблокировать пользователя'])
  })

  it('ни одна старая строка переводимого ключа не потерялась', () => {
    const lost: string[] = []
    for (const [code, strings] of Object.entries(DICTS)) {
      const known = new Set(strings.map((string) => string.key))
      const legacy = toLegacyDict(strings)
      for (const [old, key] of Object.entries(LEGACY_KEY_MAP)) {
        if (known.has(key) && legacy[old] === undefined) lost.push(`${code}: ${old} (${key})`)
      }
    }
    expect(lost).toEqual([])
  })
})
