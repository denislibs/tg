/**
 * Порт tweb `src/helpers/random.ts` — В ОБЪЁМЕ ЕДИНСТВЕННОГО ВЫЗЫВАЮЩЕГО:
 * `randomLong()` даёт имя radio-группе во вкладке «Язык»
 * (`sidebarLeft/tabs/language.solid.tsx`, порт `language.tsx:119`). Имя группы —
 * то, чем браузер связывает радиокнопки между собой (`radioField.ts`:
 * `input.name = 'input-radio-' + options.name`), поэтому оно обязано быть
 * уникальным на страницу, а не осмысленным.
 *
 * `randomBytes`/`randomUint32Fast` не перенесены: вызывающих нет, а криптомоду
 * у нас обслуживает своя подсистема (`core/secret/*`).
 *
 * Массивы держатся модулем и переиспользуются — дословно как в оригинале
 * (:3-7): `crypto.getRandomValues` заполняет уже выделенный буфер, и
 * выделять новый на каждый вызов незачем.
 *
 * Хелпер-прослойка `@helpers/array/randomize` оригинала не портирована: она
 * состоит из проверки `crypto && 'getRandomValues' in crypto` и броска
 * `NO_SECURE_RANDOM` — фолбэка на времена, когда API мог отсутствовать. У нас
 * `crypto.getRandomValues` — жёсткое требование среды (на нём стоит вся
 * подсистема секретных чатов), и второй, более мягкий ответ на его отсутствие
 * тут был бы неправдой.
 */
const arrays = {
  8: new Uint8Array(1),
  16: new Uint16Array(1),
  32: new Uint32Array(1),
}

export function nextRandomUint(bits: 8 | 16 | 32) {
  const array = arrays[bits]
  crypto.getRandomValues(array)
  return array[0]
}

export function randomLong() {
  return '' + nextRandomUint(32) + nextRandomUint(32) % 0xFFFFFF
}
