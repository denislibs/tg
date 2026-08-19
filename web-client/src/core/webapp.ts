import { create } from 'zustand'

// Mini-apps (Telegram Web Apps). Кнопка webapp у бота открывает iframe в модалке
// с JS-мостом window.Telegram.WebApp. Мост — обмен postMessage строками
// JSON {eventType, eventData} в обе стороны (1:1 с tweb telegramWebView.ts).
// Реального MTProto нет — URL берётся прямой (из keyboardButtonWebView.url).

export interface WebAppState {
  open: boolean
  url: string
  botName: string
  botId: number // 0 — mini-app без привязки к боту (CloudStorage/sendData отключены)
  queryId: string // web_app_query_id для answerWebAppQuery (inline-webapp)
}
export const useWebAppStore = create<WebAppState>(() => ({ open: false, url: '', botName: '', botId: 0, queryId: '' }))

export function openWebApp(a: { url: string; botName?: string; botId?: number; queryId?: string }): void {
  useWebAppStore.setState({
    open: true, url: a.url, botName: a.botName ?? 'Web App',
    botId: a.botId ?? 0, queryId: a.queryId ?? '',
  })
}
export function closeWebApp(): void {
  useWebAppStore.setState({ open: false })
}

// Тема для mini-app (Telegram themeParams): значения из tweb-семантических CSS-токенов.
export interface WebAppTheme {
  bg_color: string
  text_color: string
  hint_color: string
  link_color: string
  button_color: string
  button_text_color: string
  secondary_bg_color: string
  header_bg_color: string
  accent_text_color: string
  section_bg_color: string
  destructive_text_color: string
}
export function webAppTheme(): WebAppTheme {
  const cs = getComputedStyle(document.documentElement)
  const v = (name: string, fallback: string) => (cs.getPropertyValue(name).trim() || fallback)
  const accent = v('--primary-color', '#8774e1')
  return {
    bg_color: v('--background-color', '#ffffff'),
    text_color: v('--primary-text-color', '#000000'),
    hint_color: v('--secondary-text-color', '#999999'),
    link_color: v('--link-color', accent),
    button_color: accent,
    button_text_color: '#ffffff',
    secondary_bg_color: v('--surface-color', '#f0f0f0'),
    header_bg_color: v('--surface-color', '#ffffff'),
    accent_text_color: accent,
    section_bg_color: v('--surface-color', '#ffffff'),
    destructive_text_color: '#e53935',
  }
}
