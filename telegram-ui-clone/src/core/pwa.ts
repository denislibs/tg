import { create } from 'zustand'

// PWA-установка (tweb installPrompt): ловим beforeinstallprompt, храним
// отложенный prompt. Пункт «Установить приложение» виден, только если событие
// поймано (браузер счёл приложение устанавливаемым и оно ещё не установлено).
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

interface PwaState {
  canInstall: boolean
  setDeferred: (e: BeforeInstallPromptEvent | null) => void
  install: () => Promise<void>
}

let deferred: BeforeInstallPromptEvent | null = null

export const usePwaStore = create<PwaState>((set) => ({
  canInstall: false,
  setDeferred: (e) => { deferred = e; set({ canInstall: !!e }) },
  install: async () => {
    if (!deferred) return
    await deferred.prompt()
    const { outcome } = await deferred.userChoice
    if (outcome === 'accepted') { deferred = null; set({ canInstall: false }) }
  },
}))

// Навешивается один раз при старте приложения (main.tsx).
export function initPwaInstall(): void {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault() // не показывать браузерную мини-плашку — свой пункт меню
    usePwaStore.getState().setDeferred(e as BeforeInstallPromptEvent)
  })
  window.addEventListener('appinstalled', () => usePwaStore.getState().setDeferred(null))
}
