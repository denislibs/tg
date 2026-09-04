// Словари языков проверяются ПОВЕДЕНИЕМ: что показал `i18n()` на конкретном числе.
// Сверять поля объекта строки бессмысленно — такая проверка зеленеет и на
// перепутанных местами формах числа (это уже случалось в волне дважды).
//
// Строки берутся из НАСТОЯЩИХ `dict.*.ts` и прогоняются через настоящее применение
// языка. Эти файлы больше не чанки приложения (задача 9), а ИСХОДНИК, из которого
// сервер набивает свою таблицу (`backend/internal/langsource`), — то есть проверяется
// ровно то, что в бою приедет по сети.
import { describe, expect, it } from 'vitest'

import lang, { type LangPackKey } from '@/lang'
import I18n, { i18n } from '@lib/langPack'
import { applyLang } from '@/test/lang'

import ru from './dict.ru'
import uk from './dict.uk'
import es from './dict.es'
import de from './dict.de'
import fr from './dict.fr'

const DICTS = { ru, uk, es, de, fr }
type Code = keyof typeof DICTS

/**
 * Применение языка — тем же кодом продукта, что и в бою (`@/test/lang::applyLang`
 * → `I18n.applyServerLangPack`). Слияние «английский вниз, перевод поверх» здесь
 * НЕ ПОВТОРЯЕТСЯ: повторённое, оно превращало бы проверки «непереведённый ключ
 * показывает английский» в проверки оснастки — разбор у самой `applyLang`.
 */
const apply = applyLang

const text = (key: LangPackKey, args: (string | number)[]) => i18n(key, args).textContent

/** Подстановка числа в строке формы — любая из принятых `superFormatter` записей. */
const PLACEHOLDER = /%\d\$[sd]|%[sd]/

/**
 * Русские строки, у которых формы совпадают ПО ЯЗЫКУ: «фото» и «видео» не склоняются
 * («1 фото», «5 фото»). Без этого списка правило «форма единицы отличается от формы
 * пятёрки» требовало бы выдумать несуществующее склонение; со списком — проверяется в
 * обе стороны, чтобы он не стал лазейкой (см. «исключение протухло» ниже).
 */
