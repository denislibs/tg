/**
 * Кодмод: `t('English string')` → `t('SymbolicKey')`.
 *
 * ── Почему кодмод, а не правка руками ──────────────────────────────────────
 * Вызовов больше тысячи, и переписывать их руками значит гарантированно
 * перепутать десяток. Замена механическая: старый ключ («ключ = английская
 * строка») ищется в `src/i18n/legacyKeyMap.ts` — той самой карте, по которой
 * живёт мост `toLegacyDict`, — и меняется на символический.
 *
 * ── Почему прогон по подсистемам ──────────────────────────────────────────
 * Скрипт принимает пути (каталог или файл) и трогает только их. Один коммит на
 * подсистему — единственный способ прочитать дифф глазами: правильность
 * соответствия «ключ ↔ место» машина не проверяет вовсе (скан-тест ловит только
 * ОСТАВШУЮСЯ английскую строку, но не подставленный не тот ключ).
 *
 * ── Чего скрипт НЕ делает ─────────────────────────────────────────────────
 *  • строку, которой нет в карте, НЕ трогает — печатает списком, разбирается руками;
 *  • литералы, приезжающие в `t()` переменной (`{label: 'Play'}` → `t(it.label)`),
 *    не ищет: отличить такую таблицу от любой другой строки в файле нельзя;
 *  • второй аргумент `t()` не рассматривает — его у `t()` нет.
 *
 * ── Точечные исключения ───────────────────────────────────────────────────
 * `LEGACY_KEY_OVERRIDES` — места, где одна старая строка значит разное («Join»
 * на баннере видеочата и на баннере трансляции). Запись привязана к ВХОЖДЕНИЮ
 * (`occurrence`) и подтверждена ЯКОРЕМ — куском кода рядом. Скрипт проверяет
 * якорь сам и падает, если он уехал: молча подставить ключ не тому месту —
 * ровно та ошибка, ради которой исключения и заведены.
 *
 * Запуск (из web-client):
 *   node scripts/codemod-langpack-keys.mjs src/components/chat        # заменить
 *   node scripts/codemod-langpack-keys.mjs --dry src                  # только отчёт
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

const WEB_CLIENT = resolve(import.meta.dirname, '..')

const { LEGACY_KEY_MAP, LEGACY_KEY_OVERRIDES } = await import(join(WEB_CLIENT, 'src/i18n/legacyKeyMap.ts'))
const lang = (await import(join(WEB_CLIENT, 'src/lang.ts'))).default

/**
 * Вызов `t()` с ЦЕЛИКОМ литеральным аргументом. Первая группа — символ перед `t`:
 * по нему отсеивается `x.t(...)` (чужой метод) и хвост чужого имени.
 */
