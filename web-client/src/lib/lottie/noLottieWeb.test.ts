// Один движок lottie (план docs/superpowers/plans/2026-09-05-lottie-single-
// engine.md, Этап 4 «снос пакета»): `lottie-web` снесён из зависимостей и из
// `components/lottie.ts` (последнего потребителя). Единственный движок —
// вендоренный из tweb tlottie (`lib/lottie/lottieLoader.ts` +
// `lottiePlayer.ts`, воркерный SIMD-декод).
//
// Пакета больше нет физически (удалён из `package.json` и `node_modules`),
// поэтому обычный импорт `import 'lottie-web'` в исходнике не соберётся вовсе
// (`vite build`/`tsc` упадут первыми) — но тайпчек и сборка не гоняются на
// каждый чих, а этот скан гоняется. Он же ловит и `vi.mock('lottie-web', ...)`,
// который под отсутствующий пакет либо падает, либо тихо превращается в
// виртуальный мок несуществующей зависимости — оба исхода нежелательны, разбор
// в `test/setup.ts` (история снятого мока) и в отчёте Этапа 4.
//
// Приём — тот же скан текста, что у `helpers/schedulers/throttle.test.ts` и
// `shared/solid/boundary.test.ts`: ищем строковый литерал имени пакета в любом
// импорте/require/vi.mock по всему `src/`, кроме самого этого файла (в его
// собственном исходнике имя пакета неизбежно встречается текстом — и в
// комментариях, и в тексте регэкспа).
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC = join(__dirname, '..', '..')
const SELF = __filename

function walk(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, acc)
    else if (/\.tsx?$/.test(name) && p !== SELF) acc.push(p)
  }
  return acc
}

const PACKAGE_NAME = 'lottie-web'
// Ловит именно строковый литерал модуля: `from 'PACKAGE_NAME'`,
// `require('PACKAGE_NAME')`, `vi.mock('PACKAGE_NAME', ...)`, `import('PACKAGE_NAME')`.
const LOTTIE_WEB_RE = new RegExp(`['"]${PACKAGE_NAME}['"]`)

describe('lottie-web: пакет снесён, второй движок не возвращается', () => {
  it('ни один файл src/ не ссылается на lottie-web', () => {
    const offenders = walk(SRC)
      .filter((p) => LOTTIE_WEB_RE.test(readFileSync(p, 'utf8')))
      .map((p) => p.slice(SRC.length + 1))

    expect(offenders).toEqual([])
  })

  it('lottie-web больше не входит в зависимости package.json', () => {
    const pkg = JSON.parse(readFileSync(join(SRC, '..', 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>
      devDependencies?: Record<string, string>
    }
    expect(pkg.dependencies?.['lottie-web']).toBeUndefined()
    expect(pkg.devDependencies?.['lottie-web']).toBeUndefined()
  })
})
