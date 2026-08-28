// Два пина на сгенерированные типы TL.
//
// 1. Дрейф. `src/layer.d.ts` — производная схемы, а не рукописный файл. Правка
//    руками не ловится ничем: типы разъедутся со схемой, а по схеме на фазе 2
//    будет генерироваться кодек на Go. Тест перегенерирует файл во временный
//    путь и сравнивает — правка руками краснеет.
//
// 2. Висячие ссылки. `layer.d.ts` не содержит импортов вовсе и рассчитывает,
//    что `PeerId`/`Long`/`ApiError`/… объявлены глобально. При
//    `skipLibCheck: true` (он у нас и у tweb) неразрешённое имя НЕ ошибка —
//    поле молча становится нетипизированным. Обычный `npm run typecheck` такое
//    пропускает, поэтому проверяем отдельным прогоном с `skipLibCheck: false`.
//    Именно он и нашёл четыре висячих имени в оригинале.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const scriptsDir = dirname(fileURLToPath(import.meta.url))
const webClientDir = dirname(scriptsDir)

describe('TL: сгенерированные типы', () => {
  it('src/layer.d.ts совпадает с тем, что печатает генератор из схемы', () => {
    const outDir = mkdtempSync(join(tmpdir(), 'layer-gen-'))
    try {
      execFileSync('node', [join(scriptsDir, 'generate_mtproto_types.mjs'), `${outDir}/`], {
        cwd: webClientDir,
        stdio: 'pipe',
      })

      const generated = readFileSync(join(outDir, 'layer.d.ts'), 'utf8')
      const committed = readFileSync(join(webClientDir, 'src/layer.d.ts'), 'utf8')

      expect(generated).toBe(committed)
    } finally {
      rmSync(outDir, { recursive: true, force: true })
    }
  }, 60_000)

  it('в layer.d.ts не осталось имён, которые некому разрешить', () => {
    let out = ''
    let failed = false
    try {
      execFileSync('npx', ['tsc', '-p', join(scriptsDir, 'tsconfig.layer-check.json'), '--noEmit'], {
        cwd: webClientDir,
        stdio: 'pipe',
        encoding: 'utf8',
      })
    } catch (e) {
      failed = true
      out = `${e.stdout ?? ''}${e.stderr ?? ''}`
    }

    expect(failed ? out : '').toBe('')
  }, 120_000)
})
