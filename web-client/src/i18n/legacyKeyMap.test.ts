import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import lang, { type LangPackKey } from '../lang'
import { en } from './dict'
import { loadLang, useI18nStore } from './index'
import ru from './dict.ru'
import { LEGACY_ALIASES, LEGACY_KEY_MAP, LEGACY_KEY_OVERRIDES, LEGACY_MERGED_FRAGMENTS, LEGACY_PLURAL_GROUPS } from './legacyKeyMap'

// Словарь языка (задача 3) — уже конструкторы схемы с символическими ключами, а не
// «ключ = английская строка». Проверки ниже спрашивают с него то же самое, но в новых
// терминах: раньше «карта покрывает ключи словаря», теперь «ключи словаря достижимы
// по карте» — иначе кодмод задачи 6 подставит в вызов ключ, которого никто не переводит.
const ruByKey = new Map(ru.map((string) => [string.key, string]))

// Карта — единственное, что связывает старые ключи («ключ = английская строка») с
// символическими. Если она дырявая или неоднозначная, кодмод задачи 6 молча потеряет строки,
// поэтому проверяем именно полноту и однозначность, а не «файл импортируется».

// Пути исключений даны от корня web-client — vitest запускается оттуда же.
const WEB_CLIENT = process.cwd()

// Формы числа объявлены как «форма → старая строка»; для проверок слияния нужен список строк.
const pluralLegacyKeys = (key: string) => [...new Set(Object.values(LEGACY_PLURAL_GROUPS[key]))]
const MERGED: Record<string, string[]> = {
  ...Object.fromEntries(Object.keys(LEGACY_PLURAL_GROUPS).map((key) => [key, pluralLegacyKeys(key)])),
  ...LEGACY_ALIASES,
}

