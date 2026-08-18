// src/core/dom/attachmentBox.owner.test.ts
//
// Бокс медиа считает ОДНА функция — `setAttachmentSize` (порт tweb
// `helpers/setAttachmentSize.ts`). Второго живого расчёта того же самого быть не
// должно: именно так медиавьювер терял `MIN_SIDE_SIZE` (200) — он вписывал медиа
// собственным вызовом `calcImageInBox`, тогда как вьювер оригинала зовёт общую
// функцию (tweb `mediaViewer/base.ts:2465`) и минимумы получает даром.
//
// Форма — по образцу `core/scrollWriters.test.ts` / `core/noDuplicateMediaUrl.test.ts`:
// читаем исходники текстом (импорт ничего не скажет о том, КЕМ посчитан бокс).
// Появление нового вызова `calcImageInBox` — осознанное решение: разбери его и
// правь список руками, а не подгоняй код под тест.
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

const CALL_RE = /\bcalcImageInBox\s*\(/g

/**
 * Все места, где `calcImageInBox` вызывается (объявление функции тоже даёт
 * совпадение — оно и стоит первым). Путь относительно `src/` → число вхождений.
 */
const ALLOWED: Record<string, number> = {
  // Сам вендорный примитив (порт tweb `helpers/calcImageInBox.ts`) — объявление.
  'core/dom/calcImageInBox.ts': 1,
  // Вендорный `MediaSize.aspect` (порт tweb `helpers/mediaSize.ts`) — ЕДИНСТВЕННАЯ
  // дорога, которой примитив попадает в расчёт бокса: `setAttachmentSize` вписывает
  // медиа через `size.aspect(boxSize, noZoom)` и растягивает `aspectCovered`.
  'helpers/mediaSize.ts': 1,
  // Медиавьювер, `refitMediaToViewport` — НЕ расчёт бокса вложения, а пере-фит уже
  // открытого медиа под изменившийся вьюпорт (ресайз окна). tweb зовёт примитив
  // ровно там же и теми же аргументами (`mediaViewer/base.ts:2215-2235`).
  'components/mediaViewer/base.ts': 1,
  // Даунскейл КАРТИНКИ ПЕРЕД ОТПРАВКОЙ (сжатие исходника до лимита), к боксу бабла
  // отношения не имеет — считает пиксели файла, а не layout.
  'core/media/scaleImageForSend.ts': 1,
}

describe('бокс вложения: единственный расчёт — setAttachmentSize', () => {
  it('прямых вызовов calcImageInBox вне allow-list нет и число их не выросло', () => {
    const actual: Record<string, number> = {}
    for (const file of walk(SRC)) {
      const rel = file.slice(SRC.length + 1).replace(/\\/g, '/')
      const raw = readFileSync(file, 'utf8')
      // комментарии (в т.ч. ссылки на tweb-строки) не должны засчитываться как вызов
      const code = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')
      const count = (code.match(CALL_RE) ?? []).length
      if (count > 0) actual[rel] = count
    }

    expect(actual).toEqual(ALLOWED)
  })

  it('вьювер считает бокс общей функцией (tweb :2465), а не своим фитом', () => {
    const src = readFileSync(join(SRC, 'components/mediaViewer/base.ts'), 'utf8')
    expect(src).toMatch(/setAttachmentSize\(\{/)
  })
})

// Гейт наблюдателя звука — портирован как МЕХАНИЗМ: значение
// (`USE_VIDEO_OBSERVER = false`) совпадает с оригиналом, но флаг
// `willObserveSound` считается и раздаётся ровно так же, как там. Здесь пиним
// форму (значение проверяют поведенческие кейсы `wrappers/video.test.ts` и пара
// `RealMediaBubble.fitted` / `RealMediaBubble.videoObserver`): любой «порт
// намерения» — `canHaveVideoPlayer: doc.type === 'video'`, `isVideoWithPlayer:
// isVideo && ...` — красит этот кейс.
describe('canHaveVideoPlayer: только willObserveSound под USE_VIDEO_OBSERVER', () => {
  const read = (rel: string) => readFileSync(join(SRC, rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')

  it('wrappers/video.ts: флаг поднимается ТОЛЬКО под константой и едет в wrapPhoto', () => {
    const src = read('components/wrappers/video.ts')
    expect(src).toMatch(/export const USE_VIDEO_OBSERVER = false/)
    // единственное присваивание `true` — внутри `if (USE_VIDEO_OBSERVER)`
    expect(src.match(/willObserveSound\s*=\s*true/g)).toHaveLength(1)
    expect(src).toMatch(/if\s*\(USE_VIDEO_OBSERVER\)\s*\{\s*willObserveSound\s*=\s*true/)
    expect(src).toMatch(/canHaveVideoPlayer:\s*willObserveSound/)
    // и в двух других потребителей оригинала (video.ts:217 и :654)
    expect(src).toMatch(/pip:\s*willObserveSound/)
    expect(src).toMatch(/locked:\s*willObserveSound/)
  })

  it('RealMediaBubble: тот же флаг, тот же рубильник', () => {
    const src = read('components/messages/RealMediaBubble.tsx')
    expect(src).toMatch(/const willObserveSound = USE_VIDEO_OBSERVER &&/)
    expect(src).toMatch(/isVideoWithPlayer:\s*willObserveSound/)
  })

  it('никто не выводит флаг плеера из типа медиа', () => {
    for (const file of walk(SRC)) {
      const raw = readFileSync(file, 'utf8')
      const code = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')
      for (const m of code.match(/(canHaveVideoPlayer|isVideoWithPlayer):\s*[^,\n]+/g) ?? []) {
        // допустимо: проброс одноимённого параметра дальше по цепочке врапперов
        expect(m).toMatch(/(willObserveSound|canHaveVideoPlayer)\s*$/)
      }
    }
  })
})
