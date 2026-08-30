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

// Состав словарей ничем, кроме этого пина, не держится: молча уронить строку могут обе
// самые массовые задачи волны — кодмод задачи 6 и снос `t()` задачей 9. Потеря выглядит
// не как падение, а как английский текст у русского пользователя, и без пина сборка
// про неё молчит. Числа — не данные и не тавтология: они считаются из словаря, а не из
// него же берутся, и обновлять их можно только осознанно.
//
// `fingerprint` нужен сверх чисел: переименование ключа их не меняет, а перевод при этом
// теряется точно так же. Изменили словарь намеренно — обновите снимок ЗДЕСЬ и объясните
// в теле коммита, что именно ушло и пришло.
// Задача 6 добавила русскому девять строк: те, что были зашиты в код ПО-РУССКИ
// (секретный чат, подтверждение входа по QR, подсказка о фото контакта). Текст у них
// тот же, что показывался раньше, — изменилось только то, что теперь он ключ и перевод,
// а не литерал в JSX (плюс «Звонок» — метка превью из `core/dialogToChat.ts`).
// `legacy` вырос на одиннадцать: десять новых строк плюс «Отмена», ставшая синонимом `Cancel`.
const COMPOSITION = {
  ru: { keys: 1180, plural: 1, legacy: 1197 },
  uk: { keys: 675, plural: 1, legacy: 689 },
  es: { keys: 674, plural: 1, legacy: 688 },
  de: { keys: 674, plural: 1, legacy: 688 },
  fr: { keys: 674, plural: 1, legacy: 688 },
}

// es/de/fr совпадают не случайно: у них ОДИН набор ключей и разные переводы —
// снимок считается по ключам, а не по текстам.
// Снимок обновлён задачей 6: ключ 'Login.Passkey.Error' переименован в
// 'Error.SomethingWentWrong' — его звали пять мест, и ни одно из них не про вход
// (папки, истории, близкие друзья). Состав словарей не изменился: те же строки под
// другим именем, поэтому числа выше прежние, а снимок НАБОРА — новый.
const FINGERPRINT = {
  ru: '4afd5730',
  uk: '9fedaf5c',
  es: '003c0024',
  de: '003c0024',
  fr: '003c0024',
}