describe('карта миграции ключей', () => {
  // Ключи, заведённые ЗАДАЧЕЙ 6 и не имеющие старой строки вовсе: экран горячих клавиш
  // адресовал секции теми же строками, что и другие экраны («Messages», «Stories»), а
  // формат ссылки брал плейсхолдер поля ссылки-приглашения. Своих старых ключей у них
  // не было, поэтому карта до них и не достаёт — список короткий и назван поимённо.
  const NEW_WITHOUT_LEGACY = [
    // Экран горячих клавиш адресовал секции теми же строками, что и другие экраны
    // («Messages», «Stories»), а формат ссылки брал плейсхолдер поля ссылки-приглашения.
    'KeyboardShortcuts.Section.Messages',
    'KeyboardShortcuts.Section.Stories',
    'KeyboardShortcuts.Action.Link',
    // «N комментариев» собиралось В КОДЕ (своя славянская арифметика с русскими словами),
    // строки в словаре под это не было вовсе.
    'Chat.Title.Comments',
    // Ключи, заведённые задачей 6 при разводке мест и при закрытии дыр в переводе: старой
    // строки у них не было ни одной — карте до них не дотянуться по построению.
    'AddOneMemberAlertTitle',
    'AutoDownloadSettings.LastDelimeter',
    'Channel.UsernameAboutChannel',
    'ChannelPrivate',
    'ChannelPrivateInfo',
    'ChannelPrivateLinkHelp',
    'ChannelPublic',
    'ChannelPublicInfo',
    'Chat.Context.ReadLabel',
    'InviteLinks.Description.Additional',
    'InviteLinks.TimeLimitHelp',
    'InviteLinks.UsesLimitHelp',
    'MediaEditor.Adjustments.Fade',
    'MediaEditor.Adjustments.Grain',
    'MediaEditor.Adjustments.Highlights',
    'MediaEditor.Adjustments.Shadows',
    'MediaEditor.Adjustments.Sharpen',
    'MediaEditor.Adjustments.Vignette',
    'MediaEditor.Brushes.Arrow',
    'MediaEditor.Brushes.Blur',
    'MediaEditor.Brushes.Brush',
    'MediaEditor.Brushes.Eraser',
    'MediaEditor.Brushes.Neon',
    'MediaEditor.Brushes.Pen',
    'PrivacyVoiceMessages',
    'SharedFolder.Edit.Title',
    'SharedFolder.Link.Caption',
    'Translate.SectionCaption',
    // Ключи, заведённые по итогам ревью взамен ключей ЧУЖИХ мест (кнопка звука
    // редактора медиа, сброс значка темы, «Далее» пасскода, «Ещё» историй, фамилия в
    // редакторе профиля, отключение автоудаления) и формы числа заголовка отправки.
    'PreviewSender.SendAlbum',
    'PreviewSender.SendFile',
    'PreviewSender.SendPhoto',
    'PreviewSender.SendVideo',
    'MediaEditor.Mute',
    'MediaEditor.Unmute',
    'ForumTopic.NoIcon',
    'Common.More',
    'Common.Next',
    'Story.Sound',
    'EditProfile.LastNameLabel',
    'AutoDeleteMessages.Disable',
    'Statistics.Posts',
    // Раунд 2. Название чата, созданного без имени: до волны оно было английским
    // литералом прямо в вызове менеджера, старой строки словаря у него не было.
    'NewChannel.DefaultTitle',
    'NewGroup.DefaultTitle',
    // Срок ограничения участника: «1 hour» стоял английским литералом в таблице
    // `RESTRICT_DURATIONS` и до словаря не доезжал вовсе.
    'Hours',
  ]

  it('достаёт каждый ключ нынешнего словаря', () => {
    const reachable = new Set<string>([
      ...Object.values(LEGACY_KEY_MAP),
      // Точечное исключение — это тоже путь к ключу: старая строка у места была, просто
      // не та, что у карты.
      ...LEGACY_KEY_OVERRIDES.map((o) => o.key),
      ...NEW_WITHOUT_LEGACY,
    ])
    const missing = [...ruByKey.keys()].filter((key) => !reachable.has(key))
    expect(missing).toEqual([])
  })

  it('покрывает и английские исключения (текст не равен ключу)', () => {
    const missing = Object.keys(en).filter((k) => !(k in LEGACY_KEY_MAP))
    expect(missing).toEqual([])
  })

  it('не отображает два разных ключа в один', () => {
    const seen = new Map<string, string>()
    const collisions: string[] = []
    for (const [legacy, key] of Object.entries(LEGACY_KEY_MAP)) {
      if (key in MERGED) continue // объявленное слияние — проверяется отдельно ниже
      // Обрывок, сведённый в форму числа: их НЕСКОЛЬКО на ключ по построению («1 day»,
      // «2 days», …, «days» → `Days`), и это объявлено списком, а не случайность.
      if (legacy in LEGACY_MERGED_FRAGMENTS) continue
      const prev = seen.get(key)
      if (prev && prev !== legacy) collisions.push(`${key}: ${prev} / ${legacy}`)
      seen.set(key, legacy)
    }
    expect(collisions).toEqual([])
  })

  it('каждый символический ключ есть в английском источнике', () => {
    const orphans = Object.values(LEGACY_KEY_MAP).filter((k) => !(k in lang))
    expect(orphans).toEqual([])
  })
})

