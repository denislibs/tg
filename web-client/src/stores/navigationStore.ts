import { create } from 'zustand'
import type { OpenPeer } from '../data'
import { useChatStackStore } from './chatStackStore'

// Навигация мессенджера (де-факто роутер): какой чат/черновик открыт. Единый
// источник истины вместо useState+ref-зеркал в App — хоткеи, SW-хендлер и
// deep-links читают getState() напрямую. Тред (форум-топик / комментарии)
// больше не хранится здесь — это верхний инстанс стека `chatStackStore`
// (`selectOpenThreadDesc` для подписки, `selectOpenThread` — только через
// `getState()`, см. предупреждение у неё); `selectChat` лишь синхронизирует
// стек с выбором корневого чата (tweb `appImManager.setPeer`).

interface NavState {
  /** id выбранного чата ("123", "draft:<peerId>" или null) */
  selectedId: string | null
  /** peer, с которым открыт черновик-чат (нет диалога, пока не отправлено) */
  draftPeer: OpenPeer | null

  /** Выбрать чат: закрывает черновик, кладёт корневой инстанс в chatStackStore
   *  (схлопывая открытый поверх тред — tweb setPeer). */
  selectChat: (id: string | null) => void
  setSelectedId: (id: string | null) => void
  setDraftPeer: (peer: OpenPeer | null) => void
}

export const useNavigationStore = create<NavState>((set) => ({
  selectedId: null,
  draftPeer: null,

  selectChat: (id) => {
    set({ selectedId: id, draftPeer: null })
    const stack = useChatStackStore.getState()
    if (id === null) { stack.clear(); return }
    const peerId = Number(id.startsWith('draft:') ? id.slice('draft:'.length) : id)
    if (Number.isNaN(peerId)) { stack.clear(); return }
    stack.setPeer({ peerId, type: 'chat' })
  },
  setSelectedId: (id) => set({ selectedId: id }),
  setDraftPeer: (peer) => set({ draftPeer: peer }),
}))
