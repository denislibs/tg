/**
 * Порт tweb `src/components/sidebarRight/tabs/removedUsersSource.ts:1-30`
 * (812502980) — контракт источника вкладки «Удалённые» (`removedUsers.solid.tsx`).
 * Источник один — чат (`chatRemovedUsersSource.ts`): сообществ нет (О-5).
 * Участник — конструктор провода (`core/peers/participant.ts`).
 */
import type AppSelectPeers from '@components/appSelectPeers.solid'
import type { ChannelParticipant } from '@core/peers/participant'
import type { LangPackKey } from '@lib/langPack'
import type { AppRemovedUsersTab } from '@components/solidJsTabs/tabs'
import type { createSelectorForTab } from './participantsSelector'

export type RemovedUsersTab = InstanceType<typeof AppRemovedUsersTab>
export type RemovedUsersSelectorOptions = ConstructorParameters<
  typeof AppSelectPeers
>[0]
export type RemovedUsersSelectorResult = ReturnType<
  typeof createSelectorForTab
>

export const isRemovedParticipant = (
  participant?: ChannelParticipant,
): participant is Extract<ChannelParticipant, { _: 'channelParticipantBanned' }> => {
  return participant?._ === 'channelParticipantBanned' &&
    !!participant.pFlags?.left
}

export type RemovedUsersSource = {
  canChangePermissions: boolean,
  caption: LangPackKey,
  createSelector: (
    options: RemovedUsersSelectorOptions,
  ) => RemovedUsersSelectorResult,
  openAddParticipant: () => void,
  attachSelectorBehavior: (selector: AppSelectPeers) => void
}
