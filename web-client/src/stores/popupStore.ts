// popupStore — глобальный менеджер попапов (порт идеи tweb PopupManager). Вместо
// десятков булевых флагов «open/not-open» и мегапропсов у компонента-реестра,
// попап открывается императивно там, где произошло действие:
//
//   openPopup((p) => <ConfirmDialog … onClose={p.destroy} />)
//   openPopup((p) => <MutePopup open={p.open} onClose={p.requestClose} onExitComplete={p.onExitComplete} />)
//
// PopupHost рендерит стек. Три контракта анимации закрытия покрыты одним PopupApi:
//   • instant / self-animating (ConfirmDialog, ForwardPicker): onClose={p.destroy}
//   • open-controlled (Menu/MutePopup/…): open={p.open} onClose={p.requestClose} onExitComplete={p.onExitComplete}
//   • presence-controlled (слайд-ины): <AnimatePresence onExitComplete={p.onExitComplete}>{p.open && …requestClose}</AnimatePresence>
import { create } from 'zustand'
import type { ReactNode } from 'react'

export interface PopupApi {
  /** true, пока попап активен; становится false после requestClose() (для open-controlled) */
  open: boolean
  /** начать закрытие: open→false (анимированные проиграют exit и вызовут onExitComplete) */
  requestClose: () => void
  /** снять со стека (звать по завершении exit-анимации) */
  onExitComplete: () => void
  /** снять со стека немедленно (для instant/self-animating попапов) */
  destroy: () => void
}

interface PopupEntry {
  id: number
  render: (api: PopupApi) => ReactNode
  closing: boolean
  /** «сорт» попапа (tweb PopupElement kind): второй попап того же сорта
   * закрывает предыдущий, а не встаёт поверх него */
  kind?: string
}

interface PopupStore {
  popups: PopupEntry[]
  push: (render: (api: PopupApi) => ReactNode, kind?: string) => number
  setClosing: (id: number) => void
  remove: (id: number) => void
  clear: () => void
}

let seq = 0

export const usePopupStore = create<PopupStore>((set) => ({
  popups: [],
  push: (render, kind) => {
    const id = ++seq
    set((s) => ({
      popups: [
        // tweb перед открытием гасит уже открытые попапы того же сорта
        // (например chatPreview.tsx:65) — иначе они копятся стопкой, и клик
        // приходит в чужой, ещё висящий экземпляр.
        ...(kind ? s.popups.map((p) => (p.kind === kind ? { ...p, closing: true } : p)) : s.popups),
        { id, render, closing: false, kind },
      ],
    }))
    return id
  },
  setClosing: (id) => set((s) => ({ popups: s.popups.map((p) => (p.id === id ? { ...p, closing: true } : p)) })),
  remove: (id) => set((s) => ({ popups: s.popups.filter((p) => p.id !== id) })),
  clear: () => set({ popups: [] }),
}))

/** Открыть попап; возвращает id (обычно не нужен — попап закрывает себя через
 * PopupApi). `kind` делает попап одиночным: повторное открытие закрывает
 * предыдущий экземпляр того же сорта (tweb PopupElement kind). */
export const openPopup = (render: (api: PopupApi) => ReactNode, kind?: string): number =>
  usePopupStore.getState().push(render, kind)
/** Принудительно начать закрытие попапа по id (например при смене чата). */
export const closePopup = (id: number) => usePopupStore.getState().setClosing(id)
/** Снять все попапы немедленно (напр. при анмаунте колонки чата — попапы чат-скоупные). */
export const clearPopups = () => usePopupStore.getState().clear()
