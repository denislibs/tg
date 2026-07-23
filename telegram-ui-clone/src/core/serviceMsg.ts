// src/core/serviceMsg.ts
// Сервисные сообщения групп: бэкенд хранит в text JSON-действие (зеркало
// tweb messageAction — данные, а не готовая фраза), клиент собирает локализованный
// текст пилюли. Тот же приём, что у лога звонков (parseCallLog).

interface ServiceAction {
  action: string
  actor?: string
  user?: string
  ttl?: number
  /** название канала (предложка постов: suggest_post_approved/rejected) */
  chat?: string
}

// Тексты — как в официальном ru-паке Telegram (ActionCreateGroup/ActionAddUser/…).
// out — сообщение отправлено текущим пользователем (для формулировок «Вы …»).
export function serviceMsgText(raw: string, out?: boolean): string {
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
    // Предложение фото профиля (tweb messageActionSuggestProfilePhoto).
    case 'suggest_photo':
      return out
        ? `Вы предложили установить это фото профиля`
        : `${actor} предлагает вам установить это фото профиля`
    // Решение по предложенному посту (Telegram suggested posts).
    case 'suggest_post_approved':
      return a.chat
        ? `Ваш предложенный пост одобрен в канале «${a.chat}»`
        : `Ваш предложенный пост одобрен`
    case 'suggest_post_rejected':
      return a.chat
        ? `Ваш предложенный пост отклонён в канале «${a.chat}»`
        : `Ваш предложенный пост отклонён`
    case 'group_create': return `${actor} создал(а) группу`
    case 'add_user': return `${actor} добавил(а) ${user}`
    case 'kick_user': return `${actor} удалил(а) ${user}`
    case 'leave': return `${actor} покинул(а) группу`
    case 'joined_by_link': return `${actor} присоединился(ась) к группе по ссылке-приглашению`
    case 'edit_photo': return `${actor} обновил(а) фото группы`
    case 'edit_title': return `${actor} изменил(а) название группы`
    case 'set_ttl':
      return a.ttl
        ? `${actor} включил(а) автоудаление сообщений через ${ttlLabel(a.ttl)}`
        : `${actor} отключил(а) автоудаление сообщений`
    default: return raw
  }
}

// «1 день / 1 неделю / 1 месяц / N дней» — для пилюли set_ttl.
export function ttlLabel(seconds: number): string {
  const d = Math.round(seconds / 86400)
  if (d >= 28 && d <= 31) return '1 месяц'
  if (d === 7) return '1 неделю'
  if (d === 1) return '1 день'
  if (d >= 1) {
    const m10 = d % 10, m100 = d % 100
    const word = m10 === 1 && m100 !== 11 ? 'день' : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? 'дня' : 'дней'
    return `${d} ${word}`
  }
  return `${seconds} сек`
}