const RU_INDECLINABLE = new Set<string>(['PreviewSender.SendPhoto', 'PreviewSender.SendVideo'])

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
//
// Задача 6, раунд ревью: русскому дописаны 100 строк — ключи, которые зовёт код, а
// перевода под новым именем не было (звонок, редактор медиа, мини-приложения,
// ссылки-приглашения, обсуждение). Их полноту сторожит `dictCoverage.test.ts`.
//
// `plural` вырос с одного до девяти-десяти: девять ключей-ОБРЫВКОВ («members»,
// «subscribers», «days», …) сведены в формы числа — интерфейс печатал число и слово
// рядом, и слово не склонялось («1 members»).
//
// Раунд 2: у русского +3 ключа (`NewGroup.DefaultTitle`/`NewChannel.DefaultTitle` —
// название чата, созданного без имени; `Hours` и `CanJoin` — ключи оригинала взамен
// осиротевших `Duration.*` и выдуманного суффикса; минус два наших дубля,
// `InviteLinks.CanJoinSuffix` и `Chat.Context.ReadShowWhen`). У остальных четырёх +8:
// те же четыре ключа плюс блок `PreviewSender.*`, которого у них не было вовсе —
// заголовок попапа отправки падал на английский. `legacy` не изменился: «show when»
// теперь достаёт `PmReadShowWhen` вместо снятого дубля, «can join» ушёл в объявленные
// слияния (число уехало ВНУТРЬ строки).
// Снимок обновлён ЗАДАЧЕЙ 7: пустая выдача поиска сведена на ключи оригинала
// (`Search.Empty`/`Search.EmptyFrom` с жирным аргументом внутри строки) вместо трёх
// наших половинок. У русского ключей на один меньше (три → два), у остальных четырёх
// столько же (две половинки → две целых строки), а старых строк, получающих перевод,
// у них стало на одну больше: `Search.EmptyFrom` они раньше не переводили вовсе.
// Задача 8: каждому словарю добавлен РОВНО ОДИН ключ — `LanguageName`,
// самоназвание языка («Русский», «Українська», …). Им подписана строка «Язык» в
// настройках, как у tweb (`settings.tsx:254`); до этого имена языков лежали
// таблицей на экране (`i18n/index.tsx::LANGS`), а не в словаре.
//
// ФИНАЛЬНОЕ РЕВЬЮ (нарушение DoD 2a): плашка пересылки в композере приведена к
// оригиналу — вместо трёх наших плоских ключей (`Chat.Accessory.Forward.One`,
// `.Many`, `.Hidden`) две ФОРМЫ ЧИСЛА оригинала (`Chat.Accessory.Forward`,
// `Chat.Accessory.Hidden`, tweb lang.ts:3430 и :3436). У русского минус один
// ключ (3 → 2) и плюс две числовые строки; у остальных четырёх этих ключей не
// было вовсе, поэтому их снимки не изменились.
//
// Задача 9 убрала из снимка третье число — `legacy`, сколько СТАРЫХ строк
// («ключ = английская строка») ещё получают перевод. Убрала не потому, что оно
// неудобно, а потому, что его предмет снесён вместе с мостом `legacyDict`:
// старых строк не осталось ни одной, и число это теперь тождественный ноль во
// всех пяти языках. Состав самих словарей задача 9 не трогала — `keys` и
// `plural` те же, что были у задачи 8, и это главное, что пин здесь стережёт.
//
// Задача #121 («даты следуют за языком»): русскому добавлены ЧЕТЫРЕ ключа
// относительных дат оригинала — `Date.Today`/`Yesterday` (с заглавной, начинают
// подпись) и `Peer.Status.Today`/`Peer.Status.Yesterday` (строчные, внутри
// фразы). Их зовёт `helpers/date.ts::formatFullSentTimeRaw`, порт tweb
// `date.ts:135-176`. Остальных четырёх словарей это не коснулось — они покрыты
// наполовину by design.
//
// Задача #126 («подпись присутствия»): русскому добавлены ВОСЕМЬ ключей
// оригинала (`wrappers/getUserStatusString.ts`) — `WithinAWeek`,
// `WithinAMonth`, `ALongTimeAgo`, `SupportStatus`,
// `Peer.Status.justNow`, `Peer.Status.LastSeenAt` и ДВЕ числовые формы
// (`Peer.Status.minAgo`, `LastSeen.HoursAgo`), отчего `plural` вырос с 28 до 30.
// Тексты не новые: они дословно те, что стояли в `core/presence.ts` тернарником
// `lang === 'ru'`, — переехали из кода в словарь. Формы числа у «минут» и
// «часов» появились ВПЕРВЫЕ: склейка `${diffMin} мин назад` их выразить не
// могла. Остальных четырёх словарей это не коснулось: под ними остаётся
// английский нижний слой — ровно то, что они показывали и до порта, только
// теперь это видно как непереведённый ключ, а не спрятано в ветке `else`.
//
// Задача #128 («футер комментариев»): русскому добавлен `LeaveAComment`, а
// `Chat.Title.Comments` переименован в `Comments` во всех пяти — отсюда `keys`
// у русского 1305 при том же `plural`.
//
// Ревью задачи 6 волны 3 (снос React-версии экрана входа): семь ключей,
// которых больше не зовёт НИ ОДИН потребитель (звавшая их React-версия
// снесена целиком, Solid-карточки используют СВОИ ключи), удалены из
// `lang.ts` и всех пяти словарей — `Login.ByPasskey`, `Login.ByPhone`,
// `Login.Passkey.Failed`, `Login.Password.SubtitleFlat`, `Login.PhoneInvalid`,
// `Login.Register.LastName.Placeholder`, `Login.ResetPassword.CodeHint`.
// Присутствовали не во всех пяти одинаково: у русского все семь (1309 → 1302,
// −7); у остальных четырёх — по четыре (`Login.ByPasskey` и
// `Login.ResetPassword.CodeHint` не имели перевода в uk/es/de/fr, отдавались
// нижним английским слоем и в их `DICTS` не попадали): 688 → 684 (uk), 687 →
// 683 (es/de/fr). `plural` не менялся — среди семи не было числовых строк.
const COMPOSITION = {
  ru: { keys: 1302, plural: 30 },
  uk: { keys: 684, plural: 24 },
  es: { keys: 683, plural: 24 },
  de: { keys: 683, plural: 24 },
  fr: { keys: 683, plural: 24 },
}

