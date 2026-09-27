// Пин публикации темы активного чата в фон страницы (`App.tsx::ThemedApp`) —
// роль tweb `Chat.publishBackground` (`chat.ts:380-433`), О-39 в шапке
// `components/chat/bubbles/chatBackground.solid.tsx`.
//
// Скан исходника, а не рендер — то же обоснование, что у `App.authMount.test.ts`
// (`App.tsx` не рендерится в vitest без менеджеров/воркера/сокета). Проверяется
// предмет, а не форма: существует эффект `ThemedApp`, в ТЕЛЕ которого фон
// получает тему чата (`shellChatTheme`), и тема чата — среди его зависимостей;
// React-фона (`<ChatBackground>`) в дереве больше нет.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const APP_TSX = readFileSync(join(__dirname, 'App.tsx'), 'utf8')

/** Блок `{...}` с позиции `start` — балансом скобок. */
function braceBlock(src: string, start: number): string {
  let depth = 0
  for(let i = start; i < src.length; i++) {
    if(src[i] === '{') depth++
    else if(src[i] === '}' && --depth === 0) return src.slice(start, i + 1)
  }
  throw new Error('не сбалансированы скобки')
}

const themedAppStart = APP_TSX.indexOf('function ThemedApp(')
const THEMED_APP = braceBlock(APP_TSX, APP_TSX.indexOf('{', themedAppStart))

/** Эффекты `ThemedApp`: тело и хвост с зависимостями (до `)` после тела). */
function effects(src: string) {
  const out: { body: string, deps: string }[] = []
  for(let from = 0; ;) {
    const at = src.indexOf('useLayoutEffect(', from)
    if(at === -1) return out
    const bodyStart = src.indexOf('{', at)
    const body = braceBlock(src, bodyStart)
    const tail = src.slice(bodyStart + body.length, src.indexOf(')', bodyStart + body.length) + 1)
    out.push({ body, deps: tail })
    from = bodyStart + body.length
  }
}

describe('App.tsx — тема активного чата публикуется в фон страницы', () => {
  it('эффект ThemedApp зовёт appChatBackground.setBackground с темой чата и зависит от неё', () => {
    const publishing = effects(THEMED_APP).find(({ body }) => body.includes('appChatBackground.setBackground('))
    expect(publishing, 'ни один useLayoutEffect ThemedApp не публикует фон').toBeDefined()
    expect(publishing!.body).toContain('shellChatTheme')
    expect(publishing!.deps).toContain('shellChatTheme')
  })

  it('React-фона больше нет', () => {
    expect(APP_TSX).not.toContain('<ChatBackground')
    expect(APP_TSX).not.toMatch(/from '\.\/components\/ChatBackground'/)
  })
})
