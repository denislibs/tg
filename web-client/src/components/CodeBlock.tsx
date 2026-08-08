// src/components/CodeBlock.tsx
// Renders a `pre` (fenced code) entity as a Telegram-style code block: a header
// row with the language name + a copy button, and a syntax-highlighted body.
// Highlighting uses prismjs (same lib as tweb). Prism tokens are rendered to React
// nodes (not innerHTML) so there's no injection surface; token colors come from
// the `.token.*` CSS in styles/index.scss.
import { useEffect, useMemo, useState, type ReactNode } from 'react'
// prismjs (+ грамматики) грузится лениво через ./prism (см. prism.ts). Тип — type-only
// импорт (стирается при сборке). До загрузки блок кода рендерится как plain-текст, затем
// перерисовывается с подсветкой — без Suspense-вспышки в ленте сообщений.
import type PrismNS from 'prismjs'
import TgIcon from './TgIcon'
import classNames from '../shared/lib/classNames'
import s from './CodeBlock.module.scss'

// Map a fence tag to Prism's grammar key + a human label for the header.
const LANGS: Record<string, { grammar: string; label: string }> = {
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

// Recursively render Prism's token stream into React nodes with `.token.<type>`
// classes (styled in styles/index.scss).
function renderTokens(tokens: (string | PrismNS.Token)[], keyBase: string): ReactNode[] {
  return tokens.map((tok, i) => {
    const key = `${keyBase}-${i}`
    if (typeof tok === 'string') return <span key={key}>{tok}</span>
    const type = Array.isArray(tok.type) ? tok.type.join(' ') : tok.type
    const content = tok.content
    const inner: ReactNode = Array.isArray(content)
      ? renderTokens(content as (string | PrismNS.Token)[], key)
      : typeof content === 'string'
        ? content
        : renderTokens([content], key)
    return <span key={key} className={`token ${type}`}>{inner}</span>
  })
}

export default function CodeBlock({ code, language }: { code: string; language?: string }) {
  const [copied, setCopied] = useState(false)
  const [prism, setPrism] = useState<typeof PrismNS | null>(null)

  const lang = language ? LANGS[language.toLowerCase()] : undefined

  // Грузим prism только когда есть что подсвечивать (известный язык). Пока не загрузился —
  // body ниже отдаёт plain-текст; после загрузки setPrism перерисует с подсветкой.
  useEffect(() => {
    if (!lang) return
    let cancelled = false
    void import('./prism').then((m) => { if (!cancelled) setPrism(m.default) })
    return () => { cancelled = true }
  }, [lang])

  const body = useMemo<ReactNode>(() => {
    // Skip highlighting very long blocks: Prism tokenization is non-trivial and a
    // few grammars can backtrack badly (ReDoS) — cap the cost, render plain.
    if (prism && lang && prism.languages[lang.grammar] && code.length <= 20000) {
      const tokens = prism.tokenize(code, prism.languages[lang.grammar])
      return renderTokens(tokens, 'tk')
    }
    return code
  }, [code, lang, prism])

  const copy = (e: React.MouseEvent) => {
    e.stopPropagation()
    void navigator.clipboard?.writeText(code)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1500)
  }

  const label = lang?.label ?? (language ? language.toUpperCase() : 'Код')

  // Разметка tweb (base.scss:1979-2041 → styles/tweb/_code.scss): контейнер
  // `.quote-like.quote-like-border.code`, шапка `.code-header` (имя языка +
  // круглая кнопка копирования) и тело `.code-code`.
  return (
    <div onClick={(e) => e.stopPropagation()} className="quote-like quote-like-border code">
      <div className="code-header" onClick={copy}>
        <span className="code-header-name">{label}</span>
        <span
          role="button"
          title="Скопировать"
          onClick={copy}
          className={classNames('code-header-button', copied ? s.copied : '')}
        >
          <TgIcon name={copied ? 'check' : 'copy'} size={16} />
        </span>
      </div>
      <pre className="code-content">
        <code className="code-code">{body}</code>
      </pre>
    </div>
  )
}
