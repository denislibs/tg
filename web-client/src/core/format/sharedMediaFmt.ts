// Форматтеры строк шаред-медиа (табы Файлы/Ссылки/Музыка/Голосовые) — общие
// для панели информации (UserInfoPanel) и глобального поиска (SearchView).

export const fmtDur = (sec?: number) => sec == null ? '' : `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, '0')}`

export function fmtSize(b?: number): string {
  if (b == null) return ''
  if (b >= 1 << 20) return `${(b / (1 << 20)).toFixed(1)} МБ`
  if (b >= 1 << 10) return `${Math.max(1, Math.round(b / (1 << 10)))} КБ`
  return `${b} Б`
}

// Цвет квадрата-иконки по расширению файла
export const EXT_COLORS: Record<string, string> = {
  pdf: '#e5322e', doc: '#4285f4', docx: '#4285f4', xls: '#00a884', xlsx: '#00a884',
  zip: '#8774e1', rar: '#8774e1', png: '#f2994a', jpg: '#f2994a', jpeg: '#f2994a', mp4: '#642bc6',
}

export const extOf = (name?: string) => (name?.includes('.') ? name.slice(name.lastIndexOf('.') + 1).toLowerCase() : '')
export const firstUrl = (text: string) => text.match(/https?:\/\/[^\s]+/)?.[0] ?? ''
export const hostOf = (url: string) => { try { return new URL(url).hostname } catch { return url } }
