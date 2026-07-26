// Пикер тем оформления чата (Telegram chat themes — PopupElement с горизонтальным
// скроллером свотчей). Каждый свот — превью бабблов на фоне-градиенте темы; тап
// применяет тему к чату у обоих участников (messages.setChatTheme) и закрывает
// попап. Первый свот — «Без темы» (сброс к дефолтному оформлению).
import Popup from '../shared/ui/Popup'
import TgIcon from './TgIcon'
import patternUrl from '../assets/pattern.svg'
import { CHAT_THEMES, type ChatTheme } from '../chatThemes'
import { PRESET_MODE, resolvePreset } from '../theme'
import { useSettingsStore } from '../settings'
import { useManagers } from '../core/hooks/useManagers'
import { useChatsStore } from '../stores/chatsStore'
import { useT } from '../i18n'
import s from './ChatThemesPicker.module.scss'

export default function ChatThemesPicker({
  open,
  onClose,
  onExitComplete,
  chatId,
  currentThemeId,
}: {
  open: boolean
  onClose: () => void
  onExitComplete?: () => void
  chatId: number
  /** id активной темы чата ('' / undefined — тема не задана) */
  currentThemeId?: string
}) {
  const t = useT()
  const managers = useManagers()
  const themeChoice = useSettingsStore((st) => st.themeChoice)
  const mode = PRESET_MODE[resolvePreset(themeChoice)]

  const selected = currentThemeId || ''

  const apply = (id: string) => {
    // Оптимистично красим сразу; серверный chat_theme_update дойдёт следом (идемпотентно).
    useChatsStore.getState().setDialogTheme(chatId, id)
    void managers.chatThemes.setChatTheme(chatId, id).catch(() => {})
    onClose()
  }

  return (
    <Popup open={open} title={t('Chat Theme')} onClose={onClose} onExitComplete={onExitComplete} width={480}>
      <div className={s.strip}>
        {/* «Без темы» — сброс к дефолтному оформлению */}
        <button type="button" className={s.swatch} data-selected={selected === '' || undefined} onClick={() => apply('')}>
          <div className={s.preview} data-none>
            <TgIcon name="close" size={22} color="var(--tg-textSecondary)" />
          </div>
          <span className={s.label}>{t('No Theme')}</span>
        </button>

        {CHAT_THEMES.map((theme) => (
          <Swatch key={theme.id} theme={theme} mode={mode} selected={selected === theme.id} onSelect={() => apply(theme.id)} />
        ))}
      </div>
    </Popup>
  )
}

function Swatch({
  theme,
  mode,
  selected,
  onSelect,
}: {
  theme: ChatTheme
  mode: 'light' | 'dark'
  selected: boolean
  onSelect: () => void
}) {
  const v = theme[mode]
  const bg = `linear-gradient(150deg, ${v.gradient[0]}, ${v.gradient[1]}, ${v.gradient[2]}, ${v.gradient[3]})`
  const incoming = mode === 'dark' ? 'rgba(255,255,255,0.16)' : 'rgba(255,255,255,0.9)'
  return (
    <button type="button" className={s.swatch} data-selected={selected || undefined} onClick={onSelect}>
      <div className={s.preview} style={{ background: bg }}>
        <div className={s.pattern} style={{ backgroundImage: `url("${patternUrl}")` }} />
        <div className={s.bubbleIn} style={{ background: incoming }} />
        <div className={s.bubbleOut} style={{ background: v.accent }} />
      </div>
      <span className={s.label}>{theme.emoji}</span>
    </button>
  )
}
