// Stage 1C.2 (Task 3): медиа-токен — воркер единственный владелец
// (core/managers/mediaManager.ts: получение + расписание обновления +
// публикация rt:media_token). core/mediaUrl.ts — зеркало. Два скана-пина,
// по образцу stores/noDuplicateMe.test.ts / core/scrollWriters.test.ts:
//
//  1) у зеркала нет СВОЕГО расписания. Поведенческий пин на это есть
//     (core/mediaUrl.test.ts: «не заводит своего таймера»), но он краснеет
//     только на таймере, который ходит за токеном; вернувшийся таймер,
//     который делает что-то другое (перепубликация, дозвон, инвалидация),
//     он бы пропустил — а это ровно то второе расписание, которое задача
//     убирала;
//  2) присланный владельцем снимок применяет ровно одно место витрины —
//     проектор (client/realtime/storeProjection.ts) плюс сам модуль зеркала
//     (ответ tokenInfo в primeMediaToken). Новый вызов applyMediaToken где-то
//     ещё — второй писатель факта; либо переводи его на проектор, либо
//     осознанно добавляй сюда с обоснованием комментарием ПРЯМО У ВЫЗОВА.
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const SRC = join(__dirname, '..')

function walk(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, acc)
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) acc.push(p)
  }
  return acc
}

const ALLOWED_APPLY = [
  'core/mediaUrl.ts', // сам модуль зеркала: применяет ответ tokenInfo() в primeMediaToken
  'client/realtime/storeProjection.ts', // APPLY[RT.mediaToken] — применяет присланное воркером
]

describe('медиа-токен: расписание и применение — по одному месту', () => {
  it('в core/mediaUrl.ts не осталось собственного расписания', () => {
    const src = readFileSync(join(SRC, 'core/mediaUrl.ts'), 'utf8')
    expect(src).not.toMatch(/\bset(Timeout|Interval)\s*\(/)
    expect(src).not.toMatch(/\brequestIdleCallback\s*\(/)
  })

  it('applyMediaToken(...) зовут только зеркало и проектор', () => {
    const offenders = walk(SRC)
      .map((f) => f.slice(SRC.length + 1).replace(/\\/g, '/'))
      .filter((rel) => !ALLOWED_APPLY.includes(rel))
      .filter((rel) => /\bapplyMediaToken\(/.test(readFileSync(join(SRC, rel), 'utf8')))

    expect(offenders).toEqual([])
  })

  it('allow-list не разбух молча: каждая запись реально зовёт applyMediaToken(...)', () => {
    for (const rel of ALLOWED_APPLY) {
      const src = readFileSync(join(SRC, rel), 'utf8')
      expect(src, `${rel}: ожидался вызов applyMediaToken(...)`).toMatch(/\bapplyMediaToken\(/)
    }
  })
})
