// userInfo/helpers.ts
// Чистые хелперы и константы панели профиля (UserInfoPanel): склонения счётчиков
// подзаголовков, подпись активного таба в залитой шапке, геометрия шапки/табов и
// парсинг chatId для шаред-медиа.

// склонение «N единиц» (счётчики подзаголовков)
export function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10, m100 = n % 100
  const word = m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? few : many
  return `${n} ${word}`
}

// «N участник(а/ов)» — подзаголовок профиля группы
export function membersLabel(n: number, isChannel: boolean): string {
  if (isChannel) return `${n} подписчиков`
  return plural(n, 'участник', 'участника', 'участников')
}

// «N чат(а/ов)» — подзаголовок «Избранного» (число сохранённых диалогов)
export const chatsLabel = (n: number) => plural(n, 'чат', 'чата', 'чатов')

// подпись счётчика активного таба в залитой шапке (tweb sharedMedia.tsx:
// пары type→LangPackKey — Members/MediaFiles/Files/Links/MusicFiles/Voice)
export function countLabel(tab: string, n: number, isChannel: boolean): string {
  switch (tab) {
    case 'Members': return membersLabel(n, isChannel)
    case 'Chats': return chatsLabel(n)
    case 'Gifts': return plural(n, 'подарок', 'подарка', 'подарков')
    case 'Media': return plural(n, 'медиафайл', 'медиафайла', 'медиафайлов')
    case 'Files': return plural(n, 'файл', 'файла', 'файлов')
    case 'Links': return plural(n, 'ссылка', 'ссылки', 'ссылок')
    case 'Music': return plural(n, 'аудиофайл', 'аудиофайла', 'аудиофайлов')
    case 'Voice': return plural(n, 'голосовое сообщение', 'голосовых сообщения', 'голосовых сообщений')
    default: return String(n)
  }
}

// высота шапки панели — sticky-отступ табов и порог header-filled (tweb 3.5rem)
export const HEADER_H = 56
/** tweb sharedMedia.tsx:481-483 — ADDITIONAL_OFFSET/BODY_PADDING порога header-filled */
export const ADDITIONAL_OFFSET = 16
export const BODY_PADDING = 16
// зазор шапка↔таб-плашка; градиент плашки растягивается вверх на столько же
// (TabsBar gap), чтобы закрыть зазор и контент не просвечивал.
export const TAB_GAP = 8

// id чата из строки диалога (валиден только для «настоящих» числовых чатов).
export function sharedMediaChatId(id: string): number | null {
  const n = Number(id)
  return Number.isFinite(n) && String(n) === id ? n : null
}
