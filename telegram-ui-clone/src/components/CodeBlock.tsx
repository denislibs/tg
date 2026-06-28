// src/components/CodeBlock.tsx
// Renders a `pre` (fenced code) entity as a Telegram-style code block: a header
// row with the language name + a copy button, and a syntax-highlighted body.
// Highlighting uses prismjs (same lib as tweb). Prism tokens are rendered to React
// nodes (not innerHTML) so there's no injection surface; token colors come from
// the `.token.*` CSS in index.css.
import { useMemo, useState, type ReactNode } from 'react'
import { Box, useTheme } from '@mui/material'
import Prism from 'prismjs'
import TgIcon from './TgIcon'
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
// classes (styled in index.css).
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
  const theme = useTheme()
  const tg = theme.tg
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
    <Box
      component="div"
      onClick={(e) => e.stopPropagation()}
      sx={{
        my: '4px',
        borderRadius: '10px',
        overflow: 'hidden',
        background: alphaBg(theme.palette.mode),
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
        fontSize: '0.92em',
      }}
    >
      {/* header: language name + copy */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          px: 1.25,
          py: 0.5,
          borderBottom: `1px solid ${theme.palette.mode === 'dark' ? 'rgba(255,255,255,.08)' : 'rgba(0,0,0,.08)'}`,
        }}
      >
        <Box component="span" sx={{ fontWeight: 600, fontSize: 13, color: tg.accent, fontFamily: 'inherit' }}>
          {label}
        </Box>
        <Box
          component="span"
          role="button"
          title="Скопировать"
          onClick={copy}
          sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, cursor: 'pointer', color: copied ? tg.accent : tg.textSecondary, fontSize: 12 }}
        >
          <TgIcon name={copied ? 'check' : 'copy'} size={16} />
        </Box>
      </Box>
      {/* body */}
      <Box
        component="pre"
        sx={{ m: 0, px: 1.25, py: 1, overflowX: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: 1.45 }}
      >
        <code>{body}</code>
      </Box>
    </Box>
  )
}

function alphaBg(mode: string) {
  return mode === 'dark' ? 'rgba(0,0,0,0.28)' : 'rgba(0,0,0,0.05)'
}
