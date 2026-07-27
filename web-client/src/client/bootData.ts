// Данные, поднятые в main.tsx ещё до первого рендера React: критические RPC
// (me + список диалогов) стартуют параллельно с загрузкой бандла/словаря, а
// флаг гидрации из кэша сообщает useAuthGate, что список чатов уже отрисован.
// Хуки читают отсюда; заполняется через setBootData из main.tsx (в тестах
// остаётся null — компоненты работают на своих mock-managers).
import type { User } from '../core/managers/authManager'
import type { Dialog } from '../core/models'

export interface BootData {
  me: Promise<User | null>
  dialogs: Promise<Dialog[]>
  hydratedFromCache: boolean
  // Есть ли локальный session_token (IDB). По нему useAuthGate решает authed до
  // ответа сети (как tweb — auth из локального состояния), без промежуточного null.
  hasToken: boolean
  // Стартовали под passcode-локом: под ним НЕ префетчим me/dialogs и не гидрируем
  // (RPC/WS не поднимаем до разблокировки). me/dialogs здесь — пустышки; настоящую
  // загрузку useAppBootstrap/useAuthGate делают после unlock (runWhenUnlocked).
  locked: boolean
}

export let bootData: BootData | null = null

export function setBootData(d: BootData): void {
  bootData = d
}
