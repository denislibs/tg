// Модалка mini-app + JS-мост window.Telegram.WebApp (1:1 с tweb telegramWebView):
// обмен строками JSON {eventType, eventData} через postMessage. Обрабатываем
// минимально-достаточный набор web_app_* событий; шлём в iframe theme_changed,
// main_button_pressed, back_button_pressed, popup_closed.
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import TgIcon from '../TgIcon'
import Text from '../../shared/ui/Text'
import { usePortalContainer } from '../../core/pip'
import { useWebAppStore, closeWebApp, webAppTheme } from '../../core/webapp'
import { uiEvents } from '../../core/hooks/uiEvents'
import { useT } from '../../i18n'
import s from './WebAppModal.module.scss'

const SAFE = new Set(['http:', 'https:', 'mailto:', 'tel:', 'tg:'])
function safeOpen(url: string) {
  try {
    if (SAFE.has(new URL(url, location.href).protocol)) window.open(url, '_blank', 'noopener')
  } catch { /* ignore bad url */ }
}

interface MainBtn {
  isVisible: boolean
  isActive: boolean
  text: string
  color: string
  textColor: string
  isProgress: boolean
}
interface PopupReq {
  title?: string
  message: string
  buttons: { id?: string; type?: string; text?: string }[]
}

export default function WebAppModal() {
  const container = usePortalContainer()
  const open = useWebAppStore((st) => st.open)
  return createPortal(
    <AnimatePresence>{open && <WebAppInner />}</AnimatePresence>,
    container,
  )
}

