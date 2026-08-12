// Инвариант модели tweb: конфиг читается с диска РОВНО ОДИН раз, батчем, до
// первого рендера (client/boot.ts → loadStateOnce). Любое асинхронное чтение
// персиста из стора/хука/компонента возвращает рваную гидрацию — список чатов
// есть в кадре 0, а папки/черновики приезжают позже, и вёрстка прыгает. Ровно так
// и было до порта State: табы папок появлялись через несколько кадров после списка.
//
// ЧТО ЭТОТ ТЕСТ НЕ ЗАПРЕЩАЕТ: чтение кэша в менеджерах воркера
// (`core/managers/*`). Там это офлайн-фолбэк внутри RPC, который UI и так ждёт
// (`chatsManager` при недоступной сети отдаёт последний известный список,
// `messagesManager` — историю чата, `peersManager` — пиров). Это другой слой и
// другая задача, к порядку первого кадра отношения не имеет.
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

/** Зоны, где чтение персиста означает рваную гидрацию. */
const UI_DIRS = ['stores', 'components', 'core/hooks']

/**
 * Task 5 (персист диалогов переезжает к владельцу): единственный читатель
 * персиста в UI-зоне был `stores/dialogsPersist.ts` (гидрация диалогов на
 * старте с main) — удалён, гидрация теперь целиком в воркере
 * (`dialogsManager.ts`: `loadCache`/`loadState`, см. `client/boot.ts` →
 * `managers.dialogs.fillMirror()`). Allow-list пуст: UI-зона персист не
 * читает вовсе.
 */
const ALLOWED: string[] = []

const SRC = join(__dirname, '..', '..')

function walk(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, acc)
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) acc.push(p)
  }
  return acc
}

describe('персист читается только на старте', () => {
  it('UI-зона не импортирует core/store/persist', () => {
    const offenders = UI_DIRS
      .flatMap((d) => walk(join(SRC, d)))
      // replaceAll недоступен: tsconfig на lib ES2020
      .map((f) => f.slice(SRC.length + 1).replace(/\\/g, '/'))
      .filter((rel) => !ALLOWED.includes(rel))
      .filter((rel) => /from '[^']*core\/store\/persist'|from '\.\.?\/[^']*store\/persist'/.test(
        readFileSync(join(SRC, rel), 'utf8'),
      ))

    expect(offenders).toEqual([])
  })
})
