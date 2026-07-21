import { describe, it, expect } from 'vitest'
import { serviceMsgText } from './serviceMsg'

// Бэк хранит сервисное действие как JSON (зеркало tweb messageAction); клиент
// собирает локализованную пилюлю. Проверяем разбор ключевых действий.
const raw = (action: string, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ action, actor: 'Алиса', ...extra })

describe('serviceMsgText', () => {
  it('renders joined_by_link (вступление по инвайт-ссылке)', () => {
    expect(serviceMsgText(raw('joined_by_link'))).toBe(
      'Алиса присоединился(ась) к группе по ссылке-приглашению',
    )
  })

  it('renders edit_photo pill (media rides on media_id, not the text)', () => {
    expect(serviceMsgText(raw('edit_photo'))).toBe('Алиса обновил(а) фото группы')
  })

  it('renders group lifecycle actions', () => {
    expect(serviceMsgText(raw('group_create'))).toBe('Алиса создал(а) группу')
    expect(serviceMsgText(raw('add_user', { user: 'Боб' }))).toBe('Алиса добавил(а) Боб')
    expect(serviceMsgText(raw('leave'))).toBe('Алиса покинул(а) группу')
  })

  it('passes through plain (non-JSON) service strings untouched', () => {
    expect(serviceMsgText('Сообщения зашифрованы')).toBe('Сообщения зашифрованы')
  })

  it('returns raw for an unknown action', () => {
    const r = raw('totally_unknown')
    expect(serviceMsgText(r)).toBe(r)
  })
})
