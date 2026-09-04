// Пин DoD п.14 программы Solid-миграции (docs/superpowers/specs/2026-08-28-
// solid-migration-design.md § 9): экран входа переехал на Solid ЦЕЛИКОМ —
// React обязан УБЫТЬ, а не удвоиться. Задача 6 волны 3 переключает точку
// монтирования (App.tsx → mountAuthFlow.solid.tsx) и сносит React-версию
// (AuthFlow.tsx и все React-карточки/поля из cards/ и components/auth/).
//
// Скан проверяет РЕЗУЛЬТАТ, а не конкретные имена файлов: любой `.tsx` под
// `components/auth/`, который НЕ подпадает под `isSolidFile` (маска
// `*.solid.tsx`/`*.solid.test.tsx` — тот же паттерн, что кормит
// `solid({include})`/`react({exclude})` в vite.config.ts/vitest.config.ts,
// см. `shared/solid/fileRuntime.ts`), собирается React-плагином — то есть
// React-компонент. Исключений в этой директории НЕТ ни одного: весь экран
// входа (хост, семь карточек, общие поля/кнопки/прелоадер) — Solid.
//
// Тот же приём, что у `shared/solid/boundary.test.ts` (граница рантаймов по
// имени файла) и `stores/noManualOrder.test.ts`/`helpers/schedulers/
// throttle.test.ts` (скан исходников на нежелательный паттерн) — мутация
// обязана краснеть: верни любой React-файл в каталог (например, отмени
// снос `AuthFlow.tsx`) — тест обязан провалиться.
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { isSolidFile } from '../../shared/solid/fileRuntime'

const AUTH_DIR = join(__dirname)

function walkTsx(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walkTsx(p, acc)
    else if (/\.tsx$/.test(name)) acc.push(p)
  }
  return acc
}

describe('components/auth: экран входа — только Solid (DoD п.14)', () => {
  it('в каталоге нет ни одного React-файла (.tsx, не подпадающего под isSolidFile)', () => {
    const offenders = walkTsx(AUTH_DIR)
      .filter((p) => !isSolidFile(p))
      .map((p) => p.slice(AUTH_DIR.length + 1))

    expect(offenders).toEqual([])
  })

  it('скан вообще что-то видит — иначе пустой список ничего не доказывает', () => {
    expect(walkTsx(AUTH_DIR).length).toBeGreaterThan(0)
  })
})

// Второй, содержательный пин: файл, который раньше был точкой монтирования
// React-версии, не существует. Дублирует первый скан (React `.tsx` там уже
// не найти), но фиксирует ИМЕННО этот путь как единственно верный сигнал —
// пропажу самого мостика между App.tsx и Solid-хостом скан выше не ловит
// (он смотрит только на РАСШИРЕНИЕ и рантайм, не на то, есть ли вообще
// точка монтирования).
describe('components/auth: устройство монтирования', () => {
  it('mountAuthFlow.solid.tsx существует и не импортирует React', () => {
    const path = join(AUTH_DIR, 'mountAuthFlow.solid.tsx')
    const code = readFileSync(path, 'utf8')
    expect(/from\s+['"]react(-dom)?['"]/.test(code)).toBe(false)
  })
})