// Списки слияний освобождают ключи от проверки однозначности — значит, они сами обязаны быть
// точными. Иначе достаточно вписать туда что угодно, чтобы проверка выше перестала ловить.
describe('объявленные слияния', () => {
  it('перечисляют ровно те старые ключи, что смотрят в этот символический', () => {
    const actual = new Map<string, string[]>()
    for (const [legacy, key] of Object.entries(LEGACY_KEY_MAP)) {
      if (!(key in MERGED)) continue
      actual.set(key, [...(actual.get(key) ?? []), legacy])
    }
    const wrong: string[] = []
    for (const [key, declared] of Object.entries(MERGED)) {
      const got = (actual.get(key) ?? []).slice().sort()
      const want = declared.slice().sort()
      if (got.join(' ') !== want.join(' ')) {
        wrong.push(`${key}: объявлено [${want.join(', ')}], в карте [${got.join(', ')}]`)
      }
    }
    expect(wrong).toEqual([])
  })

  it('не бывают из одного ключа — иначе слияния нет и объявление лишнее', () => {
    const single = Object.entries(MERGED)
      .filter(([, keys]) => keys.length < 2)
      .map(([key]) => key)
    expect(single).toEqual([])
  })

  it('у формы числа значение в lang.ts — объект с формами, а не строка', () => {
    const flat = Object.keys(LEGACY_PLURAL_GROUPS).filter((key) => typeof lang[key as keyof typeof lang] === 'string')
    expect(flat).toEqual([])
  })

  // Без этого форма числа снова стала бы списком без меток: задача 3 собирает русские
  // переводы по слотам, и перепутанные формы дают «2 уведомлений» / «5 уведомления».
  it('у формы числа каждый слот указывает на существующую строку словаря', () => {
    const bad: string[] = []
    for (const [key, forms] of Object.entries(LEGACY_PLURAL_GROUPS)) {
      const string = ruByKey.get(key)
      for (const [form, legacy] of Object.entries(forms)) {
        if (LEGACY_KEY_MAP[legacy] !== key) bad.push(`${key}.${form}: ${legacy} смотрит в ${LEGACY_KEY_MAP[legacy]}`)
        if (string?._ !== 'langPackStringPluralized') bad.push(`${key}: в dict.ru не форма числа`)
        else if (string[form as 'one_value'] === undefined) bad.push(`${key}.${form}: формы нет в dict.ru`)
      }
    }
    expect(bad).toEqual([])
  })

  // Слоты обязаны совпадать с ФАКТИЧЕСКИМ выбором, а не читаться «на глаз»: переставленные
  // few/many проходят зелёными и дают «2 уведомлений» / «5 уведомления». Раньше выбор жил в
  // `client/appBadge.ts` (своя славянская арифметика), и сверялись с ним; теперь форму
  // выбирает ЯЗЫК (`Intl.PluralRules` внутри `tArgs`), и сверяться надо с ним.
  //
  // Проверка замыкает круг: перевод СТАРОЙ строки нужной формы обязан совпасть с тем, что
  // язык печатает на этом числе. Русский взят потому, что только он различает все три формы.
  it('слоты совпадают с формой, которую выбирает язык', async () => {
    const forms = LEGACY_PLURAL_GROUPS['Notifications.Count']
    useI18nStore.setState({ lang: 'ru' })
    await loadLang('ru')
    const { t, tArgs } = useI18nStore.getState()
    // Слот — СТАРАЯ строка («%d notifications (few)»), а не ключ: `t` понимает обе формы
    // до задачи 9, но тип у неё уже ключ — отсюда приведение.
    const legacy = (slot: string | undefined, count: number) => t(slot as LangPackKey).replace('%d', String(count))
    expect([tArgs('Notifications.Count', [1]), tArgs('Notifications.Count', [2]), tArgs('Notifications.Count', [5])])
      .toEqual([legacy(forms.one_value, 1), legacy(forms.few_value, 2), legacy(forms.many_value, 5)])
  })

  it('у формы числа объявлены все формы, которые различает нынешний выбор', () => {
    // Русский различает one / few / many, английский — one / other; чтобы старая форма
    // ключа переводилась у обоих, заполнены обязаны быть все четыре слота.
    const incomplete = Object.entries(LEGACY_PLURAL_GROUPS)
      .filter(([, f]) => !f.one_value || !f.few_value || !f.many_value || !f.other_value)
      .map(([key]) => key)
    expect(incomplete).toEqual([])
  })
})