function WebAppInner() {
  const t = useT()
  const url = useWebAppStore((st) => st.url)
  const botName = useWebAppStore((st) => st.botName)
  const frameRef = useRef<HTMLIFrameElement>(null)
  const [loaded, setLoaded] = useState(false)
  const [backVisible, setBackVisible] = useState(false)
  const [main, setMain] = useState<MainBtn>({
    isVisible: false, isActive: true, text: '', color: 'var(--tg-accent)', textColor: '#fff', isProgress: false,
  })
  const [popup, setPopup] = useState<PopupReq | null>(null)
  const confirmClose = useRef(false)

  // Отправить событие в mini-app.
  const post = (eventType: string, eventData?: unknown) => {
    frameRef.current?.contentWindow?.postMessage(JSON.stringify({ eventType, eventData }), '*')
  }
  const sendTheme = () => post('theme_changed', { theme_params: webAppTheme() })

  // Приём событий из mini-app (матчинг по e.source, как в tweb).
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (e.source !== frameRef.current?.contentWindow) return
      let msg: { eventType?: string; eventData?: unknown }
      try { msg = JSON.parse(typeof e.data === 'string' ? e.data : '') } catch { return }
      const { eventType, eventData } = msg
      const d = (eventData ?? {}) as Record<string, unknown>
      switch (eventType) {
        case 'iframe_ready':
        case 'web_app_ready':
          setLoaded(true)
          sendTheme()
          break
        case 'web_app_request_theme':
          sendTheme()
          break
        case 'web_app_setup_main_button':
          setMain({
            isVisible: !!d.is_visible,
            isActive: d.is_active !== false,
            text: String(d.text ?? ''),
            color: String(d.color ?? 'var(--tg-accent)'),
            textColor: String(d.text_color ?? '#fff'),
            isProgress: !!d.is_progress_visible,
          })
          break
        case 'web_app_setup_back_button':
          setBackVisible(!!d.is_visible)
          break
        case 'web_app_setup_closing_behavior':
          confirmClose.current = !!d.need_confirmation
          break
        case 'web_app_open_link':
          if (typeof d.url === 'string') safeOpen(d.url)
          break
        case 'web_app_open_tg_link':
          if (typeof d.path_full === 'string') safeOpen('https://t.me' + d.path_full)
          break
        case 'web_app_data_send':
          uiEvents.emit('ui:toast', `${botName}: ${t('Data sent')}`)
          closeWebApp()
          break
        case 'web_app_open_popup':
          setPopup({
            title: d.title as string | undefined,
            message: String(d.message ?? ''),
            buttons: (Array.isArray(d.buttons) ? d.buttons : [{ type: 'close' }]) as PopupReq['buttons'],
          })
          break
        case 'web_app_trigger_haptic_feedback':
          navigator.vibrate?.(10)
          break
        case 'web_app_close':
          closeWebApp()
          break
        // web_app_expand / request_viewport — no-op (как в tweb)
      }
    }
    window.addEventListener('message', onMsg)
    return () => window.removeEventListener('message', onMsg)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [botName])

  // Пересылать смену темы приложения в открытый mini-app.
  useEffect(() => {
    const obs = new MutationObserver(() => { if (loaded) sendTheme() })
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => obs.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded])

  const requestClose = () => {
    if (confirmClose.current && !window.confirm(t('Close this Mini App?'))) return
    closeWebApp()
  }
  const onPopupPick = (id?: string) => { setPopup(null); post('popup_closed', { button_id: id }) }

  return (
    <motion.div
      className={s.overlay}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18 }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) requestClose() }}
    >
      <motion.div
        className={s.panel}
        initial={{ scale: 0.96, y: 12, opacity: 0 }}
        animate={{ scale: 1, y: 0, opacity: 1 }}
        exit={{ scale: 0.96, y: 12, opacity: 0 }}
        transition={{ duration: 0.2 }}
      >
        <div className={s.header}>
          {backVisible ? (
            <button className={s.hbtn} onClick={() => post('back_button_pressed')} aria-label="back">
              <TgIcon name="back" size={22} />
            </button>
          ) : (
            <div style={{ width: 40 }} />
          )}
          <div className={s.title}>
            <Text noWrap size={15} weight={600} color="var(--tg-textPrimary)">{botName}</Text>
            <Text noWrap size={12} color="var(--tg-textSecondary)">mini app</Text>
          </div>
          <button className={s.hbtn} onClick={requestClose} aria-label="close">
            <TgIcon name="close" size={22} />
          </button>
        </div>

        <div className={s.body}>
          {!loaded && <div className={s.loader}>{t('Loading')}…</div>}
          <iframe
            ref={frameRef}
            className={s.frame}
            src={url}
            title={botName}
            sandbox="allow-scripts allow-same-origin allow-popups allow-forms allow-modals"
            allow="clipboard-write"
            onLoad={() => setLoaded(true)}
          />
        </div>

        {main.isVisible && (
          <div className={s.footer}>
            <button
              className={s.mainBtn}
              disabled={!main.isActive || main.isProgress}
              style={{ background: main.color, color: main.textColor }}
              onClick={() => post('main_button_pressed')}
            >
              {main.isProgress && <span className={s.spinner} />}
              {main.text}
            </button>
          </div>
        )}
      </motion.div>

      {/* web_app_open_popup — нативный попап mini-app */}
      {popup && (
        <div className={s.overlay} style={{ zIndex: 1310 }} onMouseDown={(e) => { if (e.target === e.currentTarget) onPopupPick() }}>
          <div style={{ background: 'var(--tg-appBg)', borderRadius: 12, padding: 20, minWidth: 280, maxWidth: 340 }}>
            {popup.title && <Text size={16} weight={600} color="var(--tg-textPrimary)">{popup.title}</Text>}
            <Text size={14} color="var(--tg-textSecondary)" style={{ display: 'block', margin: '8px 0 16px' }}>{popup.message}</Text>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              {popup.buttons.map((b, i) => (
                <button
                  key={i}
                  onClick={() => onPopupPick(b.id)}
                  style={{
                    border: 'none', background: 'transparent', cursor: 'pointer', padding: '8px 12px',
                    borderRadius: 8, fontSize: 15, fontWeight: 600,
                    color: b.type === 'destructive' ? '#e53935' : 'var(--tg-accent)',
                  }}
                >
                  {b.text || (b.type === 'ok' ? 'OK' : b.type === 'cancel' ? t('Cancel') : t('Close'))}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </motion.div>
  )
}
