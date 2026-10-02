// Константы менеджеров — порт tweb src/lib/appManagers/constants.ts (в нашем
// объёме; остальные константы того файла — MTProto-специфика без аналога у нас).

// tweb constants.ts:18. Файлы БОЛЬШЕ этого размера не сохраняются в корзину
// CacheStorage (apiFileManager.ts:967: `saveToStorage = done <= MAX_FILE_SAVE_SIZE`)
// — их objectURL живёт только в памяти воркера до конца сессии.
export const MAX_FILE_SAVE_SIZE = 20 * 1024 * 1024

// tweb constants.ts:16. Срок запрета «навсегда» (`chatBannedRights.until_date`):
// так его пишет `ChatPermissions` (`sidebarRight/tabs/groupPermissions/sharedPermissions.ts`),
// когда у прав срока нет. У бэкенда «навсегда» — 0 (`domain/mtchat.go::ChatBannedRights`).
export const BANNED_RIGHTS_UNTIL_FOREVER = 0x7FFFFFFF