// Точечные исключения — вторая структура, по которой прошла задача 6. ПОСЛЕ кодмода они
// проверяются по РЕЗУЛЬТАТУ: в файле стоит именно тот ключ, который назначило исключение,
// старой строки там больше нет, и ключ стоит у своего якоря. Это уже не «карта верна», а
// пин на живое место: вернуть сюда ключ, который диктует карта (`ChatList.Context.Pin`
// вместо `Message.Context.Pin`), нельзя молча.
describe('точечные исключения к карте', () => {
  // Позиции всех вхождений КЛЮЧА исключения — в любом виде: `t('Key')`, проп
  // `title="Key"`, элемент таблицы. Считать только вызовы `t()` нельзя: половина
  // мест передаёт ключ дальше пропом, а переводит его уже принимающий компонент.
  const occurrencesOf = (o: (typeof LEGACY_KEY_OVERRIDES)[number]) => {
    const src = readFileSync(resolve(WEB_CLIENT, o.file), 'utf8')
    const literal = `'${o.key}'`
    const at: number[] = []
    for (const quote of ["'", '"']) {
      const needle = `${quote}${o.key}${quote}`
      for (let i = src.indexOf(needle); i !== -1; i = src.indexOf(needle, i + 1)) at.push(i)
    }
    at.sort((a, b) => a - b)
    return { src, literal, at }
  }

  /** Литерал старого вызова — того, что кодмод обязан был из файла убрать. */
  const legacyLiteral = (o: (typeof LEGACY_KEY_OVERRIDES)[number]) =>
    `t('${o.legacy.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/'/g, "\\'")}')`

  it('стоят в существующем файле, где есть и вызов с их ключом, и якорь', () => {
    const bad: string[] = []
    for (const o of LEGACY_KEY_OVERRIDES) {
      if (!existsSync(resolve(WEB_CLIENT, o.file))) {
        bad.push(`${o.file}: файла нет`)
        continue
      }
      const { src, literal, at } = occurrencesOf(o)
      if (!at.length) bad.push(`${o.file}: нет вызова ${literal}`)
      if (!src.includes(o.anchor)) bad.push(`${o.file}: нет якоря ${o.anchor}`)
      if (!at[o.occurrence]) bad.push(`${o.file}: вхождения №${o.occurrence} нет (всего ${at.length})`)
    }
    expect(bad).toEqual([])
  })

  // Исключение, которое не применили, ничем не отличается от несуществующего: место
  // получило бы ключ карты — тот самый, ради отказа от которого запись и заведена.
  it('применены: старой строки в файле не осталось', () => {
    const bad: string[] = []
    for (const o of LEGACY_KEY_OVERRIDES) {
      if (!existsSync(resolve(WEB_CLIENT, o.file))) continue
      const { src } = occurrencesOf(o)
      if (src.includes(legacyLiteral(o))) bad.push(`${o.file}: остался ${legacyLiteral(o)} — исключение не применено`)
    }
    expect(bad).toEqual([])
  })

  // Без этой проверки якорь ни к чему не привязан: две записи можно поменять якорями местами и
  // остаться зелёным — то есть «перепутали, какому баннеру какой ключ» проходит незамеченным.
  // Якорь обязан стоять В ТОМ ЖЕ блоке, что и вызов: после предыдущего вхождения того же ключа и
  // не дальше пятнадцати строк над своим. Имя переменной, объявленной в начале файла, якорем
  // быть не может — блок ей не принадлежит.
  const NEAR_LINES = 15
  it('якорь стоит в блоке своего вхождения, и вхождения не делятся', () => {
    const bad: string[] = []
    const taken = new Set<string>()
    for (const o of LEGACY_KEY_OVERRIDES) {
      const { src, at } = occurrencesOf(o)
      const here = at[o.occurrence]
      if (here === undefined) continue // разобрано проверкой выше
      const after = o.occurrence > 0 ? at[o.occurrence - 1] : -1
      const linesBetween = (a: number, b: number) => src.slice(a, b).split('\n').length - 1
      let ok = false
      for (let i = src.indexOf(o.anchor); i !== -1; i = src.indexOf(o.anchor, i + 1)) {
        if (i > after && i < here && linesBetween(i, here) <= NEAR_LINES) ok = true
      }
      if (!ok) bad.push(`${o.file} ${o.key}: якоря «${o.anchor}» нет в блоке вхождения №${o.occurrence}`)
      const slot = `${o.file}|${o.key}|${o.occurrence}`
      if (taken.has(slot)) bad.push(`${slot}: на это вхождение уже есть запись`)
      taken.add(slot)
    }
    expect(bad).toEqual([])
  })

  it('ссылаются на известный старый ключ и существующий символический', () => {
    const bad: string[] = []
    for (const o of LEGACY_KEY_OVERRIDES) {
      if (!(o.legacy in LEGACY_KEY_MAP)) bad.push(`${o.legacy}: нет в карте`)
      if (!(o.key in lang)) bad.push(`${o.key}: нет в lang.ts`)
      if (LEGACY_KEY_MAP[o.legacy] === o.key) bad.push(`${o.legacy} -> ${o.key}: совпадает с картой, исключение лишнее`)
    }
    expect(bad).toEqual([])
  })
})
