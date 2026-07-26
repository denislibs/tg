// src/components/CodeBlock.tsx
// Renders a `pre` (fenced code) entity as a Telegram-style code block: a header
// row with the language name + a copy button, and a syntax-highlighted body.
// Highlighting uses prismjs (same lib as tweb). Prism tokens are rendered to React
// nodes (not innerHTML) so there's no injection surface; token colors come from
// the `.token.*` CSS in styles/index.scss.
import { useMemo, useState, type ReactNode } from 'react'
import Prism from 'prismjs'
import TgIcon from './TgIcon'
import classNames from '../shared/lib/classNames'
import s from './CodeBlock.module.scss'
// Common languages, imported in dependency order: clike/markup/css are bases;
// javascript needs clike; jsx needs markup+javascript; typescript needs javascript;
// tsx needs jsx+typescript.
import 'prismjs/components/prism-clike'
import 'prismjs/components/prism-markup' // html/xml
import 'prismjs/components/prism-css'
import 'prismjs/components/prism-javascript'
import 'prismjs/components/prism-jsx'
import 'prismjs/components/prism-typescript'
import 'prismjs/components/prism-tsx'
import 'prismjs/components/prism-json'
import 'prismjs/components/prism-bash'
import 'prismjs/components/prism-python'
import 'prismjs/components/prism-go'
import 'prismjs/components/prism-rust'
import 'prismjs/components/prism-sql'
import 'prismjs/components/prism-yaml'

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
function renderTokens(tokens: (string | Prism.Token)[], keyBase: string): ReactNode[] {
  return tokens.map((tok, i) => {
    const key = `${keyBase}-${i}`
    if (typeof tok === 'string') return <span key={key}>{tok}</span>
    const type = Array.isArray(tok.type) ? tok.type.join(' ') : tok.type
    const content = tok.content
    const inner: ReactNode = Array.isArray(content)
      ? renderTokens(content as (string | Prism.Token)[], key)
      : typeof content === 'string'
        ? content
        : renderTokens([content], key)
    return <span key={key} className={`token ${type}`}>{inner}</span>
  })
}

export default function CodeBlock({ code, language }: { code: string; language?: string }) {
  const [copied, setCopied] = useState(false)

  const lang = language ? LANGS[language.toLowerCase()] : undefined
  const body = useMemo<ReactNode>(() => {
    // Skip highlighting very long blocks: Prism tokenization is non-trivial and a
    // few grammars can backtrack badly (ReDoS) — cap the cost, render plain.
    if (lang && Prism.languages[lang.grammar] && code.length <= 20000) {
      const tokens = Prism.tokenize(code, Prism.languages[lang.grammar])
      return renderTokens(tokens, 'tk')
    }
    return code
  }, [code, lang])

  const copy = (e: React.MouseEvent) => {
    e.stopPropagation()
    void navigator.clipboard?.writeText(code)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1500)
  }

  const label = lang?.label ?? (language ? language.toUpperCase() : 'Код')

  return (
    <div onClick={(e) => e.stopPropagation()} className={s.root}>
      {/* header: language name + copy */}
      <div className={s.header}>
        <span className={s.label}>{label}</span>
        <span
          role="button"
          title="Скопировать"
          onClick={copy}
          className={classNames(s.copy, copied ? s.copied : '')}
        >
          <TgIcon name={copied ? 'check' : 'copy'} size={16} />
        </span>
      </div>
      {/* body */}
      <pre className={s.body}>
        <code>{body}</code>
      </pre>
    </div>
  )
}
