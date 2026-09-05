// Пин Task 5 (план «карточка профиля на Solid», docs/superpowers/plans/
// 2026-09-05-profile-card-solid.md, «Задача 5»), переписан под контракт
// задачи 5.5 («живые пропы в мосте React→Solid»): гейты и данные наших секций
// (Statistics/Discussion/JoinRequests/EncryptionKey) БОЛЬШЕ НЕ уезжают в
// deps структурного эффекта (`mountSolid` пересоздаёт корень ТОЛЬКО на
// `peerId`/`searchSuperContainer`/`avatarsInfoEl` — докблок эффекта в файле),
// а едут в общий строитель `buildProfilePatch()`, который вызывают ОБА
// эффекта: структурный (на маунте, через `...buildProfilePatch()`) и
// отдельный эффект апдейта (`profileUpdateRef.current?.(buildProfilePatch())`).
//
// Предупреждение брифа этой волны живо и здесь, просто переехало на другой
// эффект: два Critical до задачи 5 были ИМЕННО из-за поля вью-модели без
// писателя (в проекте) — здесь риск СИММЕТРИЧНЫЙ: поле С писателем
// (`useGroupInfo.ts`, реальные `useState`), но БЕЗ него в deps эффекта
// апдейта, который решает, когда Solid увидит новое значение. Такой баг не
// ловит тайпчек (типы совпадают) и не ловит рендер-тест `.solid.tsx` (там
// гейт читается напрямую из пропа, без эффекта) — только явная проверка
// ТЕКСТА deps-массива. Панель нерендерибельна в vitest целиком (портал,
// менеджеры, полдюжины сторов — то же основание, что у `UserInfoPanel.
// shell.test.ts`/`linkGate.test.ts`), поэтому пин — тот же приём, что у
// `linkGate.test.ts`: извлечь statement из РЕАЛЬНОГО файла и проверить его
// текст.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const panel = readFileSync(join(__dirname, 'UserInfoPanel.tsx'), 'utf8')

/** Тело `const buildProfilePatch = () => ({ … })` — от начала объявления до
 *  закрывающей `})` литерала (баланс скобок, а не индекс до случайной точки
 *  дальше по файлу: тот же приём, что `extractBraceBalanced` в
 *  `UserInfoPanel.shell.test.ts`). Единственное объявление в файле — маркер
 *  однозначен. */
function extractBuildProfilePatch(src: string): string {
  const start = src.indexOf('const buildProfilePatch = () => (')
  if (start === -1) throw new Error('const buildProfilePatch = () => ({…}) не найден')
  const braceStart = src.indexOf('{', start)
  if (braceStart === -1) throw new Error('открывающая { тела buildProfilePatch не найдена')
  let depth = 0
  for (let i = braceStart; i < src.length; i++) {
    if (src[i] === '{') depth++
    else if (src[i] === '}') {
      depth--
      if (depth === 0) return src.slice(start, i + 1)
    }
  }
  throw new Error('не сбалансированы скобки тела buildProfilePatch')
}

/** Deps-массив эффекта АПДЕЙТА — единственный `useLayoutEffect`, чьё тело
 *  зовёт `profileUpdateRef.current?.(buildProfilePatch())` (маркер
 *  однозначен: структурный эффект зовёт `mountSolid`, этот — только апдейт). */
function extractUpdateEffectDeps(src: string): string {
  const marker = 'profileUpdateRef.current?.(buildProfilePatch())'
  const callIdx = src.indexOf(marker)
  if (callIdx === -1) throw new Error('profileUpdateRef.current?.(buildProfilePatch()) не найден')
  const depsStart = src.indexOf('}, [', callIdx)
  if (depsStart === -1) throw new Error('deps-массив эффекта апдейта не найден')
  const closingBracket = src.indexOf('])', depsStart)
  if (closingBracket === -1) throw new Error('закрывающая `])` deps-массива не найдена')
  return src.slice(depsStart, closingBracket + 2)
}

