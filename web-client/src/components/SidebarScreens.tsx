import { lazy, Suspense } from 'react'
import ContactsView from './ContactsView'
import NewGroupFlow, { type GroupPhoto } from './NewGroupFlow'
import NewChannelFlow from './NewChannelFlow'
import NewPrivateChat from './NewPrivateChat'
import type { OpenPeer } from '../data'

// Кошелёк (звёзды) и экран звонков — из меню, не первый кадр → лениво. Настроек
// здесь больше нет: корень — вкладка колоночного слайдера (`AppSettingsTab`,
// задача 28 плана 2D), её модуль грузится лениво сам (`solidJsTabs/tabs.ts`).
const WalletView = lazy(() => import('./stars/WalletView'))
const CallsView = lazy(() => import('./CallsView'))

// Взаимоисключающие экраны левой колонки (в tweb в #column-left всегда один поверх
// списка чатов). null = список.
//
// Въезд справа играет CSS самого экрана — кейфрейм на вставке узла, как у tweb,
// где вкладки слайдера анимируются классами/кейфреймами, а не JS-движком
// (`tweb src/scss/partials/_slider.scss:226-241`). Поэтому обёрток-презенсов
// здесь больше нет: экран просто монтируется и размонтируется.
export type SidebarScreen =
  | 'contacts' | 'wallet' | 'calls'
  | 'newGroup' | 'newChannel' | 'newPrivate' | 'newSecret' | null

interface SidebarScreensProps {
  screen: SidebarScreen
  /** снять текущий экран (null) */
  close: () => void
  onSelect: (id: string) => void
  /** открыть пира (есть диалог — выбрать, нет — черновик): `core/navigation/openPeer.ts` */
  onOpenPeer: (peer: OpenPeer) => void
  onChatCreated?: (chatId: number) => void
  onCreateGroup: (name: string, memberIds: number[], photo: GroupPhoto | null) => void
  onCreateChannel: (name: string, description: string) => void
  onStartSecret: (userId: PeerId) => void
}

export default function SidebarScreens({
  screen,
  close,
  onSelect,
  onOpenPeer,
  onChatCreated,
  onCreateGroup,
  onCreateChannel,
  onStartSecret,
}: SidebarScreensProps) {
  return (
    <>
      <Suspense fallback={null}>
        {screen === 'wallet' && <WalletView onBack={close} />}
      </Suspense>
      <Suspense fallback={null}>
        {screen === 'calls' && (
          <CallsView onBack={close} onOpenChat={(chatId) => { close(); onSelect(String(chatId)) }} />
        )}
      </Suspense>
      {screen === 'contacts' && (
        <ContactsView
          onOpenPeer={(peer) => { close(); onOpenPeer(peer) }}
          onBack={close}
          onOpenChat={(chatId) => { close(); onChatCreated?.(chatId) }}
        />
      )}
      {screen === 'newGroup' && (
        <NewGroupFlow onClose={close} onCreate={(name, memberIds, photo) => { onCreateGroup(name, memberIds, photo); close() }} />
      )}
      {screen === 'newChannel' && (
        <NewChannelFlow onClose={close} onCreate={(name, description) => { onCreateChannel(name, description); close() }} />
      )}
      {screen === 'newPrivate' && (
        <NewPrivateChat onClose={close} onPick={onOpenPeer} />
      )}
      {screen === 'newSecret' && (
        <NewPrivateChat title="SecretChat.New" onClose={close} onPick={(peer) => onStartSecret(peer.id)} />
      )}
    </>
  )
}
