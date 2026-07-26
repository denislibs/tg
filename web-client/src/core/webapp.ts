import { create } from 'zustand'

// Mini-apps (Telegram Web Apps). Кнопка webapp у бота открывает iframe в модалке
// с JS-мостом window.Telegram.WebApp. Мост — обмен postMessage строками
// JSON {eventType, eventData} в обе стороны (1:1 с tweb telegramWebView.ts).
// Реального MTProto нет — URL берётся прямой (из reply_markup.webapp).

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

// Тема для mini-app (Telegram themeParams): значения из CSS-токенов --tg-*.
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
  const accent = v('--tg-accent', '#8774e1')
  return {
    bg_color: v('--tg-appBg', '#ffffff'),
    text_color: v('--tg-textPrimary', '#000000'),
    hint_color: v('--tg-textSecondary', '#999999'),
    link_color: v('--tg-link', accent),
    button_color: accent,
    button_text_color: '#ffffff',
    secondary_bg_color: v('--tg-sidebarBg', '#f0f0f0'),
    header_bg_color: v('--tg-sidebarBg', '#ffffff'),
    accent_text_color: accent,
    section_bg_color: v('--tg-bubble', '#ffffff'),
    destructive_text_color: '#e53935',
  }
}
