/**
 * ПИН НА ДОСТИЖИМОСТЬ ПОДЭКРАНА НАСТРОЕК.
 *
 * Дыра, ради которой заведён, найдена ЖИВОЙ ПРОВЕРКОЙ на стенде (DoD п.10):
 * `SettingsSubScreen` рисует экран выбора языка отдельной веткой
 * (`if (title === 'Telegram.LanguageViewController') return <LanguageSettings/>`),
 * а `hasSubScreen` про этот заголовок не знала — и `SettingsView` по клику на
 * строку «Язык» не открывал НИЧЕГО. Экран существовал, был покрыт тестами и был
 * недостижим: тесты рендерили `LanguageSettings` напрямую, минуя ворота.
 *
 * Проверка идёт ПО ИСХОДНИКУ, а не по списку в тесте: список пришлось бы
 * дописывать руками ровно там же, где забыли дописать ворота, — то есть он
 * протух бы вместе с ними. Разбирается сам файл: каждая ветка «этот заголовок —
 * отдельный экран» обязана иметь клаузу в `hasSubScreen`.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import type { LangPackKey } from '@/lang'
import { hasSubScreen } from './SettingsSubScreen'

const SOURCE = resolve(process.cwd(), 'src/components/SettingsSubScreen.tsx')

/** Ветка выделенного экрана: `if (title === 'Ключ') return <Компонент …/>`. */
const DEDICATED = /if\s*\(title === '([^']+)'\)\s*return\s*</g

function dedicatedTitles(): string[] {
  const src = readFileSync(SOURCE, 'utf8')
  return [...src.matchAll(DEDICATED)].map((m) => m[1])
}

describe('подэкраны настроек достижимы из корня', () => {
  // Разбор обязан НАХОДИТЬ ветки: неудачная регулярка дала бы пустой список и
  // зелёное «всё достижимо» на любом файле.
  it('разбор исходника нашёл ветки выделенных экранов', () => {
    const titles = dedicatedTitles()
    expect(titles.length).toBeGreaterThanOrEqual(9)
    expect(titles).toContain('Telegram.LanguageViewController')
  })

  it('у каждой ветки выделенного экрана есть клауза в hasSubScreen', () => {
    const unreachable = dedicatedTitles().filter((title) => !hasSubScreen(title as LangPackKey))
    expect(unreachable).toEqual([])
  })
})