// es/de/fr совпадают не случайно: у них ОДИН набор ключей и разные переводы —
// снимок считается по ключам, а не по текстам.
// Снимок обновлён задачей 6: ключ 'Login.Passkey.Error' переименован в
// 'Error.SomethingWentWrong' — его звали пять мест, и ни одно из них не про вход
// (папки, истории, близкие друзья). Состав словарей не изменился: те же строки под
// другим именем, поэтому числа выше прежние, а снимок НАБОРА — новый.
// Второй сдвиг набора той же задачей 7: наш ПРЕФИКС `DeleteAlsoFor` («Also delete
// for» + имя, склеенное вызывающим) заменён ключом оригинала
// `DeleteMessagesOptionAlso` («Also delete for %1$s», tweb lang.ts:1607). Число
// строк не изменилось — сменилось имя и появился аргумент внутри.
// Сдвиг набора задачей 8 — тот же один ключ `LanguageName` во всех пяти.
// Сдвиг набора задачей #121 — четыре ключа относительных дат у русского. Второй
// сдвиг той же задачей, уже во ВСЕХ пяти: наш обрезок-префикс подписи
// запланированного сообщения заменён ключом оригинала `Chat.Date.ScheduledFor`
// ('Scheduled for %@', tweb lang.ts:3467) — дата едет АРГУМЕНТОМ внутрь строки,
// а не приклеивается к переведённой половине фразы. Число ключей от этого не
// изменилось ни у кого, сменилось имя.
// Сдвиг набора задачей #126 — восемь ключей подписи присутствия у русского
// (`Online` и `Lately` в словаре уже были, :196 и :625).
// Сдвиг набора задачей #128 — ВО ВСЕХ ПЯТИ: наш `Chat.Title.Comments` заменён
// ключом оригинала `Comments` (tweb lang.ts:1357, аргумент позиционный `%1$d`),
// а русскому добавлен `LeaveAComment` — второй ключ футера, которого у нас не
// было вовсе: на нуле комментариев мы писали «Комментарии» вместо «Оставьте
// комментарий». Число строк выросло только у русского, у остальных сменилось
// имя ключа.
// Сдвиг набора порта вкладки «Язык» — ВО ВСЕХ ПЯТИ по одному ключу:
// `AccountSettings.Language` (tweb lang.ts:3385). Это ЗАГОЛОВОК СТРОКИ «Язык» в
// корне настроек; прежде строка была подписана `Telegram.LanguageViewController`,
// которым у оригинала подписана сама ВКЛАДКА, — по-английски обе читаются
// одинаково («Language»), поэтому подмена и держалась незамеченной. Теперь у
// каждой из двух ролей свой ключ, как в оригинале, и оба живые.
// Ревью задачи 5 волны 3 (auth-карточки на Solid): русскому добавлены ТРИ
// ключа 1:1 с tweb langSign.ts, у которых раньше был только наш собственный
// перифраз без стрелки/аргумента — `Login.Passkey` ('Log in by passkey >'),
// `Login.QR.Cancel` ('Log in by phone number >') и
// `Login.ResetPassword.Subtitle` ('...to your email **%s**.', маска почты
// аргументом). Старые ключи (`Login.Passkey.Action`, `Login.ByPhone`,
// `Login.ResetPassword.CodeHint`) тогда не удалялись — ими ещё пользовалась
// React-версия тех же карточек.
// Ревью задачи 6 волны 3: семь мёртвых ключей (см. докблок у `COMPOSITION`
// выше — тот же список) убраны из НАБОРА, отсюда новый снимок у всех пяти;
// `Login.Passkey.Action` при этом ЖИВ (его теперь зовёт Solid
// `SignInCard.solid.tsx`, кнопка входа по ключу доступа) — в списке снесённых
// его нет.
const FINGERPRINT = {
  ru: '1041e135',
  uk: 'c2475b60',
  es: '32bfb526',
  de: '32bfb526',
  fr: '32bfb526',
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
  it('русский склоняет 1/2/5/21', async () => {
    await apply('ru')
    expect([1, 2, 5, 21].map((n) => text('Notifications.Count', [n]))).toEqual([
      '1 уведомление',
      '2 уведомления',
      '5 уведомлений',
      '21 уведомление',
    ])
  })

  // Ключи-ОБРЫВКИ, сведённые задачей 6: интерфейс печатал «5» и «участников» рядом, и
  // слово не склонялось — «1 участников». Проверка держит именно это: единица обязана
  // дать единственное число, а не общую форму.
  it('сведённые обрывки склоняются: участники, подписчики, стикеры, дни', async () => {
    await apply('ru')
    expect([
      text('Members', [1]), text('Members', [2]), text('Members', [5]),
      text('Subscribers', [1]), text('Stickers', [1]), text('Days', [1]), text('Days', [3]),
    ]).toEqual([
      '1 участник', '2 участника', '5 участников',
      '1 подписчик', '1 стикер', '1 день', '3 дня',
    ])
  })

  it('украинский склоняет 1/2/5/21', async () => {
    await apply('uk')
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
  it('дробное число берёт other, и это не форма many', async () => {
    await apply('ru')
    expect(text('Notifications.Count', [1.5])).toBe('1.5 уведомления')
    await apply('uk')
    expect(text('Notifications.Count', [1.5])).toBe('1.5 сповіщення')
  })

  // У немецкого, испанского и французского форм всего две — и это не «недоперевод»,
  // а правило языка: пятёрка обязана дать ту же форму, что и двойка.
  it('у языков с двумя формами 2 и 5 дают одно и то же', async () => {
    const got: Record<string, string[]> = {}
    for (const code of ['de', 'es', 'fr'] as const) {
      await apply(code)
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
  it('смена языка меняет правило, а не только слова', async () => {
    await apply('ru')
    const before = text('Notifications.Count', [5])
    await apply('de')
    expect(before).toBe('5 уведомлений')
    expect(text('Notifications.Count', [5])).toBe('5 Benachrichtigungen')
  })

  // ПИН НА ВСЕ ФОРМЫ ЧИСЛА, а не на пять из двадцати одной. Ревью сломало русскую
  // форму `VoiceChat.Status.Members.one_value` — весь набор остался зелёным: точечные
  // проверки покрывали `Notifications.Count` и ещё четыре ключа, остальные шестнадцать
  // не смотрел никто.
  //
  // Утверждения выбраны так, чтобы НЕ переписывать словарь в ожидания (это была бы
  // тавтология), но ловить настоящие ошибки перевода:
  //  • число обязано остаться в КАЖДОЙ форме — «Просмотрено» вместо «21 просмотр»
  //    теряет его ровно так (славянский `one` покрывает 21, 31, 101);
  //  • у русского форма единицы обязана отличаться от формы пятёрки — иначе в `one`
  //    скопировали `many` (ровно мутация ревью);
  //  • 21 обязана дать ту же форму, что 1 — это и есть правило языка, а не текст.
  it('у каждого числового ключа русские формы различают 1, 5 и 21', async () => {
    await apply('ru')
    const bad: string[] = []
    for (const string of DICTS.ru) {
      if (string._ !== 'langPackStringPluralized') continue
      const key = string.key as LangPackKey
      // Ключи, у которых объявлена только общая форма, правилу единицы не подчиняются.
      if (!string.one_value) continue
      // Сравниваются ФОРМЫ, а не отрисованный текст: «1 участников» и «5 участников»
      // различаются числом и на скопированной форме — ровно так мутация и выживала.
      const indeclinable = RU_INDECLINABLE.has(key)
      const same = string.one_value === string.many_value || string.one_value === string.few_value
      if (same && !indeclinable) bad.push(`${key}: форма единицы совпала с формой множества («${string.one_value}»)`)
      // Исключение обязано быть живым: как только слово начнёт склоняться, список
      // протух — иначе в него можно вписать что угодно, и правило выше умрёт молча.
      if (!same && indeclinable) bad.push(`${key}: в списке несклоняемых, но формы различаются — исключение протухло`)
      // 21 обязана дать форму ЕДИНИЦЫ — это правило языка, а не текст словаря.
      // `**жирный**` ядро рисует узлом, и в тексте звёздочек не остаётся.
      const expected = string.one_value.replace(PLACEHOLDER, '21').replace(/\*\*/g, '')
      if (text(key, [21]) !== expected) bad.push(`${key}: 21 не даёт форму единицы («${text(key, [21])}» вместо «${expected}»)`)
    }
    expect(bad).toEqual([])
  })

  // ЧИСЛО В КАЖДОЙ ФОРМЕ — отдельная проверка, и её правило берётся у ЯЗЫКА, а не у
  // английского источника. У английского форма единицы это ровно единица, поэтому
  // «Send Photo» без числа там верно; у русского и украинского та же форма покрывает
  // 21, 31, 101 — и «Отправить файл» на 21 файле теряет число насовсем. Первая
  // редакция пина сверялась с источником и потому УЗАКОНИВАЛА этот дефект.
  it('в языке, где форма единицы покрывает 21, число стоит в каждой форме', () => {
    const bad: string[] = []
    for (const code of Object.keys(DICTS) as Code[]) {
      // Языки различаются не списком, а правилом: форма единицы покрывает больше единицы.
      const rules = new Intl.PluralRules(code)
      const oneCoversMore = rules.select(21) === 'one'
      for (const string of DICTS[code]) {
        if (string._ !== 'langPackStringPluralized') continue
        const source = lang[string.key as LangPackKey] as Record<string, string | undefined>
        // Строка вообще про счёт? Спрашиваем у общей формы источника — она есть всегда.
        if (!source?.other_value || !PLACEHOLDER.test(source.other_value)) continue
        for (const [slot, value] of Object.entries(string)) {
          if (!slot.endsWith('_value') || typeof value !== 'string') continue
          if (PLACEHOLDER.test(value)) continue
          // `one` без числа законен только там, где он покрывает ровно единицу.
          if (slot === 'one_value' && !oneCoversMore) continue
          bad.push(`${code} ${string.key}.${slot}: «${value}» — без числа`)
        }
      }
    }
    expect(bad).toEqual([])
  })

  // Каждая форма, объявленная в словаре, обязана ДОЕХАТЬ до текста: недостающая
  // выдаёт себя тем, что ядро показывает сам ключ или чужой язык.
  it('в каждом словаре все формы всех числовых строк дают перевод', async () => {
    const bad: string[] = []
    for (const code of Object.keys(DICTS) as Code[]) {
      await apply(code)
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

// ── НЕПЕРЕВЕДЁННЫЙ КЛЮЧ ЧИТАЕТСЯ ПО-АНГЛИЙСКИ, А НЕ СВОИМ ИМЕНЕМ ────────────────
//
// Это главное правило слияния (`I18n.applyServerLangPack`, порт tweb :237-244), и
// до ревью задачи 9 оно НЕ БЫЛО ЗАПИНЕНО на продуктовом пути: единственная
// целившаяся туда проверка стояла на ключе `Delete`, чьё английское значение
// буквально равно его имени, — «упало на английский» и «вернуло имя ключа» там
// неотличимы. Мутация «снять английский нижний слой» оставляла всю сюиту зелёной.
//
// Отказ, который здесь стережётся, видит пользователь: у украинского, немецкого,
// испанского и французского переведена примерно ПОЛОВИНА словаря, и без нижнего
// слоя вторая половина поехала бы на экран символическими именами
// («PeerInfo.Discussion» вместо «Discussion»).
//
// Проверяются ВСЕ непереведённые ключи каждого языка разом, а не образец, и
// только те, чей английский текст с именем НЕ совпадает: на остальных
// утверждение невыразимо (таких ключей в `lang.ts` шестьдесят один).
describe('нижний английский слой держит непереведённые ключи', () => {
  /** Ключи, у которых «английский текст» отличим от «имени ключа». */
  const EXPRESSIVE = (Object.keys(lang) as LangPackKey[])
    .filter((key) => typeof lang[key] === 'string' && lang[key] !== key)

  /**
   * Эталон считается ИЗ ФАЙЛА `lang.ts`, МИМО применения языка, — и это условие
   * зрячести, а не удобство. Первая редакция брала эталоном выдачу `i18n()` на
   * применённом английском, и проверка ослепла ровно на той мутации, ради которой
   * писалась: снятый нижний слой ломает обе стороны одинаково (и «эталон», и
   * измеряемое становятся именем ключа), сравнение сходится, тест зелёный.
   *
   * Сырое значение эталоном тоже не годится: разметку и плейсхолдеры разбирает
   * `superFormatter` («Do you want to set «%1$s» …» без аргументов даёт «Do you
   * want to set «» …»). Поэтому эталон — то же значение, прогнанное через ТОТ ЖЕ
   * разбор, но взятое из файла, а не из карты строк.
   */
  const flatten = (pieces: ReturnType<typeof I18n.superFormatter>) => pieces
    .map((piece) => (piece instanceof HTMLBRElement ? '\n' : piece instanceof Node ? piece.textContent : String(piece)))
    .join('')
  const english = new Map(EXPRESSIVE.map((key) => [key, flatten(I18n.superFormatter(lang[key] as string))]))

  it('сам набор проверяемых ключей не выродился', () => {
    // Иначе «нарушителей нет» означало бы «проверять было нечего».
    expect(EXPRESSIVE.length).toBeGreaterThan(700)
  })

  for (const code of Object.keys(DICTS) as Code[]) {
    it(`${code}: ключ без перевода показывает английский текст`, async () => {
      await apply(code)
      const translated = new Set(DICTS[code].map((string) => string.key))
      const bad: string[] = []
      for (const key of EXPRESSIVE) {
        if (translated.has(key)) continue
        // Спрашивается СТРОКОВЫЙ режим (`format(key, true)`) — тот самый, которым
        // читает `t()`. Не `i18n(key).textContent`: у узла `<br>` даёт пустоту, а
        // строковый режим — перевод строки, и сверка ломалась бы на пяти
        // многострочных ключах экрана входа, ничего про слой не говоря.
        const got = I18n.format(key, true)
        if (got !== english.get(key)) bad.push(`${code} ${key}: «${got}» вместо «${english.get(key)}»`)
      }
      // Список режется: без нижнего слоя сюда попали бы сотни ключей, и
      // сообщение об ошибке стало бы нечитаемым.
      expect(bad.slice(0, 5)).toEqual([])
      expect(bad.length).toBe(0)
    })
  }
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
    'KeyboardShortcuts.Section.Stories': '«Stories» — то же заимствование, что и у ключа Stories',
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
    'KeyboardShortcuts.Section.Messages': '«Messages» — французское слово',
    'KeyboardShortcuts.Section.Stories': '«Stories» — то же заимствование, что и у ключа Stories',
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

// ── ПОРЯДОК СЛОВ И КАВЫЧКИ ЗАДАЁТ СТРОКА ЯЗЫКА, А НЕ ВЁРСТКА ─────────────────────
//
// Ради этого ключи со склейкой и сводились: пока вызывающий приклеивал имя к префиксу
// («Also delete for» + имя), порядок слов был зашит в КОД и одинаков во всех языках.
// Немецкий ловит это лучше прочих — у него глагол уезжает в конец, то есть верный
// перевод НЕ МОЖЕТ быть префиксом; первая редакция этого перевода была именно
// префиксом («Auch löschen für %1$s»), и поймало её ревью, а не проверка. Теперь —
// проверка.
describe('порядок слов и кавычки живут в строке языка', () => {
  it('немецкий ставит глагол в конец: аргумент ВНУТРИ фразы, а не после неё', async () => {
    await apply('de')
    expect(text('DeleteMessagesOptionAlso', ['Maya'])).toBe('Auch für Maya löschen')
  })

  it('у каждого языка свои кавычки вокруг запроса', async () => {
    await apply('de')
    expect(text('Search.Empty', ['кабачок'])).toBe('Keine Ergebnisse für „кабачок“. Versuche eine neue Suche.')

    await apply('fr')
    // Французская типографика требует УЗКИХ НЕРАЗРЫВНЫХ пробелов внутри гильеметов
    // (U+202F) — обычный пробел здесь такая же ошибка, как его отсутствие.
    expect(text('Search.Empty', ['кабачок'])).toBe('Aucun résultat pour « кабачок ». Essayez une autre recherche.')

    await apply('ru')
    expect(text('Search.Empty', ['кабачок'])).toBe('Ничего не найдено по запросу «кабачок». Попробуйте другой запрос.')
  })
})
