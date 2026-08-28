import { existsSync } from 'node:fs'

/**
 * Где лежит чекаут оригинала. Переопределяется переменной `TWEB_ROOT` —
 * у каждого он может быть в своём месте, зашивать один путь нельзя.
 */
export const TWEB_ROOT = process.env.TWEB_ROOT ?? '/Users/denisurevic/Documents/tweb'

/**
 * Есть ли оригинал под рукой. Без него проверку выполнить нечем, и это НЕ
 * повод падать: чекаут tweb — не зависимость сборки, а рабочий инструмент.
 * Тест в таком случае пропускается с явным сообщением, а не тихо «зеленеет».
 */
export const hasTweb = existsSync(`${TWEB_ROOT}/src/lib/mtproto/tl_utils.ts`)
