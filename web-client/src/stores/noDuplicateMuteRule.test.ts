// Правило «чат заглушён» (свой mute диалога ИЛИ глобально выключенный ТИП
// чатов, порт tweb `isPeerLocalMuted` с `respectType`) записано РОВНО В ОДНОМ
// месте — `stores/notifyStore.ts::isDialogMuted`.
//
// Почему это пин, а не стиль. Правило читают три несвязанных потребителя:
// витрина списка (`core/hooks/useChatList.ts` — серая иконка и бейдж), фильтр
// папок (`core/hooks/useDialogListSource.ts` — правило `excludeMuted`) и
// foreground-уведомления (`client/uiNotifications.ts` — гейт звука и
// Notification). Ровно на этом выражении уже расходились СПИСОК папки и СЧЁТЧИК
// её набора: витрина считала чат заглушённого типа приглушённым, а счётчик (по
// `Dialog`) — нет, фетчер счёл нужное количество набранным, и папка с
// `excludeMuted` переставала наполняться вовсе. Дефект был не виден ни одному
// тесту, потому что копии выражения СОВПАДАЛИ — этот пин ловит не расхождение
// (его уже поздно ловить), а саму возможность завести вторую копию.
//
// Копия узнаётся по паре признаков: файл берёт настройки ПО ТИПУ ЧАТА
// (`notifyTypeForChat`) и читает у них `.muted`. Экран настроек уведомлений
// (`components/settings/NotificationsSettings.tsx`) читает `settings[key].muted`
// напрямую и правило не выводит — под пин не попадает и попадать не должен.
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const SRC_ROOT = join(__dirname, '..')
const HOME = 'stores/notifyStore.ts'

function walk(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, acc)
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) acc.push(p)
  }
  return acc
}

// Комментарии выкидываем: в них правило объясняется прозой (докблок
// `isDialogMuted`, комментарии у колсайтов) — иначе пин ловил бы собственную
// документацию, а не код.
const stripComments = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')

/** Файл выводит правило: берёт настройки по типу чата И читает у них `.muted`. */
function derivesMuteRule(src: string): boolean {
  const code = stripComments(src)
  return /\bnotifyTypeForChat\s*\(/.test(code) && /\.muted\b/.test(code)
}

describe('«заглушён» — одно правило на всё приложение', () => {
  it('выражение правила есть ровно в одном файле — stores/notifyStore.ts', () => {
    const offenders = walk(SRC_ROOT)
      .map((f) => f.slice(SRC_ROOT.length + 1).replace(/\\/g, '/'))
      .filter((rel) => rel !== HOME)
      .filter((rel) => derivesMuteRule(readFileSync(join(SRC_ROOT, rel), 'utf8')))

    expect(offenders).toEqual([])
  })

  // Анти-протухание: если правило переедет или потеряется, верхняя проверка
  // останется зелёной на пустом месте.
  it('сам дом правила его и содержит', () => {
    expect(derivesMuteRule(readFileSync(join(SRC_ROOT, HOME), 'utf8'))).toBe(true)
  })
})
