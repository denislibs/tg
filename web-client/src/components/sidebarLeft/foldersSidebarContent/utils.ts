/**
 * Порт tweb `components/sidebarLeft/foldersSidebarContent/utils.ts` (812502980).
 *
 * Расхождения:
 *  1. Флагов типов у нашей `Folder` пять (`contacts`/`nonContacts`/`groups`/
 *     `broadcasts`/`bots`) — те же, что `pFlags` оригинала, плоскими полями.
 *  2. `iconDocId` нет (кастомных эмодзи в названии нет — шапка `types.ts`);
 *     `dontAnimate` (`pFlags.title_noanimate`) — всегда `false`: флага на проводе нет.
 */
import { ALL_FOLDER_ID } from '@core/folderIds'
import type { Folder } from '@core/managers/foldersManager'
import type { IconName } from '@core/tgico-icons'
import { i18n } from '@lib/langPack'
import type { FolderItemPayload } from '@components/sidebarLeft/foldersSidebarContent/types'
import extractEmojiFromFilterTitle, { type ExtractEmojiFromFilterTitleResult } from '@components/sidebarLeft/foldersSidebarContent/extractEmojiFromFilterTitle'

export function getFolderTitle(filter: Folder) {
  let cleanTitle: ExtractEmojiFromFilterTitleResult | undefined

  const titleRest = filter.id === ALL_FOLDER_ID ? {
    name: i18n('FilterAllChats'),
  } : {
    title: (cleanTitle = extractEmojiFromFilterTitle(filter.title)).text,
  }

  const iconRest: Pick<FolderItemPayload, 'emojiIcon'> = {
    emojiIcon: cleanTitle?.emoji,
  }

  return {
    icon: getIconForFilter(filter),
    ...titleRest,
    ...iconRest,
    dontAnimate: false, // расхождение 2
  }
}

export function getIconForFilter(filter: Folder): IconName {
  if(filter.id === ALL_FOLDER_ID) return 'round_chats_filled'
  const matchedIcons: IconName[] = []

  if(filter.contacts) matchedIcons.push('person_filled')
  if(filter.bots) matchedIcons.push('bot_filled')
  if(filter.broadcasts) matchedIcons.push('channel_filled')
  if(filter.groups) matchedIcons.push('group_filled')
  if(filter.nonContacts) matchedIcons.push('noncontacts')

  if(matchedIcons.length === 1) return matchedIcons[0]
  return 'limit_folders'
}
