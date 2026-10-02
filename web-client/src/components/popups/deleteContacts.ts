/**
 * Порт tweb `src/components/popups/deleteContacts.ts:1-22` (812502980) —
 * подтверждение удаления контактов красной кнопкой: одного — с его аватаром,
 * нескольких — числом. Первый потребитель — вкладка «Изменить контакт»
 * (`sidebarRight/tabs/editContact.solid.tsx`, tweb `editContact.tsx:306`).
 *
 * Расхождение: аватар в попапе у нас просит `managers` (`avatarNew`, шапка
 * `components/avatar.ts`) — берутся `startClient().managers`, тот же приём,
 * что у `peerProfile.solid.tsx`; сигнатура вызова — оригинала.
 *
 * @returns промис, выполненный подтверждением и отклонённый отменой
 */
import { confirmationPopup } from '@components/popups/popupPeer'
import { startClient } from '@/client/bootstrap'

export default function confirmDeleteContacts(peerIds: PeerId[]) {
  return confirmationPopup({
    ...(peerIds.length === 1 ? {
      peerId: peerIds[0],
      managers: startClient().managers,
      titleLangKey: 'DeleteContact',
      descriptionLangKey: 'AreYouSureDeleteContact',
    } as const : {
      titleLangKey: 'DeleteContactsTitle',
      titleLangArgs: [peerIds.length],
      descriptionLangKey: 'DeleteContactsSubtitle',
    } as const),
    button: { langKey: 'Delete', isDanger: true },
  })
}
