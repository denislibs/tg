// Инвайт-ссылка группы/канала БЕЗ публичного username (tweb `PeerProfile.Link`,
// ветка `exported_invite` `:999-1004`).
//
// История: НАХОДКА РЕВЬЮ (Critical, финальный раунд Task 4 плана
// docs/superpowers/plans/2026-09-05-profile-card-solid.md) — панель рисовала
// ДВЕ строки ссылки одновременно (React-фолбэк инвайта в `UserInfoPanel.tsx`
// и Solid-`Link`), потому что React-гейт читал мёртвое поле `chat.username`.
// Фикс тогда свёл оба гейта к одному предикату `isPublic` над зеркалом пиров.
//
// Задача 13 плана shared media убрала и второе место: React-фолбэк стоял
// сиблингом ПОСЛЕ Solid-корня и оказывался под absolute-узлом шаред-медиа
// (`.search-super`, `top: 100%` от `.profile-content`) — строка была не видна
// под липким рядом вкладок. Теперь строку целиком рисует Solid-`Link`
// (обе ветки оригинала), а панель отдаёт ей только URL живым пропом
// `exportedInviteUrl` из `buildProfilePatch`. Поведение самой строки —
// `peerProfileMainSection.solid.test.tsx` (describe «Link»); здесь — пин, что
// панель НЕ вернула второй гейт и что проп едет через патч (иначе Solid
// никогда не увидит ссылку, созданную лениво после первого рендера).
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const panel = readFileSync(join(__dirname, 'UserInfoPanel.tsx'), 'utf8')

describe('UserInfoPanel — инвайт-ссылка живёт в Solid-Link, а не React-фолбэком', () => {
  it('React-фолбэка нет: ни гейта isPublicPeer, ни строки SetUrlPlaceholder, ни SidebarSection', () => {
    expect(panel).not.toMatch(/fallbackInviteUrl/)
    expect(panel).not.toMatch(/isPublicPeer\(/)
    expect(panel).not.toMatch(/SetUrlPlaceholder/)
    expect(panel).not.toMatch(/<SidebarSection/)
  })

  it('URL инвайта едет в Solid живым пропом exportedInviteUrl из buildProfilePatch, deps апдейта включают inviteLinks', () => {
    const patchStart = panel.indexOf('const buildProfilePatch = () => (')
    const patchEnd = panel.indexOf('})', patchStart)
    const patch = panel.slice(patchStart, patchEnd)
    expect(patch).toMatch(/exportedInviteUrl:\s*inviteLinks\[0\]\s*\?\s*`\$\{location\.origin\}\/join\/\$\{inviteLinks\[0\]\.token\}`\s*:\s*undefined/)
    const updateIdx = panel.indexOf('profileUpdateRef.current?.(buildProfilePatch())')
    const deps = panel.slice(panel.indexOf('}, [', updateIdx), panel.indexOf('])', updateIdx))
    expect(deps, 'без inviteLinks в deps ссылка, созданная лениво, не доедет до Solid').toMatch(/\binviteLinks\b/)
  })
})
