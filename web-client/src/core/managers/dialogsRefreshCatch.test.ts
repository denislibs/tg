// Fix (финальное ревью, Minor #3): `dialogsManager.refresh()` СОЗНАТЕЛЬНО
// пробрасывает `HttpError` (401/5xx) — офлайн там глотается, а осмысленный ответ
// сервера нет, и `await`-колсайты (Sidebar, редактор контакта, вступление в
// канал) на него рассчитывают. Значит каждый fire-and-forget колсайт (`void
// managers.dialogs.refresh()`) обязан нести свой `.catch` — иначе протухшая
// сессия или 5xx дают unhandled rejection в консоли пользователя.
//
// Пин построчный (web-client/CLAUDE.md, «Тесты»): поведенчески воспроизводить
// unhandled rejection в vitest нельзя — он не роняет тест и в jsdom/happy-dom
// не наблюдаем; зато наблюдаема сама форма вызова, а мутация (снять любой
// `.catch`) краснит этот тест. Промис догона в `client/boot.ts`
// (`applyDialogsMirror`) покрыт поведенчески — `client/boot.dialogs.test.ts`,
// «догон упал (401/5xx) — промис резолвится».
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const SRC = join(__dirname, '..', '..')

function walk(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, acc)
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) acc.push(p)
  }
  return acc
}

describe('managers.dialogs.refresh(): fire-and-forget колсайты не плодят unhandled rejection', () => {
  it('каждый `void ...refresh()` несёт свой .catch', () => {
    const offenders: string[] = []
    for (const file of walk(SRC)) {
      const rel = file.slice(SRC.length + 1).replace(/\\/g, '/')
      readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
        if (!/void\s+managers\.dialogs\.refresh\(/.test(line)) return
        if (!line.includes('.catch(')) offenders.push(`${rel}:${i + 1}`)
      })
    }

    expect(offenders).toEqual([])
  })

  // Страховка от «пин зазеленел, потому что искать стало нечего»: если колсайты
  // переименуют/снесут, тест обязан упасть, а не молча проходить пустым.
  it('такие колсайты в приложении есть (пин не выродился в пустой прогон)', () => {
    const found = walk(SRC).filter((f) => /void\s+managers\.dialogs\.refresh\(/.test(readFileSync(f, 'utf8')))
    expect(found.length).toBeGreaterThan(0)
  })
})
