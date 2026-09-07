// ── ПИН: интерфейсная строка не пишется литералом мимо словаря ───────────────
//
// Третий способ соврать про язык — после `toLocale*` мимо ядра
// (`noBrowserLocaleDates.test.ts`) и ветвления `lang === 'ru'`
// (`noHandPickedLanguage.test.ts`). Самый простой и потому самый живучий:
//
//     if (isBroadcast(chatPeer)) return `${members} подписчиков`
//
// Ветвления здесь нет вовсе, сравнения кода языка нет вовсе — оба соседних пина
// такую строку не видят. А результат тот же и хуже: строка русская ВСЕГДА, при
// любом языке пакета. Именно так выглядел дефект «разнобой языка интерфейса»:
// на браузере с локалью `en-US` подписи опроса шли по-английски (они через
// ядро, `I18n.i18n('Chat.Poll.Type.Anonymous')`), а шапка чата — по-русски
// («0 подписчиков», `Chat.tsx:869`). Язык при этом выбирался ОДИН и правильно
// (`I18n.lastRequestedLangCode`, `lib/langPack.ts:239`) — вторым «источником»
// был сам литерал.
//
// Признак — КИРИЛЛИЦА В СТРОКОВОМ ЛИТЕРАЛЕ. Он не ловит английский литерал (тот
// неотличим от служебного имени: ключа, класса, поля схемы), и это осознанное
// сужение: русский текст в исходнике интерфейсом быть не может ни при каких
// обстоятельствах — английский источник строк живёт в `src/lang.ts`, переводы в
// `src/i18n/dict.*.ts`, и оба этому скану не подлежат.
//
// ── Рэтчет, а не «ноль» ─────────────────────────────────────────────────────
// Долг на момент заведения пина — 268 литералов в 40 файлах (`DEBT` ниже), и
// закрыть его одной правкой нельзя: это ~35 экранов, каждый со своими ключами и
// своей сверкой с оригиналом. Разбор и порядок — в
// `backlogs/frontend/hardcoded-ru-strings.md`.
//
// Поэтому список ТОЧНЫЙ, а не «не больше»: новый литерал краснит пин, и
// закрытый долг тоже краснит — число обязано уехать вниз вместе с правкой.
// Файл, которого в списке нет вовсе, краснеет с первого литерала.
//
// Скан, а не типы: литерал — обычная строка, запретить её системой типов нечем.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

/** Корень исходников — от МЕСТА ЭТОГО ФАЙЛА (как в соседних пинах). */
const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * Кириллица, которая ИНТЕРФЕЙСОМ НЕ ЯВЛЯЕТСЯ: `путь → причина`.
 *
 * Причина обязана объяснять, почему языка приложения этому месту не хватает, —
 * то есть почему строка не показывается пользователю ни на каком языке. «Пока
 * не дошли руки» сюда не пишется: для этого есть `DEBT` с номером в бэклоге.
 */
const NOT_UI: Record<string, string> = {
  'src/lib/richtext/tld.ts': 'список доменов верхнего уровня — ДАННЫЕ («москва», «онлайн», «сайт»), а не текст',
  'src/core/dom/loadFonts.ts': 'глиф-образец для замера готовности шрифта, на экран не попадает',
  'src/core/stickers/testSticker.ts': 'фабрика фикстур для тестов — заголовок набора, а не интерфейс',
  'src/components/emoji/emojiData.ts':
    'ПОИСКОВЫЕ КЛЮЧЕВЫЕ СЛОВА эмодзи (`NAMES`), они не показываются: у tweb они приезжают с сервера '
    + 'per-язык, у нас лежат локально двуязычным списком. Подписи категорий рядом — уже ключи '
    + '(`Emoji.Activity`). Отдельный долг, свой предмет — ручки «ключевые слова по языку» у нас нет',
  // Диагностика для разработчика: текст уходит в `Error`/консоль, а не на экран.
  'src/core/lazyLoadQueue.ts': 'причина отмены задачи очереди — текст `Error` для разработчика',
  'src/core/managers/mediaManager.ts': 'причина отказа воркера — текст `Error` для разработчика',
  'src/core/managers/messagesManager.ts': 'причина отказа воркера — текст `Error` для разработчика',
  'src/core/media/scaleImageForSend.ts': 'предупреждение в консоль при откате к оригиналу',
  'src/core/net/tlFrames.ts': 'причина отказа разбора кадра — текст `Error` для разработчика',
  'src/lib/mtproto/tl_utils.ts': 'причина отказа непортированной ветки — текст `Error`',
  'src/client/bootstrap.ts': 'предупреждение в консоль о невзятом Web Lock',
  'src/components/sidebarLeft/settingsSliderHost.ts': 'причина отказа хоста — текст `Error` для разработчика',
  'src/core/managers/authManager.ts': 'причина отказа неизвестного ответа ручки — текст `Error`',
}

