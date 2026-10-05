/** @jsxImportSource solid-js */
/**
 * Порт tweb `src/components/sidebarRight/tabs/userPermissions.tsx:1-15`
 * (812502980) — модуль вкладки `AppUserPermissionsTab`: у оригинала выбирает
 * между правами в чате и в сообществе по полезной нагрузке. Сообществ у нас
 * нет (О-5) — ветка одна, `chatUserPermissions.solid.tsx`.
 */
import type { Component } from 'solid-js'
import ChatUserPermissions from './chatUserPermissions.solid'

const UserPermissions: Component = () => {
  return <ChatUserPermissions />
}

export default UserPermissions
