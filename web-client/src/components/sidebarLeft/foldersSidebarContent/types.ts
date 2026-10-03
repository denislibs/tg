/**
 * Порт tweb `components/sidebarLeft/foldersSidebarContent/types.ts` (812502980).
 *
 * Расхождение: `iconDocId` (кастомный эмодзи-документ из названия) и `title` как
 * `TextWithEntities` не заводятся — на проводе `Folder.title` у нас строка без
 * сущностей (`core/managers/foldersManager.ts`), поэтому `title` — строка, а
 * иконкой из названия может быть только юникод-эмодзи (`emojiIcon`).
 */
import type { JSX } from 'solid-js'
import type { IconName } from '@core/tgico-icons'
import type { StoredFolder } from '@stores/folders.solid'

export type FolderItemPayload = Partial<StoredFolder> & {
  icon: IconName,
  emojiIcon?: string,
  dontAnimate?: boolean,
  name?: JSX.Element,
  title?: string
}
