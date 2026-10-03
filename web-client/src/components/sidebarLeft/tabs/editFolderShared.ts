// Порт tweb `src/components/sidebarLeft/tabs/editFolderShared.ts:1-41`
// (812502980) — то, что у вкладки редактора папки зовут снаружи:
// `getEditFolderInitArgs` (предзагрузка заставки `Folders_2`, `:7-11`; её
// отдают `createTab(AppEditFolderTab).open(...)` список папок и меню папки) и
// `deleteFolder` (`:13-40`: подтверждение «Remove Folder» и удаление; зовут меню
// папки `createFolderContextMenu.ts:63` через `AppEditFolderTab.deleteFolder` и
// пункт «Delete Folder» меню ⋮ редактора, `editFolder.tsx:274-293`).
//
// Сверх оригинала здесь же — `FOLDER_PFLAGS`: соответствие имён флагов tweb
// (`DialogFilter.pFlags`) полям нашей `Folder` (`core/managers/foldersManager.ts`).
// Имена tweb ключуют кнопки категорий и в редакторе, и в выборе чатов
// (`includedChats.tsx:57-72`, `data-peer-id`), а поле — плоское у нас. И
// `inviteUrl`: полный адрес ссылки-приглашения — у tweb `chatlistInvite.url`
// уже полный (`t.me/addlist/<slug>`), у нас сервер отдаёт путь (`/addlist/<slug>`)
// на хосте ссылок (`core/publicLink`); нужен редактору и вкладке ссылки
// (`sharedFolder.solid.tsx`). Открывает его `internalLinkProcessor` (`addlist`).
//
// Адаптации (каждая — из-за отсутствующей у нас подсистемы):
//   • ветка shared-папки (`:16-23`: `dialogFilterChatlist` без своих ссылок →
//     `PopupSharedFolderInvite` с `deleting`) и описание `RemoveSharedFolder`
//     при `has_my_invites` (`:27`) не портированы — у нашей `Folder` на проводе
//     нет ни типа chatlist, ни флага своих ссылок; описание всегда
//     `ChatList.Filter.Confirm.Remove.Text`;
//   • `filtersStorage.getFilter` (`:15`) не нужен — читался только для этих
//     двух веток;
//   • `filtersStorage.updateDialogFilter({id}, true)` (`filters.ts:338-347`:
//     запрос, ПОСЛЕ ответа — удаление из хранилища) → `managers.folders.del(id)`,
//     затем `foldersStore.remove(id)`: папки на главном потоке держит
//     `appState.folders`;
//   • `rootScope.managers` → параметр `managers`: DI-ручки у нас нет вне React;
//   • `getEditFolderInitArgs`: промис заставки помечен обработанным
//     (`catch(noop)` на производном) — у нас `loadAnimationFromURLManually`
//     отклоняется сразу без WASM SIMD (`NO_WASM`), и отказ до того, как вкладка
//     подпишется на него, был бы «необработанным»; вкладка сама ставит статичный
//     кадр (`renderStaticAssetFallback`). У tweb отказа нет.
//
// Отказ в подтверждении, как у tweb, — отклонённое обещание (`confirmationPopup`
// `reject()`): гасит его вызывающий.
import { confirmationPopup } from '@components/popups/popupPeer'
import { useFoldersStore } from '@stores/foldersStore'
import lottieLoader, { type LottieAssetName } from '@lib/lottie/lottieLoader'
import noop from '@helpers/noop'
import type { Folder, FolderInvite } from '@core/managers/foldersManager'
import type { Managers } from '@/client/bootstrap'
import { publicLinkFromTelegramPath } from '@core/publicLink'

/** Полный адрес ссылки-приглашения в папку (сервер отдаёт путь на хосте ссылок). */
export const inviteUrl = (invite: FolderInvite) => publicLinkFromTelegramPath(invite.url.replace(/^\/+/, ''))

/** Ручки, которыми удаляется папка. */
export type EditFolderManagers = {
  folders: Pick<Managers['folders'], 'del'>
}

/**
 * Имена флагов tweb (`DialogFilter.dialogFilter['pFlags']`) → поле `Folder`.
 * `exclude_archived` нет (О-21 плана 2D): флага нет ни в модели, ни на проводе.
 */
export const FOLDER_PFLAGS = {
  contacts: 'contacts',
  non_contacts: 'nonContacts',
  groups: 'groups',
  broadcasts: 'broadcasts',
  bots: 'bots',
  exclude_muted: 'excludeMuted',
  exclude_read: 'excludeRead',
} as const satisfies Record<string, keyof Folder>

export type FolderPFlag = keyof typeof FOLDER_PFLAGS

/** Лотти-заставка вкладки папок, загруженная заранее (`loadAnimationFromURLManually`). */
export function preloadFolderAnimation(name: LottieAssetName) {
  const animationData = lottieLoader.loadAnimationFromURLManually(name)
  animationData.catch(noop)
  return animationData
}

export function getEditFolderInitArgs() {
  return {
    animationData: preloadFolderAnimation('Folders_2'),
  }
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
