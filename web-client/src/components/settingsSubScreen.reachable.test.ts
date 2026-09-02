/**
 * ПИН НА ДОСТИЖИМОСТЬ ПОДЭКРАНА НАСТРОЕК.
 *
 * Дыра, ради которой заведён, найдена ЖИВОЙ ПРОВЕРКОЙ на стенде (DoD п.10):
 * `SettingsSubScreen` рисовал экран выбора языка отдельной веткой
 * (`if (title === 'Telegram.LanguageViewController') return <LanguageSettings/>`),
 * а `hasSubScreen` про этот заголовок не знала — и `SettingsView` по клику на
 * строку «Язык» не открывал НИЧЕГО. Экран существовал, был покрыт тестами и был
 * недостижим: тесты рендерили `LanguageSettings` напрямую, минуя ворота.
 *
 * Проверка идёт ПО ИСХОДНИКУ, а не по списку в тесте: список пришлось бы
 * дописывать руками ровно там же, где забыли дописать ворота, — то есть он
 * протух бы вместе с ними.
 *
 * ── Пин расширен вместе с портом «Языка» во вкладку слайдера ───────────────
 * Прежняя редакция стерегла ОДНУ половину пути («ветка рендера есть — ворота
 * есть») и держалась за конкретный ключ языка как за доказательство того, что
 * разбор исходника вообще что-то видит. Порт «Языка» этот ключ забрал (экран
 * стал вкладкой `AppLanguageTab`), и стало видно, что половина была не та:
 * та же дыра ровно так же открывается с ДРУГОЙ стороны — строка в списке
 * настроек, которая не ведёт НИ во что: ни в подэкран, ни во вкладку. Ровно
 * это и случилось бы, если бы порт «Языка» снёс ветку рендера, а строку в
 * `settingsItems` оставил как есть.
 *
 * Поэтому проверок теперь две, и вторая — от СТРОКИ, а не от экрана: каждый
 * ключ `settingsItems` обязан либо иметь подэкран (`hasSubScreen`), либо быть
 * разобран отдельной веткой в самом `SettingsView` (там открывается вкладка
 * слайдера — «Устройства», «Язык»).
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import type { LangPackKey } from '@/lang'
import { hasSubScreen } from './SettingsSubScreen'
import { settingsItems } from './SettingsView'

const SUB_SCREEN_SOURCE = resolve(process.cwd(), 'src/components/SettingsSubScreen.tsx')
const ROOT_SOURCE = resolve(process.cwd(), 'src/components/SettingsView.tsx')

/** Ветка выделенного экрана: `if (title === 'Ключ') return <Компонент …/>`. */
const DEDICATED = /if\s*\(title === '([^']+)'\)\s*return\s*</g

/** Ветка корня, разбирающая строку по её ключу: `it.label === 'Ключ'`. */
const HANDLED_IN_ROOT = /it\.label === '([^']+)'/g

function dedicatedTitles(): string[] {
  const src = readFileSync(SUB_SCREEN_SOURCE, 'utf8')
  return [...src.matchAll(DEDICATED)].map((m) => m[1])
}

function handledInRoot(): Set<string> {
  const src = readFileSync(ROOT_SOURCE, 'utf8')
  return new Set([...src.matchAll(HANDLED_IN_ROOT)].map((m) => m[1]))
}

describe('подэкраны настроек достижимы из корня', () => {
  // Разбор обязан НАХОДИТЬ ветки: неудачная регулярка дала бы пустой список и
  // зелёное «всё достижимо» на любом файле. Ключ здесь не назван намеренно —
  // именно на конкретном ключе пин и протух в прошлый раз; проверяем, что
  // ветки есть и что все они — настоящие ключи словаря.
  it('разбор исходника нашёл ветки выделенных экранов', () => {
    const titles = dedicatedTitles()
    expect(titles.length).toBeGreaterThanOrEqual(8)
    expect(titles.every((title) => hasSubScreen(title as LangPackKey))).toBe(true)
  })

  it('у каждой ветки выделенного экрана есть клауза в hasSubScreen', () => {
    const unreachable = dedicatedTitles().filter((title) => !hasSubScreen(title as LangPackKey))
    expect(unreachable).toEqual([])
  })
})

describe('строки корня настроек ведут хоть куда-то', () => {
  // Симметричная проверка разбора: без неё пустой набор веток корня выглядел
  // бы как «все строки ведут в подэкраны».
  it('разбор корня нашёл ветки, открывающие вкладки слайдера', () => {
    expect(handledInRoot().size).toBeGreaterThanOrEqual(2)
  })

  it('каждая строка списка открывает подэкран или вкладку', () => {
    const handled = handledInRoot()
    const dead = settingsItems
      .map((item) => item.label)
      .filter((label) => !hasSubScreen(label) && !handled.has(label))

    expect(dead).toEqual([])
  })
})
