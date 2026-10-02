// Константы тем форума — порт tweb `lib/appManagers/constants.ts:20`, `:27`
// (`TOPIC_COLORS`, `CAN_HIDE_TOPIC`). Своего файла констант менеджеров у нас нет
// (`core/folderIds.ts` — тот же приём для папок), поэтому темам — свой модуль без
// зависимостей.

/** tweb `:20` — цвета значка темы. */
export const TOPIC_COLORS = [0x6FB9F0, 0xFFD67E, 0xCB86DB, 0x8EEE98, 0xFF93B2, 0xFB6F5F]

/** tweb `:27` — скрытие тем выключено: скрытая тема — обычная строка списка. */
export const CAN_HIDE_TOPIC = false
