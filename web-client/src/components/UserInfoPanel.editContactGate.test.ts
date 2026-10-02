// Карандаш профиля пользователя (вход во вкладку «Изменить контакт») — только
// у КОНТАКТА: tweb 812502980 `sharedMedia.tsx::toggleEditBtn`
// (`show = peerId !== myId && appUsersManager.canEdit(userId)`, canEdit —
// `appUsersManager.ts:925-927`: себя || isContact || `bot_can_edit`), с
// перечитыванием на `contacts_update` (`sharedMedia.tsx:705-709`). Прежде
// карандаш стоял у любого собеседника и для не-контакта открывал вкладку в
// режиме «Добавить в контакты» — входа, которого у оригинала в профиле нет.
//
// Пин текстовый по основанию `UserInfoPanel.shell.test.ts` (панель тянет
// портал, менеджеры и полдюжины сторов); поведение самого ответа «контакт
// ли» — `core/hooks/useIsContact.test.tsx`.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const panel = readFileSync(join(__dirname, 'UserInfoPanel.tsx'), 'utf8')

describe('UserInfoPanel — карандаш «Изменить контакт» только у контакта', () => {
  it('ответ берётся портом isContact (useIsContact) по ключу пира', () => {
    expect(panel).toMatch(/const isContact = useIsContact\(peerId\)/)
  })

  it('гейт карандаша — isContact === true, а не «любой пользователь, кроме себя»', () => {
    const btn = panel.indexOf('<IconButton onClick={onEditContact}>')
    expect(btn).toBeGreaterThan(0)
    const gate = panel.slice(panel.lastIndexOf('{', btn), btn)
    expect(gate).toMatch(/isUser && peerId !== meId && isContact === true && onEditContact/)
  })
})
