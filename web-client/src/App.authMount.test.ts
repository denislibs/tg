// Пин точки монтирования экрана входа в App.tsx::ThemedApp (задача 6 волны 3:
// точка монтирования переехала с React <AuthFlow> на Solid mountAuthFlow()).
//
// Почему СКАН ИСХОДНИКА, а не рендер компонента — тот же приём и то же
// обоснование, что у `Chat.feedMount.test.ts` (см. её докблок): `App.tsx`
// нельзя отрендерить в vitest без реальных менеджеров/воркера/сокета, а норма
// покрытия проводки (web-client/CLAUDE.md, «Тесты») требует ЛИБО теста, ЛИБО
// пометки с причиной для КАЖДОЙ строки, которая создаёт точку монтирования —
// не только для той, что уже покрыта Chat.feedMount. Читаем файл текстом.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const APP_TSX = readFileSync(join(__dirname, 'App.tsx'), 'utf8')

describe('App.tsx — точка монтирования экрана входа (Solid, не React)', () => {
  it('импортирует mountAuthFlow из Solid-моста, а не React AuthFlow', () => {
    expect(APP_TSX).toMatch(
      /^import \{ mountAuthFlow \} from '\.\/components\/auth\/mountAuthFlow\.solid'$/m,
    )
    // Второй, React-версии, в дереве больше нет — ни импорта, ни JSX-ветки.
    expect(APP_TSX).not.toMatch(/from '\.\/components\/auth\/AuthFlow'/)
    expect(APP_TSX).not.toContain('<AuthFlow')
  })

  // Вызов обязан лежать ВНУТРИ эффекта, гейтированного `!authed` — иначе либо
  // экран входа не размонтируется после логина (двойной auth-хост поверх
  // Shell), либо не монтируется вовсе. Ищем сам паттерн `if (authed) return`
  // непосредственно перед вызовом mountAuthFlow — переставленное условие или
  // потерянный ранний return эта проверка ловит, а не только пропажу вызова.
  it('mountAuthFlow вызывается внутри эффекта, гейтированного !authed', () => {
    const effect = APP_TSX.match(
      /useLayoutEffect\(\(\) => \{\s*if \(authed\) return\s*\n\s*return mountAuthFlow\(\{[^}]*\}\)\s*\n[\s\S]*?\}, \[([^\]]*)\]\)/,
    )
    expect(effect, 'эффект монтирования auth-экрана не найден в ожидаемой форме').not.toBeNull()
  })

  // managers/onComplete — обязательные пропы AuthCardsHost (см. её тип
  // AuthCardsHostProps): без managers карточки не смогут дёрнуть REST auth.*,
  // без onComplete=login успешный вход никогда не поднимет Shell.
  it('mountAuthFlow получает managers и onComplete: login', () => {
    expect(APP_TSX).toContain('mountAuthFlow({ managers, onComplete: login })')
  })

  it('Shell рендерится только при authed — второй ветки на AuthFlow больше нет', () => {
    expect(APP_TSX).toContain('{authed && <Shell onToggleMode={toggleMode} onLogout={logout} />}')
  })
})
