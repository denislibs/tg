// Порт tweb `appStickersManager.toggleStickerSet` (lib/appManagers/
// appStickersManager.ts:640-665): установка/удаление набора — ОДНО место, и оно
// же объявляет результат событием rootScope ('stickers_installed' /
// 'stickers_deleted', см. каталог в src/lib/rootScope.ts).
//
// Почему через общий модуль, а не по месту клика: витрин наборов у нас три
// (панель пикера, экран «Поиск стикеров», попап набора), и до этого каждая
// правила только своё локальное состояние — добавил набор в попапе, закрыл, а
// строка под ним всё ещё «Add» и в панели набора нет. У tweb такого класса
// расхождения нет именно потому, что тоггл один и он вещает.
import rootScope from '@lib/rootScope'
import type { StickerSet } from '../managers/stickersManager'

interface StickersCommands {
  install(setId: number): Promise<void>
  uninstall(setId: number): Promise<void>
}

/**
 * Ставит/снимает набор и объявляет это всем витринам.
 * @param installed текущее состояние набора (true — установлен, значит снимаем)
 * @returns новое состояние («установлен» после операции)
 */
export async function toggleStickerSet(
  stickers: StickersCommands,
  set: StickerSet,
  installed: boolean,
): Promise<boolean> {
  if (installed) {
    await stickers.uninstall(set.id)
    rootScope.dispatchEvent('stickers_deleted', set)
    return false
  }
  await stickers.install(set.id)
  rootScope.dispatchEvent('stickers_installed', set)
  return true
}
