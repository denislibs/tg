// @vitest-environment-options {"settings": {"navigation": {"disableChildFrameNavigation": true}}}
// ↑ happy-dom иначе грузит src фрейма по сети.
// Порт tweb `src/tests/telegramWebViewOrigin.test.ts` (b59a02302 «Bind the Mini App
// bridge to the origin it was opened at»).
//
// Мост принимал событие по одному `e.source`, а WindowProxy фрейма переживает
// навигацию на чужой origin: документ, заменивший mini-app (open redirect в
// приложении, встроенный скрипт, колбэк партнёрского домена), получал мост и
// привилегии бота — CloudStorage, invoke_custom_method, sendData.
//
// Отличие от оригинала: tweb привязывает мост только при серверном флаге
// `webViewResultUrl.same_origin`; у нас такого ответа нет (адрес mini-app — прямой
// `keyboardButtonWebView.url`, `core/webapp.ts`), а исходящие события и так всегда
// адресованы origin'у приложения (`frameOriginOf`). Входящие привязаны так же — всегда.
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import WebAppModal from './WebAppModal'
import { ManagersProvider } from '../../core/hooks/useManagers'
import { openWebApp, closeWebApp, useWebAppStore } from '../../core/webapp'
import type { Managers } from '../../client/bootstrap'

const MINI_APP_ORIGIN = 'https://miniapp.example'
const OTHER_ORIGIN = 'https://attacker.example'

function mount(url = MINI_APP_ORIGIN + '/app') {
  act(() => openWebApp({ url, botName: 'Утиный бот', botId: 1 }))
  render(<ManagersProvider managers={{} as Managers}><WebAppModal /></ManagersProvider>)
  const iframe = document.querySelector('iframe')!
  expect(iframe).toBeTruthy()
  return iframe
}

// у ушедшего фрейма тот же WindowProxy, поэтому `source` по-прежнему совпадает —
// различить два документа может только origin
function postFromFrame(iframe: HTMLIFrameElement, origin: string, eventType = 'web_app_close') {
  act(() => {
    window.dispatchEvent(new MessageEvent('message', {
      data: JSON.stringify({ eventType, eventData: '' }),
      origin,
      source: iframe.contentWindow,
    }))
  })
}

describe('мост mini-app привязан к origin, на котором открыт', () => {
  beforeEach(() => closeWebApp())
  afterEach(() => {
    cleanup()
    closeWebApp()
  })

  it('принимает событие с origin, на котором открыт фрейм', () => {
    const iframe = mount()
    postFromFrame(iframe, MINI_APP_ORIGIN)
    expect(useWebAppStore.getState().open).toBe(false)
  })

  it('игнорирует событие с другого origin в том же фрейме', () => {
    const iframe = mount()
    postFromFrame(iframe, OTHER_ORIGIN)
    expect(useWebAppStore.getState().open).toBe(true)
  })

  it('следует за origin, на который фрейм переводит смена адреса', () => {
    const iframe = mount()
    act(() => useWebAppStore.setState({ url: OTHER_ORIGIN + '/next' }))

    postFromFrame(iframe, MINI_APP_ORIGIN)
    expect(useWebAppStore.getState().open).toBe(true)

    postFromFrame(iframe, OTHER_ORIGIN)
    expect(useWebAppStore.getState().open).toBe(false)
  })

  it('исходящие события адресованы origin приложения', () => {
    const iframe = mount()
    const postMessage = vi.spyOn(iframe.contentWindow!, 'postMessage')
    postFromFrame(iframe, MINI_APP_ORIGIN, 'web_app_request_theme')
    expect(postMessage).toHaveBeenCalledWith(expect.any(String), MINI_APP_ORIGIN)
  })
})
