// Пин синхронизации шрифта tgico с tweb (волна 2A, tweb 2197fee9c → HEAD 812502980).
//
// Карта `tgico-icons.ts`, SCSS-переменные `styles/tgico/_variables.scss` и сами
// файлы шрифта `public/fonts/tgico.*` обязаны быть из ОДНОЙ выгрузки icomoon:
// коды перегенерируются целиком, и старое имя на новом шрифте встаёт чужим
// глифом или пустым квадратом (B26: `quote` был `ea43`, стал `ea05`).
//
// Имя иконки типизировано (`IconName`) почти везде, но не везде: пункты
// `ButtonMenu` (`icon: 'name cls'`), `ButtonIcon('name cls')` и приведения
// `as IconName` тайпчек не видит. Поэтому здесь ещё и скан исходников.
import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import Icons from './tgico-icons'

const SRC = join(__dirname, '..')
const ROOT = join(SRC, '..')

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else out.push(p)
  }
  return out
}

const files = walk(SRC)
const codeFiles = files.filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f)
  && !f.endsWith('tgico-icons.ts') && !/lib\/mtproto\/schema\.ts$|layer\.d\.ts$/.test(f))
const scssFiles = files.filter((f) => f.endsWith('.scss') && !f.endsWith('tgico/_variables.scss'))

const lineOf = (text: string, index: number) => text.slice(0, index).split('\n').length

/** Имена иконок из исходников: `[файл:строка, имя]`. */
function collectUsedIconNames(): [string, string][] {
  const found: [string, string][] = []
  const push = (file: string, text: string, index: number, name: string) =>
    found.push([`${relative(SRC, file)}:${lineOf(text, index)}`, name])

  for (const file of codeFiles) {
    const text = readFileSync(file, 'utf8')
    // `<TgIcon ... name="x">` / `name={cond ? 'x' : 'y'}` — все литералы в значении атрибута.
    for (const m of text.matchAll(/<TgIcon\b([^>]*?)\/?>/gs)) {
      const attr = /\bname=(\{[^}]*\}|"[^"]*")/s.exec(m[1])
      if (!attr) continue
      for (const lit of attr[1].matchAll(/['"`]([a-z0-9_]+)['"`]/g)) push(file, text, m.index!, lit[1])
    }
    // Пропы и поля: `icon: 'x'`, `icon="x"`, `activeIcon`, `addIcon`, `iconName`
    // (`ButtonMenu` кладёт классы через пробел — берём первое слово).
    for (const m of text.matchAll(/\b(?:icon|activeIcon|addIcon|iconName)\s*[:=]\s*\{?\s*['"`]([a-z0-9_]+)[ '"`]/g)) {
      push(file, text, m.index!, m[1])
    }
    // Вызовы, строящие глиф по имени.
    for (const m of text.matchAll(/\b(?:ButtonIcon|Icon|glyph|getIconContent|replaceButtonIcon)\(\s*['"`]([a-z0-9_]+)[ '"`]/g)) {
      push(file, text, m.index!, m[1])
    }
  }

  for (const file of scssFiles) {
    const text = readFileSync(file, 'utf8')
    for (const m of text.matchAll(/\$tgico-([a-z0-9_]+)/g)) {
      if (m[1] === 'font' || m[1].startsWith('font-')) continue
      push(file, text, m.index!, m[1])
    }
  }
  return found
}

describe('tgico: шрифт, карта и SCSS — одна выгрузка tweb', () => {
  it('каждое имя иконки, которое встречается в коде и стилях, есть в карте', () => {
    const used = collectUsedIconNames()
    // Скан не пустой — иначе тест молча ничего не проверяет.
    expect(used.length).toBeGreaterThan(200)
    const missing = used.filter(([, name]) => !(name in Icons)).map(([at, name]) => `${at} → ${name}`)
    expect(missing).toEqual([])
  })

  it('коды ключевых глифов совпадают с tweb 812502980 (src/icons.ts)', () => {
    expect(Icons).toMatchObject({
      check: 'e900',
      quote: 'ea05',
      quote_filled: 'eb10',
      blockquote: 'eb7e',
      bell_filled: 'ea84',
      data_filled: 'eb07',
      key_filled: 'eab5',
      mention_filled: 'eac1',
      info_filled: 'eb6a',
      devices_filled: 'eb12',
      add_chat_filled: 'eb18',
      person_filled: 'eb38',
      android_filled: 'ea6e',
      apple_filled: 'ea70',
    })
    expect(Object.keys(Icons)).toHaveLength(641)
  })

  it('имена, переименованные tweb 2197fee9c, из карты ушли', () => {
    for (const gone of ['add_chat', 'person', 'quote_outline', 'binfilled', 'play', 'pause', 'send',
      'sendingerror', 'saved', 'statistics', 'eye1', 'eye2', 'timer', 'boost', 'channelviews']) {
      expect(Icons, gone).not.toHaveProperty(gone)
    }
  })

  it('SCSS-переменные $tgico-* дают те же коды, что и TS-карта', () => {
    const scss = readFileSync(join(SRC, 'styles/tgico/_variables.scss'), 'utf8')
    const vars = Object.fromEntries(
      [...scss.matchAll(/^\$tgico-([a-z0-9_]+): "\\([0-9a-f]+)";$/gm)].map((m) => [m[1], m[2]]),
    )
    expect(vars).toEqual(Icons)
  })

  it('файлы шрифта — байт в байт из tweb 812502980 (public/assets/fonts)', () => {
    const sha = (p: string) => createHash('sha256').update(readFileSync(join(ROOT, p))).digest('hex')
    expect(sha('public/fonts/tgico.woff')).toBe('10843a1d5091aedd65211cfe6bc8ee5432adfad07b2d32bc0498ed487ac7f3fb')
    expect(sha('public/fonts/tgico.ttf')).toBe('51ff925f83202c28762b4e0f8dfcc0e45397a0136be7212f59eb5085c9a9b4ff')
  })

  it('URL шрифта несёт штамп выгрузки — иначе SW отдаст старый файл из кэша', () => {
    const indexScss = readFileSync(join(SRC, 'styles/index.scss'), 'utf8')
    expect(indexScss).toContain("url('/fonts/tgico.woff?xgs33f')")
    expect(indexScss).toContain("url('/fonts/tgico.ttf?xgs33f')")
  })
})
