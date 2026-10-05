/**
 * Порт tweb `src/components/sidebarRight/tabs/attachAdminRightsCaption.ts:1-28`
 * (812502980) — подпись секции прав админа во вкладке прав участника
 * (`chatUserPermissions.solid.tsx`): «админ может назначать админов» /
 * «не может» / «вы не можете править этого админа». Дословно.
 */
import type { ChatAdministratorRights } from './groupPermissions/sharedPermissions'
import type ListenerSetter from '@helpers/listenerSetter'
import { i18n } from '@lib/langPack'

export default function attachAdminRightsCaption(options: {
  /** The section's caption element, rewritten whenever the add-admins right flips. */
  caption: HTMLElement,
  permissions: ChatAdministratorRights,
  canEdit: boolean,
  listenerSetter: ListenerSetter
}) {
  const field = options.permissions.fields.find(
    (field) => field.flags[0] === 'add_admins',
  )!
  const update = () => {
    options.caption.replaceChildren(i18n(
      options.canEdit ?
        (field.checkboxField!.checked ?
          'Channel.Admin.AdminAccess' :
          'Channel.Admin.AdminRestricted') :
        'EditAdminCantEdit',
    ))
  }

  update()
  options.listenerSetter.add(field.checkboxField!.input)('change', update)
}
