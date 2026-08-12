// Task 6 (медиа-суперпорт, стадия C): URL медиа — воркер единственный владелец
// (core/managers/mediaManager.ts::downloadMediaURL: скачивание, корзина
// cachedFiles, минт objectURL, публикация rt:media_url). core/mediaCache.ts —
// зеркало. Скан-пин по образцу core/noDuplicateMediaToken.test.ts:
//
//  1) присланный владельцем URL применяет ровно одно место витрины — проектор
//     (client/realtime/storeProjection.ts). Новый вызов applyMediaUrl где-то ещё —
//     второй писатель факта; либо переводи его на проектор, либо осознанно
//     добавляй сюда с обоснованием комментарием ПРЯМО У ВЫЗОВА;
//  2) сброс зеркала (resetMediaUrlMirror) — тоже только проектор, на кадр
//     rt:logging_out: реакция на объявленное намерение, не своя эвристика.
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

const ALLOWED = [
  'core/mediaCache.ts', // сам модуль зеркала: определения applyMediaUrl/resetMediaUrlMirror
  'client/realtime/storeProjection.ts', // APPLY[RT.mediaUrl] + сброс на rt:logging_out
  // Task 7: ответ RPC downloadMediaURL на объявленный ЭТИМ ЖЕ хуком пробел.
  // Не второй вывод факта — тот же снимок владельца, доставленный вторым каналом:
  // URL, уже имевшийся у воркера, кадром не объявляется (rt:media_url публикуется
  // только при СОЗДАНИИ URL, а SuperMessagePort не буферизует — поздняя вкладка
  // стартовый бродкаст пропустила), поэтому применить его обязан получатель
  // ответа (норма «владелец отвечает на объявленный пробел всегда»).
  'core/hooks/useMediaUrl.ts',
]

function offendersOf(call: RegExp): string[] {
  return walk(SRC)
    .map((f) => f.slice(SRC.length + 1).replace(/\\/g, '/'))
    .filter((rel) => !ALLOWED.includes(rel))
    .filter((rel) => call.test(readFileSync(join(SRC, rel), 'utf8')))
}

describe('URL медиа: применение и сброс зеркала — по одному месту', () => {
  it('applyMediaUrl(...) зовут только зеркало и проектор', () => {
    expect(offendersOf(/\bapplyMediaUrl\(/)).toEqual([])
  })

  it('resetMediaUrlMirror(...) зовут только зеркало и проектор', () => {
    expect(offendersOf(/\bresetMediaUrlMirror\(/)).toEqual([])
  })

  it('allow-list не разбух молча: каждая запись реально касается зеркала', () => {
    for (const rel of ALLOWED) {
      const src = readFileSync(join(SRC, rel), 'utf8')
      expect(src, `${rel}: ожидался вызов applyMediaUrl(...)`).toMatch(/\bapplyMediaUrl\(/)
    }
  })
})
