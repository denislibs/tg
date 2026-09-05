// Пин Task 5 (план «карточка профиля на Solid», docs/superpowers/plans/
// 2026-09-05-profile-card-solid.md, «Задача 5»): гейты и данные наших секций
// (Statistics/Discussion/JoinRequests/EncryptionKey) едут в Solid-корень
// пропами `mountSolid`, а Solid-корень пересоздаётся ТОЛЬКО когда меняются
// deps этого `useLayoutEffect` (докблок моста `mountSolid`, «render»
// вызывается один раз на весь срок жизни корня — живых пропов нет).
//
// Предупреждение брифа этой волны: два Critical до этой задачи были ИМЕННО
// из-за поля вью-модели без писателя (в проекте) — здесь риск СИММЕТРИЧНЫЙ:
// поле С писателем (`useGroupInfo.ts`, реальные `useState`), но БЕЗ него в
// deps эффекта, который решает, когда Solid увидит новое значение. Такой
// баг не ловит тайпчек (типы совпадают) и не ловит рендер-тест `.solid.tsx`
// (там гейт читается напрямую из пропа, без эффекта) — только явная проверка
// ТЕКСТА deps-массива. Панель нерендерибельна в vitest целиком (портал,
// менеджеры, полдюжины сторов — то же основание, что у `UserInfoPanel.
// shell.test.ts`/`linkGate.test.ts`), поэтому пин — тот же приём, что у
// `linkGate.test.ts`: извлечь statement из РЕАЛЬНОГО файла и проверить его
// текст.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const panel = readFileSync(join(__dirname, 'UserInfoPanel.tsx'), 'utf8')

/** Весь `useLayoutEffect(() => { const host = profileContentHostRef... }, [...])`,
 *  который монтирует `PeerProfile` — от начала statement до закрывающей `])`
 *  этого конкретного эффекта (единственный вызов `mountSolid(host, PeerProfile`
 *  в файле — маркер однозначен). */
function extractMountEffect(src: string): string {
  const start = src.indexOf('const host = profileContentHostRef.current')
  if (start === -1) throw new Error('const host = profileContentHostRef.current не найден')
  const callStart = src.indexOf('mountSolid(host, PeerProfile', start)
  if (callStart === -1) throw new Error('mountSolid(host, PeerProfile, {…}) не найден')
  const end = src.indexOf('\n  }, [\n', callStart)
  if (end === -1) throw new Error('конец statement (маркер `}, [`) не найден')
  const closingBracket = src.indexOf('])', end)
  if (closingBracket === -1) throw new Error('закрывающая `])` deps-массива не найдена')
  return src.slice(start, closingBracket + 2)
}

describe('UserInfoPanel — проп/deps-проводка секций Task 5 к Solid-корню', () => {
  const stmt = extractMountEffect(panel)

  it('showStatistics — свёрнутый предикат isRealChat && isChannel && canViewStats', () => {
    expect(stmt).toMatch(/showStatistics:\s*isRealChat && isChannel && canViewStats/)
  })

  it('showDiscussion — свёрнутый предикат isRealChat && isChannel && canManageDiscussion', () => {
    expect(stmt).toMatch(/showDiscussion:\s*isRealChat && isChannel && canManageDiscussion/)
  })

  it('showJoinRequests — свёрнутый предикат isRealChat && canInvite', () => {
    expect(stmt).toMatch(/showJoinRequests:\s*isRealChat && canInvite/)
  })

  it('joinRequests/discussionPeerId/enablingDiscussion/isSecret едут пропом БЕЗ переименования', () => {
    expect(stmt).toMatch(/\bjoinRequests,/)
    expect(stmt).toMatch(/\bdiscussionPeerId,/)
    expect(stmt).toMatch(/\benablingDiscussion,/)
    expect(stmt).toMatch(/\bisSecret,/)
  })

  it('onOpenStatistics/onEnableDiscussion/onApprove·DeclineJoinRequest/onOpenEncryptionKey замкнуты на реальные экшены useGroupInfo', () => {
    expect(stmt).toMatch(/onOpenStatistics:\s*\(\)\s*=>\s*setShowStats\(true\)/)
    expect(stmt).toMatch(/onEnableDiscussion:\s*\(\)\s*=>\s*void enableDiscussion\(\)/)
    expect(stmt).toMatch(/onApproveJoinRequest:\s*\(userId\)\s*=>\s*void approveJoinRequest\(userId\)/)
    expect(stmt).toMatch(/onDeclineJoinRequest:\s*\(userId\)\s*=>\s*void declineJoinRequest\(userId\)/)
    expect(stmt).toMatch(/onOpenEncryptionKey:\s*\(\)\s*=>\s*setKeyPopupOpen\(true\)/)
  })

  // Находка, которую этот пин обязан ловить: асинхронные поля useGroupInfo
  // (canViewStats/canManageDiscussion/discussionPeerId/enablingDiscussion/
  // canInvite/joinRequests) и isSecret должны быть в deps-массиве ЭТОГО
  // эффекта — иначе Solid-корень навсегда видит значения самого первого
  // прогона (см. докблок эффекта, «Гейты/данные Task 5 — НЕ производные…»).
  it.each([
    'isRealChat', 'isChannel', 'canViewStats', 'canManageDiscussion',
    'discussionPeerId', 'enablingDiscussion', 'canInvite', 'joinRequests', 'isSecret',
  ])('deps-массив включает %s', (name) => {
    const depsStart = stmt.indexOf('}, [')
    const deps = stmt.slice(depsStart)
    expect(deps).toMatch(new RegExp(`\\b${name}\\b`))
  })
})
