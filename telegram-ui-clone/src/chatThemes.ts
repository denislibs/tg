// Предопределённые темы оформления чата (Telegram chat themes — набор именованных
// тем с эмодзи-названием, у каждой свой градиент-обои и акцент, с light/dark
// вариантами). Пользователь выбирает тему для конкретного диалога → она
// применяется к чату у обоих участников (messages.setChatTheme).
//
// Значения палитр взяты из tweb (config/themePresets.ts — dayClassic accent
// presets + tinted base wallpapers из Telegram iOS) и существующих
// WALLPAPER_PRESETS, чтобы оформление совпадало по духу с оригиналом.
// Не дублируем инфраструктуру обоев: градиент рисуется тем же 4-цветным
// linear-gradient + pattern.svg, что и превью пресетов в ChatWallpaper.

export interface ChatThemeVariant {
  /** акцентный цвет (--tg-accent) */
  accent: string
  /** 4-цветный градиент обоев чата */
  gradient: [string, string, string, string]
}

export interface ChatTheme {
  /** стабильный id (хранится на сервере в chat_theme.theme_id) */
  id: string
  /** эмодзи-название темы (как в Telegram) */
  emoji: string
  light: ChatThemeVariant
  dark: ChatThemeVariant
}

// ~8 тем с эмодзи как в Telegram chat themes. Порядок фиксирован — так же
// рисуется горизонтальный скроллер свотчей в ChatThemesPicker.
export const CHAT_THEMES: ChatTheme[] = [
  {
    id: 'sky',
    emoji: '🏝',
    light: { accent: '#f55783', gradient: ['#8dc0eb', '#b9d1ea', '#c6b1ef', '#ebd7ef'] },
    dark: { accent: '#f97b98', gradient: ['#1e3557', '#182036', '#1c4352', '#16263a'] },
  },
  {
    id: 'sunrise',
    emoji: '🐥',
    light: { accent: '#eb9500', gradient: ['#eaa36e', '#f0e486', '#f29ebf', '#e8c06e'] },
    dark: { accent: '#f0c14b', gradient: ['#2c2512', '#45360b', '#221d08', '#3b2f13'] },
  },
  {
    id: 'ice',
    emoji: '⛄',
    light: { accent: '#2cb9ed', gradient: ['#aac8ea', '#cfe0f2', '#c2d9ee', '#b3d0ea'] },
    dark: { accent: '#3e88f7', gradient: ['#1e3557', '#151a36', '#1c4352', '#2a4541'] },
  },
  {
    id: 'tulip',
    emoji: '🌷',
    light: { accent: '#ff5fa9', gradient: ['#f2b9c4', '#e89bb0', '#f5cdd6', '#eaa9bd'] },
    dark: { accent: '#eb6ca4', gradient: ['#2c0b22', '#290020', '#160a22', '#3b1834'] },
  },
  {
    id: 'diamond',
    emoji: '💎',
    light: { accent: '#7e5fe5', gradient: ['#e4b2ea', '#8376c2', '#eab9d9', '#b493e6'] },
    dark: { accent: '#9472ee', gradient: ['#3a1c3a', '#24193c', '#392e3e', '#1a1632'] },
  },
  {
    id: 'gold',
    emoji: '🌟',
    light: { accent: '#f08200', gradient: ['#f0c07a', '#e8a268', '#f5d29b', '#e0b070'] },
    dark: { accent: '#f0a030', gradient: ['#2c211b', '#442917', '#22191f', '#3b2714'] },
  },
  {
    id: 'forest',
    emoji: '🎄',
    light: { accent: '#5a9e29', gradient: ['#c9e29b', '#9fd17a', '#dbe8a0', '#a7d77f'] },
    dark: { accent: '#29b327', gradient: ['#2d4836', '#172b19', '#364331', '#103231'] },
  },
  {
    id: 'arcade',
    emoji: '🎮',
    light: { accent: '#199972', gradient: ['#a8e0d0', '#bfeae0', '#cdeee6', '#b3e6da'] },
    dark: { accent: '#00b09b', gradient: ['#1c2731', '#1a1c25', '#27303b', '#1b1b21'] },
  },
]

// Тема по id (undefined — тема не задана / неизвестный id → дефолтное оформление).
export function chatThemeById(id: string | undefined | null): ChatTheme | undefined {
  if (!id) return undefined
  return CHAT_THEMES.find((t) => t.id === id)
}

// Вариант темы под текущий режим (light/dark). Пустой результат для отсутствующей
// темы — вызывающий рисует дефолт.
export function chatThemeVariant(
  id: string | undefined | null,
  mode: 'light' | 'dark',
): ChatThemeVariant | undefined {
  return chatThemeById(id)?.[mode]
}
