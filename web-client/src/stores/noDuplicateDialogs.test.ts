// Task 6 (снос старого пути, пины владения): список диалогов — воркерный
// dialogsManager единственный владелец (он же решает, ЧТО изменилось, и
// публикует это операцией rt:dialog_op), а `chatsStore.dialogs` — зеркало.
// Прямая запись в стор МИМО проектора — второй независимый вывод того же
// факта (ровно баг, который чинили Task 1-6: до них порядок считало ДВА места
// сразу — `applyDialogs`/`dialogIndex` на main и живые ручные апдейты, —
// список перетасовывался через ~250 мс после первого кадра; см.
// stores/noManualOrder.test.ts).
//
// Новый файл, пишущий в chatsStore.dialogs вне allow-list, — красная линия:
// либо публикуй операцию из владельца (core/managers/dialogsManager.ts) и
// применяй её проектором, либо осознанно добавь сюда с обоснованием и
// пометкой ПРЯМО У ВЫЗОВА (см. web-client/CLAUDE.md «Тесты»). Образец —
// noDuplicatePeers.test.ts / noDuplicateMe.test.ts.
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const SRC = join(__dirname, '..')

function walk(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, acc)
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) acc.push(p)
  }
  return acc
}

/**
 * Основной писатель: `client/realtime/storeProjection.ts` (APPLY[RT.dialogOp] —
 * переигрывает операции, опубликованные владельцем); холодный старт
 * (`client/boot.ts::applyDialogsMirror`, ответ `fillMirror()`) идёт тем же
 * методом `applyDialogOps`, но живёт в отдельном файле — оба входят в
 * allow-list. У зеркала диалогов, как и у пиров, нет оптимистичного пути
 * витрины (в отличие от `me`, где своё же действие пользователя показывают до
 * round-trip'а) — список диалогов витрина не сочиняет сама, только зеркалит
 * уже применённое владельцем.
 *
 * Единственное допущенное исключение — `core/hooks/useAuthGate.ts`
 * (`resetAccountStateInMemory`, обработчик `rt:logging_out`): владелец
 * (dialogsManager) на переходе сессии чистит СВОЙ кэш (`resetForLogout()`,
 * см. dialogsManager.ts), но НЕ публикует rt:dialog_op reset — значит очистить
 * ЗЕРКАЛО от чужих диалогов прошлого аккаунта обязана та же вкладка, что и
 * `resetAppState()`/`resetStateCache()` рядом (иначе они успели бы сброситься,
 * а список диалогов — нет). Обоснование прямо у вызова в файле; см. образец
 * `me` (setMe-исключения) — `stores/noDuplicateMe.test.ts`.
 */
const ALLOWED = ['client/realtime/storeProjection.ts', 'client/boot.ts', 'core/hooks/useAuthGate.ts']

/**
 * Запись в стор ищем не по голым `set(`/`applyDialogOps(` (второе — легитимное
 * имя метода, которое зовёт ЕДИНСТВЕННЫЙ allowed-писатель), а по обращениям К
 * ЭТОМУ стору. Читающие обращения (`useChatsStore.getState().dialogs`,
 * `useChatsStore((s) => s.dialogs...)`) вырезаем перед проверкой — иначе
 * каждый читатель списка (их в приложении много: ChatList, useUrlSync,
 * useChatScroll и т.п.) ложно засветился бы как писатель.
 */
function writesToChatsDialogs(src: string): boolean {
  const withoutReads = src
    .split('useChatsStore.getState().dialogs').join('')
    .replace(/useChatsStore\(\s*\(?[^)]*\)?\s*=>\s*s?\.?\s*\w*\.?dialogs\b[^)]*\)/g, '')
  return /useChatsStore\.(getState|setState)\s*\(\s*\)?\s*\.?\s*(applyDialogOps|setDialogs|setDialog)/.test(withoutReads)
    // хук-селектором тоже можно достать писателя: useChatsStore((s) => s.applyDialogOps)
    || /useChatsStore\(\s*\(?[^)]*\)?\s*=>\s*s?\.?\s*\w*\.?(applyDialogOps|setDialogs|setDialog)/.test(withoutReads)
}

describe('chatsStore.dialogs: воркер владеет списком диалогов, витрина только зеркалит', () => {
  it('писатели списка диалогов есть только в allow-list', () => {
    const offenders = walk(SRC)
      .map((f) => f.slice(SRC.length + 1).replace(/\\/g, '/'))
      .filter((rel) => !ALLOWED.includes(rel))
      .filter((rel) => writesToChatsDialogs(readFileSync(join(SRC, rel), 'utf8')))

    expect(offenders).toEqual([])
  })

  it('allow-list не разбух молча: каждая запись реально пишет список диалогов', () => {
    for (const rel of ALLOWED) {
      expect(writesToChatsDialogs(readFileSync(join(SRC, rel), 'utf8')), `${rel}: ожидалась запись applyDialogOps`).toBe(true)
    }
  })

  // Снесённые Task 6 мутаторы не должны воскреснуть под другим именем/местом:
  // ни `setDialogs`, ни легаси `applyDialogs`/`syncPinnedOrder` (main-сайд
  // пересчёт dialogIndex — держит отдельно stores/noManualOrder.test.ts) в
  // КОДЕ chatsStore.ts больше нет (комментарии, объясняющие снос ПРОЗОЙ, —
  // не в счёт, поэтому вырезаем их перед проверкой, как и noManualOrder.test.ts).
  it('chatsStore.ts не содержит снесённых легаси-мутаторов (setDialogs/applyDialogs/syncPinnedOrder)', () => {
    const raw = readFileSync(join(SRC, 'stores/chatsStore.ts'), 'utf8')
    const src = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')
    expect(src).not.toMatch(/\bsetDialogs\b/)
    expect(src).not.toMatch(/\bapplyDialogs\b/)
    expect(src).not.toMatch(/\bsyncPinnedOrder\b/)
  })

  // Владелец публикует операцию (DialogOp), а не снимок кэша: снимок вернул бы
  // витрине право самой вычислять разницу — то самое второе правило, от
  // которого вся эта программа (Task 1-6) избавляется. Форма — как у PeerOp/MessageOp.
  it('dialogsManager публикует операции (DialogOp), а не весь кэш', () => {
    const src = readFileSync(join(SRC, 'core/managers/dialogsManager.ts'), 'utf8')
    expect(src).toMatch(/op: 'reset'/)
    expect(src).toMatch(/op: 'patch'/)
    expect(src).toMatch(/op: 'remove'/)
  })
})
