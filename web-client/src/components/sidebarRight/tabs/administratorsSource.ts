/**
 * Порт tweb `src/components/sidebarRight/tabs/administratorsSource.ts:1-44`
 * (812502980) — контракт источника вкладки «Администраторы»
 * (`chatAdministrators.solid.tsx`): у оригинала источников два — чат и
 * сообщество; сообществ у нас нет (О-5), источник один —
 * `chatAdministratorsSource.ts`. Участник — конструктор провода
 * (`core/peers/participant.ts`, базовых групп нет); `MaybePromise` — `@types`.
 * «Антиспама» (`AdministratorsAntiSpam`, поле `antiSpam`) нет на бэкенде (Б-116).
 */
import type AppSelectPeers from '@components/appSelectPeers.solid'
import type { ChannelParticipant } from '@core/peers/participant'
import type { AppChatAdministratorsTab } from '@components/solidJsTabs/tabs'
import type { createSelectorForTab } from './participantsSelector'
import type { MaybePromise } from '@types'

export type AdministratorParticipant = ChannelParticipant
export type AdministratorsTab = InstanceType<typeof AppChatAdministratorsTab>
export type AdministratorsSelectorOptions = ConstructorParameters<
  typeof AppSelectPeers
>[0]
export type AdministratorsSelectorResult = ReturnType<
  typeof createSelectorForTab
>

export type OpenAdministratorPermissionsOptions = {
  participantId: PeerId,
  participant?: AdministratorParticipant,
  onUpdated: (
    participant?: ChannelParticipant,
  ) => MaybePromise<void>
}

export type AdministratorsSource = {
  canAddAdmins: boolean,
  createSelector: (
    options: AdministratorsSelectorOptions,
  ) => AdministratorsSelectorResult,
  openAddAdmin: (
    openPermissions: (
      participantOrPeerId: AdministratorParticipant | PeerId,
    ) => void,
  ) => void,
  openPermissions: (
    options: OpenAdministratorPermissionsOptions,
  ) => void,
  attachSelectorBehavior?: (selector: AppSelectPeers) => void
}