describe('UserInfoPanel — buildProfilePatch (Task 5, проводка секций к Solid-корню через update)', () => {
  const patch = extractBuildProfilePatch(panel)

  it('showStatistics — свёрнутый предикат isRealChat && isChannel && canViewStats', () => {
    expect(patch).toMatch(/showStatistics:\s*isRealChat && isChannel && canViewStats/)
  })

  it('showDiscussion — свёрнутый предикат isRealChat && isChannel && canManageDiscussion', () => {
    expect(patch).toMatch(/showDiscussion:\s*isRealChat && isChannel && canManageDiscussion/)
  })

  it('showJoinRequests — свёрнутый предикат isRealChat && canInvite', () => {
    expect(patch).toMatch(/showJoinRequests:\s*isRealChat && canInvite/)
  })

  it('joinRequests/discussionPeerId/enablingDiscussion/isSecret едут пропом БЕЗ переименования', () => {
    expect(patch).toMatch(/\bjoinRequests,/)
    expect(patch).toMatch(/\bdiscussionPeerId,/)
    expect(patch).toMatch(/\benablingDiscussion,/)
    expect(patch).toMatch(/\bisSecret,/)
  })

  it('onOpenStatistics/onEnableDiscussion/onApprove·DeclineJoinRequest/onOpenEncryptionKey замкнуты на реальные экшены useGroupInfo', () => {
    expect(patch).toMatch(/onOpenStatistics:\s*\(\)\s*=>\s*setShowStats\(true\)/)
    expect(patch).toMatch(/onEnableDiscussion:\s*\(\)\s*=>\s*void enableDiscussion\(\)/)
    expect(patch).toMatch(/onApproveJoinRequest:\s*\(userId[^)]*\)\s*=>\s*void approveJoinRequest\(userId\)/)
    expect(patch).toMatch(/onDeclineJoinRequest:\s*\(userId[^)]*\)\s*=>\s*void declineJoinRequest\(userId\)/)
    expect(patch).toMatch(/onOpenEncryptionKey:\s*\(\)\s*=>\s*setKeyPopupOpen\(true\)/)
  })

  // Находка, которую этот пин обязан ловить: асинхронные поля useGroupInfo
  // (canViewStats/canManageDiscussion/discussionPeerId/enablingDiscussion/
  // canInvite/joinRequests) и isSecret должны быть в deps-массиве ЭФФЕКТА
  // АПДЕЙТА — иначе живой Solid-корень навсегда видит значения самого первого
  // прогона (см. докблок эффекта, «Гейты/данные Task 5 — НЕ производные…»).
  const updateDeps = extractUpdateEffectDeps(panel)
  it.each([
    'isRealChat', 'isChannel', 'canViewStats', 'canManageDiscussion',
    'discussionPeerId', 'enablingDiscussion', 'canInvite', 'joinRequests', 'isSecret',
  ])('deps-массив эффекта апдейта включает %s', (name) => {
    expect(updateDeps).toMatch(new RegExp(`\\b${name}\\b`))
  })

  // Симметричная проверка: НИ ОДНО из этих полей не должно сидеть в deps
  // СТРУКТУРНОГО эффекта (который зовёт mountSolid и пересоздаёт корень) —
  // иначе задача 5.5 не сделана, приход данных снова пересоздаёт дерево.
  function extractMountEffectDeps(src: string): string {
    const callIdx = src.indexOf('mountSolid<PeerProfileProps>(host, PeerProfile')
    if (callIdx === -1) throw new Error('mountSolid<PeerProfileProps>(host, PeerProfile, {…}) не найден')
    const depsStart = src.indexOf('}, [', callIdx)
    if (depsStart === -1) throw new Error('deps-массив структурного эффекта не найден')
    const closingBracket = src.indexOf('])', depsStart)
    if (closingBracket === -1) throw new Error('закрывающая `])` deps-массива не найдена')
    return src.slice(depsStart, closingBracket + 2)
  }
  const mountDeps = extractMountEffectDeps(panel)

  it('deps-массив структурного эффекта — ТОЛЬКО peerId/searchSuperContainer/avatarsInfoEl', () => {
    expect(mountDeps).toMatch(/\[peerId, searchSuperContainer, avatarsInfoEl\]/)
  })

  it.each([
    'isRealChat', 'isChannel', 'canViewStats', 'canManageDiscussion',
    'discussionPeerId', 'enablingDiscussion', 'canInvite', 'joinRequests', 'isSecret',
  ])('deps-массив структурного эффекта НЕ включает %s (иначе приход данных снова пересоздаёт корень)', (name) => {
    expect(mountDeps).not.toMatch(new RegExp(`\\b${name}\\b`))
  })
})
