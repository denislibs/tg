// ПИН НА ПОРЧУ ДАННЫХ: символический ключ не стоит там, где ожидаются ДАННЫЕ.
//
// Кодмод задачи 6 менял литералы по карте «английская строка → ключ», и в режиме
// `--literals` под ту же руку попали строки, которые переводом никогда не были: код
// страны «PM» стал `AutoDownloadPm`, «GB» — `Unit.Gigabytes`, имена глифов
// 'group'/'channel' — ключами каналов, немецкие формы слова «чат» — именами секций,
// бейдж «GIF» — ключом вложения, а название новой группы, УЕЗЖАЮЩЕЕ НА СЕРВЕР, —
// строкой «NewGroup». Ни тайпчек (поля были `string`), ни скан старых ключей, ни
// пин на DOM этого не видели: до экрана такие строки не доезжают вовсе.
//
// Проверка двухчастная:
//  • РАНТАЙМ — по настоящим таблицам (коды стран, склонения подписи папки): переживает
//    переименование файла и ловит порчу любым способом, не только кодмодом;
//  • ИСХОДНИКИ — по ПОЗИЦИЯМ, в которых строка заведомо не перевод (имя глифа, код
//    страны, чип клавиши, бейдж, аргумент вызова менеджера). Список позиций растёт
//    вместе с кодом — это цена того, что «данные» и «подпись» в TS одинаковы на вид.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import lang from '../lang'
import Icons from '../core/tgico-icons'
import { COUNTRIES } from '../components/auth/countries'
import { folderSubtitle } from '../components/folders/labels'

const SRC = resolve(process.cwd(), 'src')
const isKey = (value: string) => value in lang

function* sourceFiles(dir: string): Generator<string> {
  for (const entry of readdirSync(dir).sort()) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) yield* sourceFiles(path)
    else if (/\.tsx?$/.test(path)) yield path
  }
}

/**
 * Позиции, в которых литерал — ДАННЫЕ, а не подпись. Каждая с причиной: почему ключ
 * здесь ломает не текст, а работу.
 */
