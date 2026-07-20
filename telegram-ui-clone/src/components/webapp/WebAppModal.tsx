// Модалка mini-app + JS-мост window.Telegram.WebApp (1:1 с tweb telegramWebView):
// обмен строками JSON {eventType, eventData} через postMessage. Обрабатываем
// web_app_* события: тема, кнопки, popup, ссылки, sendData→бот, CloudStorage
// (invoke_custom_method), запрос контакта/доступа, QR-сканер, инвойс, сенсоры,
// biometry (на вебе недоступна — отвечаем по протоколу).
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import TgIcon from '../TgIcon'
import Text from '../../shared/ui/Text'
import { usePortalContainer } from '../../core/pip'
import { useWebAppStore, closeWebApp, webAppTheme } from '../../core/webapp'
import { uiEvents } from '../../core/hooks/uiEvents'
import { useManagers } from '../../core/hooks/useManagers'
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

// BarcodeDetector есть не во всех браузерах — узкий тип под наш вызов.
interface BarcodeDetectorLike {
  detect(source: CanvasImageSource): Promise<{ rawValue: string }[]>
}
type BarcodeDetectorCtor = new (opts?: { formats?: string[] }) => BarcodeDetectorLike

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
  const managers = useManagers()
  const url = useWebAppStore((st) => st.url)
  const botName = useWebAppStore((st) => st.botName)
  const botId = useWebAppStore((st) => st.botId)
  const frameRef = useRef<HTMLIFrameElement>(null)
  const [loaded, setLoaded] = useState(false)
  const [backVisible, setBackVisible] = useState(false)
  const [main, setMain] = useState<MainBtn>({
    isVisible: false, isActive: true, text: '', color: 'var(--tg-accent)', textColor: '#fff', isProgress: false,
  })
  const [popup, setPopup] = useState<PopupReq | null>(null)
  const [qr, setQr] = useState<{ text?: string } | null>(null)
  const confirmClose = useRef(false)
  const sensors = useRef<{ motion?: (e: DeviceMotionEvent) => void; orient?: (e: DeviceOrientationEvent) => void }>({})

  // Отправить событие в mini-app.
  const post = (eventType: string, eventData?: unknown) => {
    frameRef.current?.contentWindow?.postMessage(JSON.stringify({ eventType, eventData }), '*')
  }
  const sendTheme = () => post('theme_changed', { theme_params: webAppTheme() })

  // CloudStorage и прочие серверные методы (Telegram invoke_custom_method).
  const invokeCustom = async (method: string, params: Record<string, unknown>): Promise<unknown> => {
    if (!botId) throw new Error('NO_BOT')
    switch (method) {
      case 'getStorageValues': {
        const keys = (params.keys as string[]) ?? []
        const vals = await managers.bots.cloudGet(botId, keys)
        const out: Record<string, string> = {}
        for (const k of keys) out[k] = vals[k] ?? ''
        return out
      }
      case 'saveStorageValue': {
        const key = String(params.key ?? '')
        const value = String(params.value ?? '')
        if (value === '') await managers.bots.cloudRemove(botId, [key])
        else await managers.bots.cloudSet(botId, key, value)
        return true
      }
      case 'getStorageKeys':
        return managers.bots.cloudKeys(botId)
      case 'deleteStorageValues':
      case 'deleteStorageKeys':
        await managers.bots.cloudRemove(botId, (params.keys as string[]) ?? [])
        return true
      default:
        throw new Error('UNSUPPORTED_METHOD')
    }
  }

  // Сенсоры (акселерометр/гироскоп/ориентация) поверх DeviceMotion/Orientation.
  const stopSensors = () => {
    if (sensors.current.motion) window.removeEventListener('devicemotion', sensors.current.motion)
    if (sensors.current.orient) window.removeEventListener('deviceorientation', sensors.current.orient)
    sensors.current = {}
  }
  const startMotion = (kind: 'accelerometer' | 'gyroscope') => {
    if (typeof DeviceMotionEvent === 'undefined') { post(`${kind}_failed`, { error: 'UNSUPPORTED' }); return }
    const h = (e: DeviceMotionEvent) => {
      if (kind === 'accelerometer') {
        const a = e.accelerationIncludingGravity
        post('accelerometer_changed', { x: a?.x ?? 0, y: a?.y ?? 0, z: a?.z ?? 0 })
      } else {
        const r = e.rotationRate
        post('gyroscope_changed', { x: r?.beta ?? 0, y: r?.gamma ?? 0, z: r?.alpha ?? 0 })
      }
    }
    sensors.current.motion = h
    window.addEventListener('devicemotion', h)
    post(`${kind}_started`)
  }
  const startOrientation = () => {
    if (typeof DeviceOrientationEvent === 'undefined') { post('device_orientation_failed', { error: 'UNSUPPORTED' }); return }
    const h = (e: DeviceOrientationEvent) => {
      post('device_orientation_changed', { alpha: e.alpha ?? 0, beta: e.beta ?? 0, gamma: e.gamma ?? 0, absolute: e.absolute })
    }
    sensors.current.orient = h
    window.addEventListener('deviceorientation', h)
    post('device_orientation_started')
  }

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
          // Доставляем данные боту-владельцу (web_app_data) + тост, затем закрываем.
          if (botId) void managers.bots.sendWebAppData(botId, String(d.data ?? ''), botName).catch(() => {})
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
        case 'web_app_invoke_custom_method': {
          const reqId = String(d.req_id ?? '')
          const method = String(d.method ?? '')
          const params = (d.params ?? {}) as Record<string, unknown>
          void invokeCustom(method, params).then(
            (result) => post('custom_method_invoked', { req_id: reqId, result }),
            (err: unknown) => post('custom_method_invoked', { req_id: reqId, error: err instanceof Error ? err.message : String(err) }),
          )
          break
        }
        case 'web_app_request_phone':
          post('phone_requested', { status: window.confirm(t('Share your phone number with this bot?')) ? 'sent' : 'cancelled' })
          break
        case 'web_app_request_write_access':
          post('write_access_requested', { status: window.confirm(t('Allow this bot to message you?')) ? 'allowed' : 'cancelled' })
          break
        case 'web_app_open_scan_qr_popup':
          setQr({ text: d.text as string | undefined })
          break
        case 'web_app_close_scan_qr_popup':
          setQr(null)
          break
        case 'web_app_biometry_get_info':
          // Биометрия на вебе не поддержана — отвечаем по протоколу.
          post('biometry_info_received', { available: false })
          break
        case 'web_app_biometry_request_access':
          post('biometry_info_received', { available: false, access_requested: false })
          break
        case 'web_app_biometry_request_auth':
          post('biometry_auth_requested', { status: 'failed' })
          break
        case 'web_app_open_invoice': {
          const slug = String(d.slug ?? '')
          const paid = window.confirm(t('Pay this invoice?'))
          post('invoice_closed', { slug, status: paid ? 'paid' : 'cancelled' })
          break
        }
        case 'web_app_start_accelerometer':
          startMotion('accelerometer')
          break
        case 'web_app_stop_accelerometer':
          stopSensors()
          post('accelerometer_stopped')
          break
        case 'web_app_start_gyroscope':
          startMotion('gyroscope')
          break
        case 'web_app_stop_gyroscope':
          stopSensors()
          post('gyroscope_stopped')
          break
        case 'web_app_start_device_orientation':
          startOrientation()
          break
        case 'web_app_stop_device_orientation':
          stopSensors()
          post('device_orientation_stopped')
          break
        case 'web_app_close':
          closeWebApp()
          break
        // web_app_expand / request_viewport / request_fullscreen — no-op (как в tweb)
      }
    }
    window.addEventListener('message', onMsg)
    return () => { window.removeEventListener('message', onMsg); stopSensors() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [botName, botId])

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
  const onQrText = (data: string) => { post('qr_text_received', { data }); setQr(null); post('scan_qr_popup_closed') }
  const onQrClose = () => { setQr(null); post('scan_qr_popup_closed') }

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
            allow="clipboard-write; camera"
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

      {/* web_app_open_scan_qr_popup — сканер QR через BarcodeDetector */}
      {qr && <QrScanner text={qr.text} onText={onQrText} onClose={onQrClose} t={t} />}
    </motion.div>
  )
}

