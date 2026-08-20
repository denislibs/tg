// PermissionsScreen — экран прав группы (tweb `sidebarRight/tabs/groupPermissions`).
// Пин держит форму строк из живого дампа
// `docs/tweb/dom/dumps/15-right-13-group-permissions`:
//   label.row.no-subtitle.row-with-toggle.row-clickable.hover-effect.rp
//     > div.c-ripple
//     + div.row-row.row-title-row
//         > div.row-title
//         + div.row-title.row-title-right
//             > label.checkbox-field.checkbox-without-caption
//                    .checkbox-field-toggle.checkbox-field-toggle-restriction
//                 > input.checkbox-field-input + div.checkbox-toggle > div.checkbox-toggle-circle
// Именно `restriction` отличает эти строки от обычного тумблера: снятое право
// в tweb красное (--danger-color), а не серое.
import { render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { PermissionsScreen } from './PermissionsScreen'
import { PERMS } from '../../../core/hooks/useGroupEdit'
import type { GroupEdit } from '../../../core/hooks/useGroupEdit'

// Экран читает у `GroupEdit` только карточку и два сохранения — остальное
// заглушаем через прокси, чтобы не тащить весь интерфейс менеджера.
function makeGroupEdit(over: Partial<GroupEdit>): GroupEdit {
  return new Proxy({ ...over } as GroupEdit, {
    get: (target, prop: string) => (prop in target ? target[prop as keyof GroupEdit] : vi.fn()),
  })
}

// ⚠ ПОЛЯРНОСТЬ: `default_banned_rights` это ЧТО НЕЛЬЗЯ. Здесь запрещены
// send_media / pin_messages / change_info, значит РАЗРЕШЕНЫ send_messages (1) и
// invite_users (4) — тот же набор, что раньше выражался `defaultPermissions: 5`.
const g = makeGroupEdit({
  card: {
    chat: {
      _: 'channel', id: 1, title: 'G', photo: { _: 'chatPhotoEmpty' }, date: 0,
      pFlags: { megagroup: true },
      default_banned_rights: {
        _: 'chatBannedRights',
        pFlags: { send_media: true, pin_messages: true, change_info: true },
        until_date: 0,
      },
    },
    fullChat: {
      _: 'channelFull', id: 1, about: '',
      read_inbox_max_id: 0, read_outbox_max_id: 0, unread_count: 0, chat_photo: null,
    },
    peerId: -1, creatorId: 0,
  },
  isCreator: false,
})

describe('PermissionsScreen — разметка строк прав 1:1 с tweb', () => {
  it('каждое право — label.row.row-with-toggle с тумблером-ограничением', () => {
    const { container } = render(<PermissionsScreen g={g} onBack={() => {}} />)
    const rows = Array.from(container.querySelectorAll<HTMLElement>('.row.row-with-toggle'))
    expect(rows).toHaveLength(PERMS.length)

    for (const r of rows) {
      expect(r.tagName).toBe('LABEL')
      expect(r.classList.contains('no-subtitle')).toBe(true)
      expect(r.classList.contains('row-clickable')).toBe(true)
      expect(r.classList.contains('hover-effect')).toBe(true)
      expect(r.classList.contains('rp')).toBe(true)
      expect(r.firstElementChild!.className).toBe('c-ripple')

      const titleRow = r.querySelector<HTMLElement>('.row-row.row-title-row')!
      const right = titleRow.querySelector<HTMLElement>('.row-title.row-title-right')!
      const field = right.querySelector<HTMLElement>('label.checkbox-field')!
      expect(field.classList.contains('checkbox-field-toggle')).toBe(true)
      expect(field.classList.contains('checkbox-field-toggle-restriction')).toBe(true)
      expect(field.querySelector('div.checkbox-toggle > div.checkbox-toggle-circle')).not.toBeNull()
      // квадратного бокса у права быть не должно — это другая форма поля
      expect(field.querySelector('.checkbox-box')).toBeNull()
    }
  })

  it('состояние права едет в input.checked того же тумблера', () => {
    const { container } = render(<PermissionsScreen g={g} onBack={() => {}} />)
    const inputs = Array.from(
      container.querySelectorAll<HTMLInputElement>('.row-with-toggle input.checkbox-field-input'),
    )
    expect(inputs.map((i) => i.checked)).toEqual(PERMS.map((p) => (5 & p.bit) !== 0))
  })
})