const DATA_POSITIONS: { why: string; re: RegExp }[] = [
  { why: 'код страны (флаг, автоопределение по коду)', re: /\biso2:\s*(['"])([^'"]+)\1/g },
  { why: 'имя глифа иконки', re: /\bicon:\s*(['"])([^'"]+)\1/g },
  { why: 'имя глифа иконки в разметке', re: /<TgIcon\s+name=(['"])([^'"]+)\1/g },
  { why: 'чип клавиши в таблице горячих клавиш', re: /keys=\{\[(?:[^\]]*?)(['"])([^'"]+)\1(?=[^\]]*\]\})/g },
  { why: 'бейдж на превью видео (печатается как есть)', re: /setTimeText\([^,]+,\s*(['"])([^'"]+)\1/g },
]

/** Литерал внутри вызова перевода — единственная законная позиция ключа. */
const inTranslationCall = (src: string, index: number) =>
  /\bt\(\s*$|\btArgs\(\s*$|\btitle\(\s*$/.test(src.slice(Math.max(0, index - 16), index))

/**
 * Ключи, чей ПЕРЕВОД законно уезжает на сервер данными. Список поимённый, потому что
 * «текст на экране» и «текст в базе» различаются не типом, а ролью: `NewGroup` — это
 * ПУНКТ МЕНЮ («Создать группу» по-русски), и группа без имени называлась им у всех
 * участников. У названия по умолчанию свой ключ, и он один на роль.
 */
const DATA_SAFE_KEYS = new Set(['NewGroup.DefaultTitle', 'NewChannel.DefaultTitle'])

/**
 * АРГУМЕНТЫ вызова менеджера — ровно то, что внутри его скобок. Границы считаются по
 * балансу скобок, а не «строкой» и не «окном из трёх строк»: вызов бывает разбит на
 * строки (`managers.folders` ⏎ `.create({…})`) — тогда однострочный скан его не видит, —
 * а окно, наоборот, затягивает соседний тост, который к серверу отношения не имеет.
 */
function* managerCalls(src: string): Generator<{ region: string; line: number }> {
  for (const match of src.matchAll(/\bmanagers\.[A-Za-z.\s\n]*?\(/g)) {
    const open = match.index + match[0].length - 1
    let depth = 0
    let i = open
    for (; i < src.length; i++) {
      if (src[i] === '(') depth++
      else if (src[i] === ')' && --depth === 0) break
    }
    yield { region: src.slice(open, i + 1), line: src.slice(0, match.index).split('\n').length }
  }
}

describe('данные — не ключи перевода', () => {
  // ── рантайм ──

  it('коды стран остались кодами стран', () => {
    const bad = COUNTRIES.filter((c) => !/^[A-Z]{2}$/.test(c.iso2)).map((c) => `${c.name}: ${c.iso2}`)
    expect(bad).toEqual([])
  })

  it('в списке стран есть те две, что испортил кодмод', () => {
    // Иначе «плохих кодов нет» означало бы «списка нет».
    const iso2 = new Set(COUNTRIES.map((c) => c.iso2))
    expect([iso2.has('PM'), iso2.has('GB')]).toEqual([true, true])
  })

  // Формы слова в подписи папки — ДАННЫЕ таблицы `labels.ts`, а не ключи: их печатают
  // как есть, и ключ там читался бы пользователем («3 FilterChats» у немца).
  it('склонения в подписи папки не стали ключами', () => {
    const bad: string[] = []
    for (const lng of ['ru', 'uk', 'en', 'es', 'de', 'fr']) {
      for (const n of [1, 2, 5]) {
        const text = folderSubtitle({ chats: n, groups: n, channels: n }, lng)
        for (const word of text.split(/[\s,]+/)) if (word && isKey(word)) bad.push(`${lng}/${n}: ${word}`)
      }
    }
    expect(bad).toEqual([])
  })

  // ── исходники ──

  it('в позиции данных не стоит символический ключ', () => {
    const bad: string[] = []
    let checked = 0
    for (const file of sourceFiles(SRC)) {
      const rel = relative(resolve(process.cwd()), file)
      if (/^src\/(lang\.ts|i18n\/)/.test(rel)) continue
      const src = readFileSync(file, 'utf8')
      for (const { why, re } of DATA_POSITIONS) {
        for (const match of src.matchAll(re)) {
          checked++
          const value = match[2]
          if (!isKey(value)) continue
          const line = src.slice(0, match.index).split('\n').length
          bad.push(`${rel}:${line}: ${why} — «${value}»`)
        }
      }
    }
    // Позиции обязаны находиться: пустой обход дал бы зелёное «порчи нет» на любом коде.
    expect(checked).toBeGreaterThan(200)
    expect(bad).toEqual([])
  })

  // Название нового чата уезжает НА СЕРВЕР: там ключ — это не английский текст на
  // экране, а данные, которые увидят все участники и которые уже не переписать.
  it('в аргументы менеджеров не уезжает символический ключ', () => {
    const bad: string[] = []
    for (const file of sourceFiles(SRC)) {
      const rel = relative(resolve(process.cwd()), file)
      if (/^src\/(lang\.ts|i18n\/)/.test(rel) || /\.test\.tsx?$/.test(rel)) continue
      const src = readFileSync(file, 'utf8')
      for (const { region, line } of managerCalls(src)) {
        for (const literal of region.matchAll(/(['"])([^'"]+)\1/g)) {
          if (!isKey(literal[2])) continue
          if (inTranslationCall(region, literal.index)) continue
          bad.push(`${rel}:${line}: «${literal[2]}» уезжает данными`)
        }
      }
    }
    expect(bad).toEqual([])
  })

  // Вторая половина той же болезни: ключ ПЕРЕВЕДЁН (`t(key)`), но переведён НЕ ТОТ —
  // подпись пункта меню вместо названия чата. Тайпчек молчит (тип у обоих `LangPackKey`),
  // пин выше молчит (ключа в аргументе нет — там текст), а группа без имени называется
  // у всех участников «Создать группу». Поэтому список ролей поимённый.
  it('на сервер уезжает перевод только тех ключей, что заведены под данные', () => {
    const bad: string[] = []
    let checked = 0
    for (const file of sourceFiles(SRC)) {
      const rel = relative(resolve(process.cwd()), file)
      if (/^src\/(lang\.ts|i18n\/)/.test(rel) || /\.test\.tsx?$/.test(rel)) continue
      const src = readFileSync(file, 'utf8')
      for (const { region, line } of managerCalls(src)) {
        for (const literal of region.matchAll(/(['"])([^'"]+)\1/g)) {
          if (!inTranslationCall(region, literal.index)) continue
          checked++
          if (DATA_SAFE_KEYS.has(literal[2])) continue
          bad.push(`${rel}:${line}: перевод «${literal[2]}» уезжает на сервер — заведите ключ под роль данных`)
        }
      }
    }
    // Позиции обязаны находиться: без единого вызова проверка зелена на любом коде.
    expect(checked).toBeGreaterThan(0)
    expect(bad).toEqual([])
  })

  // Имя глифа — ключ таблицы иконок. Поля `icon` типизированы `IconName`, и это уже
  // не даст собрать ключ перевода; проверка держит вторую половину — что имена в
  // таблицах живые (переименование глифа в `tgico-icons` их не осиротит).
  it('имена иконок в таблицах папок существуют', () => {
    const names = ['group', 'channel', 'newprivate', 'noncontacts', 'mute', 'readchats']
    const bad = names.filter((name) => !(name in Icons))
    expect(bad).toEqual([])
  })
})