// QrScanner — камера + BarcodeDetector. Если API нет — сообщаем и закрываем.
function QrScanner({ text, onText, onClose, t }: { text?: string; onText: (d: string) => void; onClose: () => void; t: (k: string) => string }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    const Ctor = (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector
    if (!Ctor || !navigator.mediaDevices?.getUserMedia) {
      setErr(t('QR scanning is not supported in this browser'))
      return
    }
    let stream: MediaStream | null = null
    let raf = 0
    let cancelled = false
    const detector = new Ctor({ formats: ['qr_code'] })
    const tick = async () => {
      const v = videoRef.current
      if (!cancelled && v && v.readyState >= 2) {
        try {
          const codes = await detector.detect(v)
          if (codes[0]?.rawValue) { onText(codes[0].rawValue); return }
        } catch { /* keep scanning */ }
      }
      if (!cancelled) raf = requestAnimationFrame(() => { void tick() })
    }
    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } }).then((st) => {
      if (cancelled) { st.getTracks().forEach((tr) => tr.stop()); return }
      stream = st
      if (videoRef.current) { videoRef.current.srcObject = st; void videoRef.current.play() }
      void tick()
    }).catch(() => setErr(t('Camera access denied')))
    return () => {
      cancelled = true
      cancelAnimationFrame(raf)
      stream?.getTracks().forEach((tr) => tr.stop())
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className={s.overlay} style={{ zIndex: 1320, flexDirection: 'column', gap: 16 }} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      {text && <Text size={15} weight={600} color="#fff">{text}</Text>}
      {err ? (
        <Text size={14} color="#fff">{err}</Text>
      ) : (
        <video ref={videoRef} muted playsInline style={{ width: 'min(80vw, 360px)', borderRadius: 12, background: '#000' }} />
      )}
      <button
        onClick={onClose}
        style={{ border: 'none', background: 'rgba(255,255,255,.16)', color: '#fff', borderRadius: 10, padding: '10px 20px', fontSize: 15, fontWeight: 600, cursor: 'pointer' }}
      >
        {t('Close')}
      </button>
    </div>
  )
}
