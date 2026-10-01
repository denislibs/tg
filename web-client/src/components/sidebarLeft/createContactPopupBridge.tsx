// ВРЕМЕННО до 2C-26 — мост «Solid-вкладка → React-попап»: угловая «добавить контакт» вкладки
// контактов (`sidebarLeft/tabs/contacts.solid.tsx`, tweb `contacts.tsx:66-72`) зовёт
// `showCreateContactPopup()` оригинала (`popups/createContact.tsx:12`), а порта попапа ещё нет —
// он у задачи 2C-26. До неё функция открывает наш React-попап `NewContactPopup` через
// `popupStore`; задача 2C-26 удаляет этот файл, и вкладка зовёт порт напрямую.
//
// Расхождение моста: наш попап после добавления сам создаёт личный чат (`createPrivate` в
// `NewContactPopup.tsx::submit`), у оригинала попап только импортирует контакт и закрывается
// (`createContact.tsx:53-66`) — чат здесь не открывается (`onCreated` пуст), контакт появляется
// в списке событием `contacts_update`.
import { openPopup } from '@stores/popupStore'
import NewContactPopup from '@components/NewContactPopup'

export default function showCreateContactPopup(): void {
  openPopup((p) => (
    <NewContactPopup open={p.open} onClose={p.requestClose} onExitComplete={p.onExitComplete} onCreated={() => {}} />
  ))
}
