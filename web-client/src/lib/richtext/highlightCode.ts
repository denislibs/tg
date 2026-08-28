// Подсветка блока кода. Замена tweb `highlightCode` из `@/codeLanguages`
// (1016 строк, ~290 языков) — у нас prism и своя карта на 20 языков, та же, что
// в React-`components/CodeBlock.tsx:17-38`.
//
// ГЛАВНОЕ отличие от tweb: `wrapRichText.ts:302-306` присваивает результат
// подсветки как `element.innerHTML = html`. Это прямое нарушение правила
// «никогда не рендерить пользовательский контент сырой HTML-строкой»
// (`web-client/CLAUDE.md`), поэтому здесь токены prism раскладываются в DOM
// через `createElement`/`createTextNode` — как это делает наш CodeBlock.
import type PrismNS from 'prismjs'

// Тег fence → грамматика prism + человеческое имя в шапке (копия карты CodeBlock.tsx;
// общий модуль не заводим, чтобы не тянуть React-компонент в ванильную ленту —
// карта уедет сюда целиком, когда CodeBlock.tsx будет снесён вместе с React-лентой).
const LANGS: Record<string, { grammar: string, label: string }> = {
  js: { grammar: 'javascript', label: 'JavaScript' },
  javascript: { grammar: 'javascript', label: 'JavaScript' },
  ts: { grammar: 'typescript', label: 'TypeScript' },
  typescript: { grammar: 'typescript', label: 'TypeScript' },
  jsx: { grammar: 'jsx', label: 'JSX' },
  tsx: { grammar: 'tsx', label: 'TSX' },
  json: { grammar: 'json', label: 'JSON' },
  sh: { grammar: 'bash', label: 'Shell' },
  bash: { grammar: 'bash', label: 'Bash' },
  py: { grammar: 'python', label: 'Python' },
  python: { grammar: 'python', label: 'Python' },
  go: { grammar: 'go', label: 'Go' },
  rust: { grammar: 'rust', label: 'Rust' },
  rs: { grammar: 'rust', label: 'Rust' },
  sql: { grammar: 'sql', label: 'SQL' },
  yaml: { grammar: 'yaml', label: 'YAML' },
  yml: { grammar: 'yaml', label: 'YAML' },
  html: { grammar: 'markup', label: 'HTML' },
  xml: { grammar: 'markup', label: 'XML' },
  css: { grammar: 'css', label: 'CSS' },
}

/**
 * Кап длины кода для prism: токенизация нетривиальна, у части грамматик бывает
 * катастрофический бэктрекинг (ReDoS). Правило репозитория — лимит не убирать
 * (`web-client/CLAUDE.md`, «Безопасность»); значение то же, что в CodeBlock.tsx:75.
 */
export const MAX_HIGHLIGHT_LENGTH = 20000

/** Имя языка для шапки блока (tweb: `CodeLanguageAliases[language.toLowerCase()]`). */
export function getCodeLanguage(language?: string) {
  return language ? LANGS[language.toLowerCase()] : undefined
}

function appendTokens(parent: Node, tokens: (string | PrismNS.Token)[]) {
  for (const token of tokens) {
    if (typeof token === 'string') {
      parent.appendChild(document.createTextNode(token))
      continue
    }

    const span = document.createElement('span')
    span.className = 'token ' + (Array.isArray(token.type) ? token.type.join(' ') : token.type)
    const content = token.content
    if (typeof content === 'string') {
      span.textContent = content
    } else if (Array.isArray(content)) {
      appendTokens(span, content as (string | PrismNS.Token)[])
    } else {
      appendTokens(span, [content])
    }

    parent.appendChild(span)
  }
}

/**
 * Асинхронно (prism грузится ленивым чанком, как и в CodeBlock) подсвечивает код
 * внутри `element`. До загрузки в элементе лежит plain-текст, который положил
 * вызывающий, — вспышки не будет.
 *
 * `middleware` — актуальность (`@helpers/middleware`): если бабл успели убрать,
 * в DOM ничего не пишем.
 */
export function highlightCodeInto(
  element: HTMLElement,
  code: string,
  language: string,
  middleware?: () => boolean,
): Promise<void> | undefined {
  const lang = getCodeLanguage(language)
  if (!lang || code.length > MAX_HIGHLIGHT_LENGTH) {
    return undefined
  }

  return import('@components/prism').then((m) => {
    const prism = m.default
    const grammar = prism.languages[lang.grammar]
    if (!grammar || (middleware && !middleware())) {
      return
    }

    const tokens = prism.tokenize(code, grammar)
    element.textContent = ''
    appendTokens(element, tokens)
  })
}