/**
 * ДОЛГ: `путь → сколько литералов там сейчас`. Разбор — в
 * `backlogs/frontend/hardcoded-ru-strings.md`.
 *
 * Число ТОЧНОЕ в обе стороны: и новый литерал, и починенный обязаны быть
 * замечены. Список сдаётся пустым — это и будет «интерфейс говорит на одном
 * языке».
 */
const DEBT: Record<string, number> = {
  'src/client/realtime/storeProjection.ts': 1,
  'src/components/AddContactView.tsx': 3,
  'src/components/AddStorySheet.tsx': 13,
  'src/components/CodeBlock.tsx': 2,
  'src/components/Composer.tsx': 2,
  'src/components/EditContactView.tsx': 10,
  'src/components/EditStorySheet.tsx': 5,
  'src/components/GroupCallScreen.tsx': 1,
  'src/components/LocationPicker.tsx': 6,
  'src/components/MainMenu.tsx': 1,
  'src/components/MarkupTooltip.tsx': 9,
  'src/components/NewContactPopup.tsx': 7,
  'src/components/NewGroupFlow.tsx': 1,
  'src/components/RepostStorySheet.tsx': 2,
  'src/components/SidebarMenuButton.tsx': 1,
  'src/components/StoriesRow.tsx': 3,
  'src/components/StoryViewer.tsx': 4,
  'src/components/auth/cards/SignUpCard.solid.tsx': 1,
  'src/components/composer/helpers.ts': 12,
  'src/components/folders/labels.ts': 20,
  'src/components/group/GroupEditFlow.tsx': 3,
  'src/components/mediaViewer/collectLightboxItems.ts': 1,
  'src/components/messages/ChatDialogs.tsx': 1,
  'src/components/messages/SendMediaPopup.tsx': 3,
  'src/components/peerProfile.solid.tsx': 3,
  'src/components/settings/BirthdayModal.tsx': 6,
  'src/components/settings/EditProfile.tsx': 1,
  'src/components/stickers/StickerSetModal.tsx': 7,
  'src/components/userInfo/helpers.ts': 25,
  'src/core/dialogToChat.ts': 1,
  'src/core/format/sharedMediaFmt.ts': 3,
  'src/core/hooks/useDeepLinks.ts': 5,
  'src/core/hooks/useGroupEdit.ts': 4,
  'src/core/hooks/useGroupInfo.ts': 11,
  'src/core/hooks/useSidebarStories.tsx': 1,
  'src/core/hooks/useStoryViewer.ts': 3,
  'src/core/hooks/useTypingLabel.ts': 32,
  'src/core/messageToConvMsg.ts': 13,
  'src/core/peers/getPeerTitle.ts': 5,
  'src/core/serviceMsg.ts': 36,
}

const CYRILLIC = /[Ѐ-ӿ]/

/**
 * Строковые литералы файла — РАЗБОРОМ, а не регуляркой.
 *
 * Регулярка здесь не годится, и это проверено на живом дефекте: соседний пин
 * снимает комментарии двумя `replace`, и на `Chat.tsx` этого хватило, чтобы
 * ЗАБЕЛИТЬ настоящий код — `/*` внутри однострочного комментария открывает
 * фальшивый блок до ближайшего закрытия. Скан молчал ровно про ту строку, ради
 * которой пин и заводится.
 *
 * Разбор минимальный, но честный: комментарии обоих видов, регэксп-литералы (у
 * них своё экранирование и свой класс символов) и подстановки в шаблонных
 * строках — не текст.
 */
export function stringLiterals(source: string): { line: number, text: string }[] {
  const out: { line: number, text: string }[] = []
  const n = source.length
  let i = 0
  let line = 1
  // Последний значимый символ: по нему `/` отличается — делитель или регэксп.
  let prev = ''

  while (i < n) {
    const c = source[i]

    if (c === '\n') { line++; i++; continue }

    if (c === '/' && source[i + 1] === '/') {
      while (i < n && source[i] !== '\n') i++
      continue
    }

    if (c === '/' && source[i + 1] === '*') {
      i += 2
      while (i < n && !(source[i] === '*' && source[i + 1] === '/')) {
        if (source[i] === '\n') line++
        i++
      }
      i += 2
      continue
    }

    if (c === '/' && /[(,=:[!&|?{};+\-*%~^<>]/.test(prev)) {
      i++
      let inClass = false
      while (i < n) {
        const d = source[i]
        if (d === '\\') { i += 2; continue }
        if (d === '[') inClass = true
        else if (d === ']') inClass = false
        else if (d === '/' && !inClass) { i++; break }
        else if (d === '\n') break
        i++
      }
      while (i < n && /[a-z]/.test(source[i])) i++
      prev = '/'
      continue
    }

    if (c === '"' || c === "'") {
      const startLine = line
      let text = ''
      i++
      while (i < n && source[i] !== c) {
        if (source[i] === '\\') { text += source[i + 1] ?? ''; i += 2; continue }
        if (source[i] === '\n') break
        text += source[i++]
      }
      i++
      out.push({ line: startLine, text })
      prev = c
      continue
    }

    if (c === '`') {
      const startLine = line
      let text = ''
      i++
      // Глубина вложенности `${…}`: подстановка — КОД, а не текст.
      let depth = 0
      while (i < n) {
        const d = source[i]
        if (d === '\\') { text += source[i + 1] ?? ''; i += 2; continue }
        if (d === '\n') { line++; text += d; i++; continue }
        if (depth === 0 && d === '`') { i++; break }
        if (d === '$' && source[i + 1] === '{') { depth++; i += 2; continue }
        if (depth > 0) {
          if (d === '{') depth++
          else if (d === '}') depth--
          i++
          continue
        }
        text += d
        i++
      }
      out.push({ line: startLine, text })
      prev = '`'
      continue
    }

    if (!/\s/.test(c)) prev = c
    i++
  }

  return out
}

/** Находки одного файла — как строки `путь:строка: текст`. */
export function cyrillicLiterals(source: string, rel: string): string[] {
  return stringLiterals(source)
    .filter((hit) => CYRILLIC.test(hit.text))
    .map((hit) => `${rel}:${hit.line}: ${JSON.stringify(hit.text).slice(0, 90)}`)
}

function* sourceFiles(dir: string): Generator<string> {
  for (const entry of readdirSync(dir).sort()) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) yield* sourceFiles(path)
    else if (/\.tsx?$/.test(path)) yield path
  }
}

