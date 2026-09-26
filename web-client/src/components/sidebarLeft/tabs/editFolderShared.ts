// Порт tweb `src/components/sidebarLeft/tabs/editFolderShared.ts:14-41` —
// `deleteFolder`: подтверждение «Remove Folder» и удаление папки. У tweb его
// зовут меню папки (`createFolderContextMenu.ts:63` через
// `AppEditFolderTab.deleteFolder`, `solidJsTabs/tabs.ts:628-640`) и кнопка
// «Delete Folder» редактора (`editFolder.tsx:274-293`); у нас — пока только
// меню: в React-редакторе `FolderEditor.tsx` такой кнопки нет.
//
// Адаптации (каждая — из-за отсутствующей у нас подсистемы):
//   • ветка shared-папки (`:16-23`: `dialogFilterChatlist` без своих ссылок →
//     `PopupSharedFolderInvite` с `deleting`) и описание `RemoveSharedFolder`
//     при `has_my_invites` (`:27`) не портированы — у нашей `Folder` на проводе
//     нет ни типа chatlist, ни флага своих ссылок (`core/managers/foldersManager.ts`);
//     описание всегда `ChatList.Filter.Confirm.Remove.Text`;
//   • `filtersStorage.getFilter` (`:15`) не нужен — читался только для этих
//     двух веток;
//   • `filtersStorage.updateDialogFilter({id}, true)` (`filters.ts:338-347`:
//     запрос, ПОСЛЕ ответа — `onUpdateDialogFilter` без фильтра, то есть
//     удаление из хранилища) → `managers.folders.del(id)`, затем
//     `foldersStore.remove(id)`: папки на главном потоке держит `appState.folders`;
//   • `rootScope.managers` → параметр `managers`: DI-ручки у нас нет вне React;
//   • `getEditFolderInitArgs` (`:8-12`, предзагрузка анимации `Folders_2`) не
//     портирован — редактор папки React (`FolderEditor.tsx`) грузит её сам.
//
// Отказ в подтверждении, как у tweb, — отклонённое обещание (`confirmationPopup`
// `reject()`): гасит его вызывающий.
import { confirmationPopup } from '@components/popups/popupPeer'
import { useFoldersStore } from '@stores/foldersStore'
import type { Managers } from '@/client/bootstrap'

/** Ручки, которыми удаляется папка. */
export type EditFolderManagers = {
  folders: Pick<Managers['folders'], 'del'>
}

export async function deleteFolder(managers: EditFolderManagers, filterId: number) {
  await confirmationPopup({
    titleLangKey: 'ChatList.Filter.Confirm.Remove.Header',
    descriptionLangKey: 'ChatList.Filter.Confirm.Remove.Text',
    button: {
      langKey: 'Delete',
      isDanger: true,
    },
  })

  await managers.folders.del(filterId)
  useFoldersStore.getState().remove(filterId)
}
