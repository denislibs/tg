// Цвета пиров — порт tweb `lib/appManagers/utils/peers/getPeerColorById.ts:5-12`.
// Палитра и правило выбора 1:1: индекс = abs(peerId) % 7, а НЕ хеш имени (наш
// прежний вариант давал другие цвета, чем оригинал, у одних и тех же чатов).
// Имя — только фолбэк там, где id ещё не известен (черновики, поиск).
export const PEER_COLORS = ['#CC5049', '#D67722', '#955CDB', '#40A920', '#309EBA', '#368AD1', '#C7508B']

/** tweb getPeerColorIndexById: abs(peerId) % 7. */
export function peerColorIndex(peerId: number): number {
  return Math.abs(peerId) % PEER_COLORS.length
}

/** Цвет пира по id (основной путь — как в tweb). */
export function peerColorById(peerId: number): string {
  return PEER_COLORS[peerColorIndex(peerId)]
}

// ── Цвет аватарки: ИМЯ, а не hex ────────────────────────────────────────────
// Аватарка в tweb цвет инлайном не ставит вовсе: узел получает
// `data-color="red|orange|…"` (avatarNew.tsx:1076), а сам градиент собирает CSS
// из токенов `--peer-avatar-{color}-{top,bottom}` (`_avatar.scss:18-66`, у нас
// портирован). Поэтому здесь нужен ТОТ ЖЕ индекс, что и выше, но выраженный
// именем — второго правила выбора не заводим.

/** Порт `DialogColors` (`getPeerColorById.ts:6`) — порядок значим, это и есть
 *  соответствие «индекс → имя». */
export const PEER_COLOR_NAMES = ['red', 'orange', 'violet', 'green', 'cyan', 'blue', 'pink'] as const
export type PeerColorName = typeof PEER_COLOR_NAMES[number]

/**
 * Порт `getPeerAvatarColorByPeer` (`getPeerColorById.ts:14-42`) в применимом
 * объёме: `undefined` там, где оригинал возвращает `undefined` (карточки пира
 * нет — `getPeerColorIndexByPeer` отдаёт -1, :44), иначе имя по индексу.
 *
 * Не портирована ветка кастомной палитры (`peer.color`, `DialogColorsFg`,
 * пересчёт по hue): поля `color` в нашей карточке пира нет вовсе
 * (`core/peers/peer.ts:193-221`), значит `getPeerColorIndexByPeer` сводится к
 * `getPeerColorIndexById(peer.id)` — это `peerColorIndex` выше.
 */
export function peerAvatarColorByPeer(peerId: number, peerExists: boolean): PeerColorName | undefined {
  return peerExists ? PEER_COLOR_NAMES[peerColorIndex(peerId)] : undefined
}

/** Фолбэк по имени: id недоступен (черновик/строка поиска) — детерминированный хеш. */
export function peerColor(name: string): string {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0
  return PEER_COLORS[h % PEER_COLORS.length]
}

/** '#CC5049' → '204, 80, 73' — для --peer-color-rgb на бабле (tweb ставит его инлайном). */
export function hexToRgbTriplet(hex: string): string {
  const h = hex.replace('#', '')
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16)
  return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`
}