const CALL = /(.?)\bt\(\s*(['"])((?:\\.|(?!\2)[^\\])*)\2\s*\)/g

/** Литерал исходника → строка, какой она приедет в `t()`. */
function unescape(raw) {
  return raw.replace(/\\(['"\\nt])/g, (_, ch) => ({ n: '\n', t: '\t' })[ch] ?? ch)
}

/** Строка → литерал в одинарных кавычках. Символические ключи без кавычек и переносов,
 *  но экранирование оставлено общим: молчаливая порча литерала дороже трёх замен. */
function quote(value) {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n')}'`
}

/**
 * Подсистема локализации сама вызывающим не является: `src/lang.ts` — источник строк,
 * `src/i18n/*` — карта, мост и словари. Английские строки там ДАННЫЕ, а `t('…')` в
 * докблоках — примеры; замена в них портит и то, и другое.
 */
const NOT_A_CALLER = /^src\/(lang\.ts$|i18n\/)/

function* sourceFiles(path) {
  if (NOT_A_CALLER.test(relative(WEB_CLIENT, path))) return
  const stat = statSync(path)
  if (!stat.isDirectory()) {
    if (/\.tsx?$/.test(path)) yield path
    return
  }
  for (const entry of readdirSync(path).sort()) {
    yield* sourceFiles(join(path, entry))
  }
}

/**
 * Позиции вхождений, которым исключение назначает СВОЙ ключ.
 *
 * Номер вхождения считается ровно так же, как в проверке карты
 * (`legacyKeyMap.test.ts`): по точному тексту `t('<строка>')`. Якорь обязан стоять
 * в том же блоке — после предыдущего вхождения той же строки и не дальше пятнадцати
 * строк над своим; иначе исключение уехало вместе с кодом, и продолжать нельзя.
 */
const ANCHOR_NEAR_LINES = 15
function overridePositions(file, src) {
  const positions = new Map()
  for (const o of LEGACY_KEY_OVERRIDES) {
    if (resolve(WEB_CLIENT, o.file) !== file) continue

    const literal = `t(${quote(o.legacy)})`
    const at = []
    for (let i = src.indexOf(literal); i !== -1; i = src.indexOf(literal, i + 1)) at.push(i)

    // Строки в файле нет вовсе — исключение УЖЕ ПРИМЕНЕНО прошлым прогоном (кодмод
    // идёт по подсистемам и запускается многократно). Тогда здесь делать нечего, а
    // «на месте ли ключ» спрашивает проверка карты, а не скрипт.
    if (!at.length && src.includes(`t(${quote(o.key)})`)) continue

    const here = at[o.occurrence]
    if (here === undefined) {
      throw new Error(`${o.file}: исключению ${o.key} нужен ${literal} №${o.occurrence}, а их всего ${at.length}`)
    }

    const after = o.occurrence > 0 ? at[o.occurrence - 1] : -1
    let anchored = false
    for (let i = src.indexOf(o.anchor); i !== -1; i = src.indexOf(o.anchor, i + 1)) {
      if (i > after && i < here && src.slice(i, here).split('\n').length - 1 <= ANCHOR_NEAR_LINES) anchored = true
    }
    if (!anchored) {
      throw new Error(`${o.file}: якоря «${o.anchor}» нет в блоке вхождения №${o.occurrence} — исключение ${o.key} уехало`)
    }

    positions.set(here, o.key)
  }
  return positions
}

/**
 * ЧУЖОЙ `t` в файле — ФУНКЦИЯ с таким именем, объявленная тут же.
 * `core/serviceMsg.ts` зовёт своим `t('»')` конструктор сегмента пилюли, и к переводу
 * это отношения не имеет. Такие файлы пропускаются целиком: подставить туда
 * символический ключ значит сломать текст.
 *
 * Настоящий переводчик приходит одним из двух способов (`const t = useT()` в React-компоненте,
 * `useI18nStore.getState().t` вне его) — если он в файле есть, файл обрабатывается: локальные
 * `const t = e.target` переводчик не затеняют, потому что как функцию их никто не зовёт.
 */
const OWN_T = /(?:const|let|var)\s+t\s*=\s*(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*(?::[^=]+)?=>|function\s+t\s*\(/
const REAL_T = /\bt\s*=\s*(?:useT\(|useI18nStore\.getState\(|useI18n\b)/

const args = process.argv.slice(2)
const dry = args.includes('--dry')
const targets = args.filter((a) => a !== '--dry')
if (!targets.length) {
  console.error('нужен путь: node scripts/codemod-langpack-keys.mjs [--dry] <файл|каталог>…')
  process.exit(2)
}

const unmapped = new Map()
let replaced = 0
let touched = 0

for (const target of targets) {
  for (const file of sourceFiles(resolve(WEB_CLIENT, target))) {
    const src = readFileSync(file, 'utf8')
    if (!src.includes('t(')) continue
    if (OWN_T.test(src) && !REAL_T.test(src)) {
      if (CALL.test(src)) console.log(`ПРОПУЩЕН (свой \`t\` в файле) — ${relative(WEB_CLIENT, file)}`)
      CALL.lastIndex = 0
      continue
    }

    const overrides = overridePositions(file, src)
    let hits = 0
    // Пары «старая строка → ключ» печатаются в разведке (`--dry`): по ним и решается,
    // какому месту нужно точечное исключение, — ДО того, как строка исчезнет из файла.
    const pairs = []

    const out = src.replace(CALL, (match, before, quoteChar, raw, offset) => {
      if (before === '.') return match // чужой метод `x.t('…')`, не наш переводчик

      const legacy = unescape(raw)
      const key = overrides.get(offset + before.length) ?? LEGACY_KEY_MAP[legacy]
      if (!key) {
        // Символический ключ — это уже переведённый вызов (прогон повторный), а не
        // строка вне карты: разбирать руками там нечего.
        if (legacy in lang) return match
        const line = src.slice(0, offset).split('\n').length
        unmapped.set(legacy, [...(unmapped.get(legacy) ?? []), `${relative(WEB_CLIENT, file)}:${line}`])
        return match
      }

      hits++
      pairs.push(`      ${JSON.stringify(legacy)} → ${key}${overrides.has(offset + before.length) ? ' (исключение)' : ''}`)
      return `${before}t(${quote(key)})`
    })

    if (!hits) continue
    replaced += hits
    touched++
    if (!dry) writeFileSync(file, out)
    console.log(`${dry ? 'нашёл' : 'заменил'} ${String(hits).padStart(3)} — ${relative(WEB_CLIENT, file)}`)
    if (dry) console.log(pairs.join('\n'))
  }
}

console.log(`\nитого ${dry ? 'к замене' : 'заменено'}: ${replaced} в ${touched} файлах`)

if (unmapped.size) {
  console.log(`\nВНЕ КАРТЫ (не тронуто, разбирать руками) — ${unmapped.size}:`)
  for (const [legacy, places] of [...unmapped].sort((a, b) => a[0].localeCompare(b[0]))) {
    console.log(`  ${JSON.stringify(legacy)}\n      ${[...new Set(places)].join('\n      ')}`)
  }
}