/** FNV-1a по отсортированным ключам: короткий снимок НАБОРА, а не его копия. */
function fingerprint(keys: string[]) {
  let h = 0x811c9dc5
  for (const ch of [...keys].sort().join('\n')) {
    h ^= ch.codePointAt(0)!
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

describe('состав словарей под пином', () => {
  it('число строк по языкам не менялось', () => {
    const got = Object.fromEntries(Object.entries(DICTS).map(([code, strings]) => [code, {
      keys: strings.length,
      plural: strings.filter((string) => string._ === 'langPackStringPluralized').length,
      // Сколько старых строк ещё получают перевод — это и видит пользователь до задачи 9.
      legacy: Object.keys(toLegacyDict(strings)).length,
    }]))
    expect(got).toEqual(COMPOSITION)
  })

  it('набор ключей по языкам не менялся', () => {
    const got = Object.fromEntries(
      Object.entries(DICTS).map(([code, strings]) => [code, fingerprint(strings.map((s) => s.key))]),
    )
    expect(got).toEqual(FINGERPRINT)
  })
})

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

  // Слот `other` у славянских языков достаётся ТОЛЬКО дробным, и там родительный
  // единственного, а не форма `many`. Проверка держит это утверждение данными: без неё
  // комментарий у словаря обещал бы больше, чем в нём лежит.
  it('дробное число берёт other, и это не форма many', () => {
    apply('ru')
    expect(text('Notifications.Count', [1.5])).toBe('1.5 уведомления')
    apply('uk')
    expect(text('Notifications.Count', [1.5])).toBe('1.5 сповіщення')
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
// Совпадение НЕ ВСЕГДА недосмотр: у латиницы десятки слов законно пишутся так же
// («Album», «Navigation», «Discussion», «Spoiler», единицы «KB/MB/GB»). Поэтому список
// поимённый, а не «этот язык не проверяем»: снимок закрыт проверкой «исключения не
// протухли» — вписанный сюда переведённый ключ её краснит, и список не превращается
// в затычку. Новая непереведённая строка в любом из пяти языков теперь красит сборку.
const SAME_AS_ENGLISH: Record<Code, Partial<Record<LangPackKey, string>>> = {
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
  es: {
    'Premium.Boarding.Title': 'nombre del producto — «Telegram Premium» не переводится',
    AutoDownloadVideos: '«videos» — допустимое испанское написание (лат.-амер. норма)',
    FilterPersonal: '«personal» — испанское слово, пишется так же',
    ReportChatSpam: '«spam» — заимствование, в испанском Telegram так же',
    FilterChats: '«chats» — заимствование с испанским множественным',
    'SharedMedia.Audio': '«audio» — латинское слово, совпадает',
    'Unit.Minutes.Abbr': '«min» — международное сокращение минуты',
    'StorageQuota.CacheSizeLimitAuto': '«auto» — сокращение от «automático»',
    'Unit.Bytes': 'B — единица информации, не переводится',
    'Unit.Kilobytes': 'KB — единица информации, не переводится',
    'Unit.Megabytes': 'MB — единица информации, не переводится',
    'Unit.Gigabytes': 'GB — единица информации, не переводится',
    'KeyboardShortcuts.Action.Spoiler': '«spoiler» — заимствование',
    'KeyboardShortcuts.Section.Chat': '«chat» — заимствование',
    AttachGif: 'GIF — аббревиатура формата',
    AttachSticker: '«sticker» — заимствование, в испанском Telegram так же',
  },
  de: {
    'Theme.System': '«System» — немецкое слово, пишется так же',
    Stories: '«Stories» — заимствование, в немецком Telegram так же',
    Online: '«online» — заимствование',
    'Premium.Boarding.Title': 'название продукта — «Telegram Premium» не переводится',
    AutodownloadPrivateChats: '«Private Chats» — немецкое «privat» плюс заимствованное «Chats»',
    AutoDownloadVideos: '«Videos» — немецкое множественное от «Video»',
    'Stars.Wallet': '«Wallet» — заимствование, немецкого эквивалента в Telegram нет',
    ReportChatSpam: '«Spam» — заимствование',
    Info: '«Info» — немецкое сокращение от «Information»',
    SetUrlPlaceholder: '«Link» — немецкое слово',
    UserBio: '«Bio» — сокращение, совпадает',
    SharedLinksTab2: '«Links» — немецкое множественное от «Link»',
    FilterChats: '«Chats» — заимствование',
    'NewPoll.Option': '«Option» — немецкое слово',
    'Chat.Poll.Type.Quiz': '«Quiz» — немецкое слово',
    'SharedMedia.Audio': '«Audio» — совпадает',
    'EditProfile.FirstNameLabel': '«Name» — немецкое слово',
    'EditProfile.BioLabel': '«Bio (optional)» — оба слова немецкие',
    'Settings.Limits': '«Limits» — заимствование, немецкое множественное',
    'Privacy.Passkeys': '«Passkeys» — термин без немецкого эквивалента',
    'Passkeys.Item': '«Passkey» — тот же термин в единственном',
    'StorageQuota.CacheSizeLimitAuto': '«Auto» — сокращение от «automatisch»',
    'Unit.Bytes': 'B — единица информации, не переводится',
    'Unit.Kilobytes': 'KB — единица информации, не переводится',
    'Unit.Megabytes': 'MB — единица информации, не переводится',
    'Unit.Gigabytes': 'GB — единица информации, не переводится',
    'KeyboardShortcuts.Action.Monospace': '«Monospace» — типографский термин',
    'KeyboardShortcuts.Action.Spoiler': '«Spoiler» — немецкое слово',
    'KeyboardShortcuts.Section.Chat': '«Chat» — заимствование',
    'KeyboardShortcuts.Section.Navigation': '«Navigation» — немецкое слово',
    AttachAlbum: '«Album» — немецкое слово',
    AttachVideo: '«Video» — немецкое слово',
    AttachGif: 'GIF — аббревиатура формата',
    AttachSticker: '«Sticker» — немецкое слово',
  },
  fr: {
    Stories: '«Stories» — заимствование, во французском Telegram так же',
    'Premium.Boarding.Title': 'название продукта — «Telegram Premium» не переводится',
    Notifications: '«notifications» — французское слово',
    AutoDownloadPhotos: '«photos» — французское слово',
    'CallSettings.Microphone': '«microphone» — французское слово',
    Contacts: '«contacts» — французское слово',
    Message: '«message» — французское слово',
    ReportChatSpam: '«spam» — заимствование',
    ReportChatViolence: '«violence» — французское слово',
    UserBio: '«bio» — сокращение от «biographie»',
    'PeerInfo.Discussion': '«discussion» — французское слово',
    DescriptionPlaceholder: '«description» — французское слово',
    SearchMessages: '«messages» — французское слово',
    'VoiceChat.Status.ParticipantsSuffix': '«participants» — французское слово',
    'NewPoll.Option': '«option» — французское слово',
    'Chat.Poll.Type.Quiz': '«quiz» — заимствование',
    AttachContact: '«contact» — французское слово',
    'SharedMedia.Audio': '«audio» — французское слово',
    Animations: '«animations» — французское слово',
    Exceptions: '«exceptions» — французское слово',
    'Unit.Minutes.Abbr': '«min» — сокращение от «minute»',
    'StorageQuota.CacheSizeLimitAuto': '«auto» — сокращение от «automatique»',
    'KeyboardShortcuts.Action.Monospace': '«monospace» — типографский термин',
    'KeyboardShortcuts.Action.Spoiler': '«spoiler» — заимствование',
    'KeyboardShortcuts.Section.Navigation': '«navigation» — французское слово',
    AttachAlbum: '«album» — французское слово',
    AttachPhoto: '«photo» — французское слово',
    AttachGif: 'GIF — аббревиатура формата',
    AttachSticker: '«sticker» — заимствование',
  },
}

describe('непереведённый ключ виден как отсутствие перевода', () => {
  for (const code of Object.keys(DICTS) as Code[]) {
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
    for (const code of Object.keys(DICTS) as Code[]) {
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
