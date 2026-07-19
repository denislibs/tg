import { create } from 'zustand'

// Картинка в картинке.
// 1) Видеоплеер просмотрщика уходит в PiP через video.requestPictureInPicture
//    (кнопка в лайтбоксе) — enterPip.
// 2) Пункт меню «Картинка в картинке» выносит ВСЁ приложение в плавающее окно
//    поверх всех окон через Document Picture-in-Picture (как web.telegram.org):
//    #root переезжает в pip-окно, во вкладке — заглушка с кнопкой возврата.

// PiP-окно узкое (~420px), но useMediaQuery слушает matchMedia ОСНОВНОГО окна и
// не переключается — поэтому в PiP приложение принудительно в мобильном layout
// (одна колонка). Компоненты читают usePipStore и подмешивают narrow.
export const usePipStore = create<{ active: boolean }>(() => ({ active: false }))

interface DocumentPiP {
  requestWindow: (opts?: { width?: number; height?: number }) => Promise<Window>
  window: Window | null
}
const docPip = (): DocumentPiP | undefined =>
  (window as unknown as { documentPictureInPicture?: DocumentPiP }).documentPictureInPicture

export const pipSupported = (): boolean =>
  (typeof document !== 'undefined' && !!document.pictureInPictureEnabled) || !!docPip()

// Ввести конкретный <video> в PiP (кнопка в видеоплеере).
export async function enterPip(video: HTMLVideoElement): Promise<boolean> {
  if (!document.pictureInPictureEnabled || video.disablePictureInPicture) return false
  try {
    if (document.pictureInPictureElement === video) {
      await document.exitPictureInPicture()
      return false
    }
    await video.requestPictureInPicture()
    return true
  } catch {
    return false
  }
}

let appPipActive = false

// Вынести приложение (#root) в окно Document PiP; во вкладке показать заглушку
// с кнопкой «Назад во вкладку». Возврат — по закрытию окна или кнопке.
export async function enterAppPip(labels: { title: string; hint: string; back: string }): Promise<boolean> {
  const dp = docPip()
  const root = document.getElementById('root')
  if (!dp || !root || appPipActive) return false
  let pip: Window
  try {
    pip = await dp.requestWindow({ width: 420, height: 760 })
  } catch {
    return false
  }
  appPipActive = true
  usePipStore.setState({ active: true })

  // Перенести стили (link/style) в окно PiP.
  for (const node of document.head.querySelectorAll('style, link[rel="stylesheet"]')) {
    pip.document.head.appendChild(node.cloneNode(true))
  }
  // Скопировать тему-атрибуты (data-theme/reduce-motion) на <html> PiP-окна.
  for (const attr of document.documentElement.attributes) {
    if (attr.name.startsWith('data-')) pip.document.documentElement.setAttribute(attr.name, attr.value)
  }
  pip.document.body.style.margin = '0'

  // Плейсхолдер на месте #root + перенос узла в PiP.
  const placeholder = document.createElement('div')
  root.replaceWith(placeholder)
  pip.document.body.appendChild(root)

  // Заглушка во вкладке.
  const stub = document.createElement('div')
  stub.style.cssText =
    'position:fixed;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;text-align:center;padding:24px;font-family:inherit;background:var(--tg-appBg,#212121);color:var(--tg-textPrimary,#fff)'
  const h = document.createElement('div')
  h.textContent = labels.title
  h.style.cssText = 'font-size:20px;font-weight:600;max-width:420px'
  const p = document.createElement('div')
  p.textContent = labels.hint
  p.style.cssText = 'font-size:15px;opacity:0.6;max-width:420px;line-height:1.5'
  const btn = document.createElement('button')
  btn.textContent = labels.back
  btn.style.cssText =
    'margin-top:8px;padding:12px 28px;border:none;border-radius:22px;background:var(--tg-accent,#8774e1);color:#fff;font-size:15px;font-weight:600;cursor:pointer'
  btn.onclick = () => pip.close()
  stub.append(h, p, btn)
  placeholder.replaceWith(stub)

  // Возврат: вернуть #root на место, убрать заглушку.
  const restore = () => {
    if (!appPipActive) return
    appPipActive = false
    usePipStore.setState({ active: false })
    stub.replaceWith(root)
  }
  pip.addEventListener('pagehide', restore)
  return true
}
