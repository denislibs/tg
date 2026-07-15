// src/core/serviceMsg.ts
// Сервисные сообщения групп: бэкенд хранит в text JSON-действие (зеркало
// tweb messageAction — данные, а не готовая фраза), клиент собирает локализованный
// текст пилюли. Тот же приём, что у лога звонков (parseCallLog).

interface ServiceAction {
  action: string
  actor?: string
  user?: string
}

// Тексты — как в официальном ru-паке Telegram (ActionCreateGroup/ActionAddUser/…).
export function serviceMsgText(raw: string): string {
  if (!raw.startsWith('{')) return raw // локальные сервисные строки (уже готовый текст)
  let a: ServiceAction
  try {
    a = JSON.parse(raw) as ServiceAction
  } catch {
    return raw
  }
  const actor = a.actor || 'Пользователь'
  const user = a.user || 'пользователя'
  switch (a.action) {
    case 'group_create': return `${actor} создал(а) группу`
    case 'add_user': return `${actor} добавил(а) ${user}`
    case 'kick_user': return `${actor} удалил(а) ${user}`
    case 'leave': return `${actor} покинул(а) группу`
    case 'edit_photo': return `${actor} обновил(а) фото группы`
    default: return raw
  }
}