function scan() {
  const hits: string[] = []
  const counts: Record<string, number> = {}
  let files = 0
  for (const file of sourceFiles(SRC)) {
    const rel = relative(resolve(SRC, '..'), file)
    // Тесты — не интерфейс: фикстуры и ожидания пишутся по-русски законно.
    if (/\.test\.tsx?$/.test(rel)) continue
    // Сами исходники строк: английский источник и переводы под ним.
    if (rel === 'src/lang.ts' || rel.startsWith('src/i18n/dict.')) continue
    // Оснастка прогона (`src/test/lang.ts` подаёт словари тестам).
    if (rel.startsWith('src/test/')) continue
    if (rel in NOT_UI) continue
    files++
    const found = cyrillicLiterals(readFileSync(file, 'utf8'), rel)
    if (found.length) counts[rel] = found.length
    if (!(rel in DEBT)) hits.push(...found)
  }
  return { hits, counts, files }
}

describe('интерфейсная строка приходит из словаря, а не из литерала', () => {
  it('скан вообще дошёл до исходников', () => {
    expect(scan().files).toBeGreaterThan(500)
  })

  it('ни один модуль вне списка долга не пишет русский текст литералом', () => {
    expect(scan().hits).toEqual([])
  })

  it('долг не вырос и не «рассосался» молча: числа сходятся точно', () => {
    // Точное равенство в обе стороны: новый литерал краснит, и починенный тоже
    // — иначе список пережил бы починку и стерёг бы пустоту.
    const { counts } = scan()
    const debtOnly = Object.fromEntries(Object.entries(counts).filter(([rel]) => rel in DEBT))
    expect(debtOnly).toEqual(DEBT)
  })

  it('исключения не мёртвые: в каждом файле NOT_UI и правда есть кириллица', () => {
    for (const rel of Object.keys(NOT_UI)) {
      const found = cyrillicLiterals(readFileSync(resolve(SRC, '..', rel), 'utf8'), rel)
      expect(found.length, rel).toBeGreaterThan(0)
    }
  })

  it('шапка чата больше не пишет подпись литералом', () => {
    // Именно тот файл и тот дефект, ради которого пин заведён.
    const rel = 'src/components/Chat.tsx'
    expect(cyrillicLiterals(readFileSync(resolve(SRC, '..', rel), 'utf8'), rel)).toEqual([])
  })
})

describe('разбор литералов', () => {
  it('комментарии не считаются — и блочный внутри однострочного тоже', () => {
    // Ровно та форма, на которой регулярочный скан соседнего пина забеливал
    // настоящий код: `/*` внутри `//`-комментария открывал фальшивый блок.
    const source = [
      '// в комментарии: /* «подписчиков» */',
      'const a = 1',
      "const b = 'подписчиков'",
    ].join('\n')

    expect(cyrillicLiterals(source, 'x.ts')).toEqual(['x.ts:3: "подписчиков"'])
  })

  it('подстановка шаблонной строки — код, а не текст', () => {
    const source = 'const s = `${members} подписчиков`'
    expect(cyrillicLiterals(source, 'x.ts')).toEqual(['x.ts:1: " подписчиков"'])
  })

  it('регэксп-литерал не считается строкой', () => {
    const source = 'const re = /[а-я]+/g\nconst s = "ок"'
    expect(cyrillicLiterals(source, 'x.ts')).toEqual(['x.ts:2: "ок"'])
  })

  it('номер строки указывает на строку ФАЙЛА', () => {
    const source = ['/**', ' * докблок', ' */', '', "const s = 'привет'"].join('\n')
    expect(cyrillicLiterals(source, 'x.ts')).toEqual(["x.ts:5: \"привет\""])
  })
})
