import { createContext, useContext } from 'react'
import type ReactChatInstance from '@components/chat/reactChatInstance'

// ВРЕМЕННО до К-3: контекст React-острова инстанса чата
// (`components/chat/reactChatInstance.ts`). В стеке одновременно смонтировано
// несколько инстансов (неактивные скрыты, но живут в DOM — как вкладки
// tabs-container в tweb). Поэтому любой эффект инстанса, который вешает слушатель
// на window/document или пишет в глобальное состояние, обязан быть за
// `useIsActiveChat()`: иначе он сработает во всех копиях сразу.

export interface ChatInstanceValue {
  /** инстанс стека `appImManager.chats` (у tweb — объект `Chat`) */
  instance: ReactChatInstance
  /** `appImManager.chat === instance` */
  isActive: boolean
}

const ChatInstanceContext = createContext<ChatInstanceValue | null>(null)

export const ChatInstanceProvider = ChatInstanceContext.Provider

export function useChatInstance(): ChatInstanceValue | null {
  return useContext(ChatInstanceContext)
}

/** Вне провайдера (юнит-тесты) инстанс активен. */
export function useIsActiveChat(): boolean {
  return useContext(ChatInstanceContext)?.isActive ?? true
}
