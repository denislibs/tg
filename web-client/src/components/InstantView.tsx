// Читалка Instant View — полноэкранный оверлей со статьёй reader-mode.
// Шапка: крестик, домен, «Открыть в браузере»; контент — колонка 720px.
// БЕЗОПАСНОСТЬ: контент рендерится ТОЛЬКО React-нодами из типизированных
// блоков (никакого HTML); картинки — только http/https (клиентский гейт
// поверх серверной санитизации).
import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import IconButton from '../shared/ui/IconButton'
import Text from '../shared/ui/Text'
import TgIcon from './TgIcon'
import { usePortalContainer } from '../core/pip'
import { useT } from '../i18n'
import type { IVArticle, IVBlock } from '../core/managers/ivManager'
import s from './InstantView.module.scss'

const isHttpUrl = (u: string | undefined): u is string =>
  !!u && (u.startsWith('https://') || u.startsWith('http://'))

function Block({ b }: { b: IVBlock }) {
  switch (b.type) {
    case 'p':
      return b.text ? <p className={s.p}>{b.text}</p> : null
    case 'h1':
    case 'h2':
      return b.text ? <h2 className={s.h2}>{b.text}</h2> : null
    case 'blockquote':
      return b.text ? <blockquote className={s.quote}>{b.text}</blockquote> : null
    case 'pre':
      return b.text ? <pre className={s.pre}>{b.text}</pre> : null
    case 'img':
      return isHttpUrl(b.src) ? <img className={s.img} src={b.src} alt="" loading="lazy" /> : null
    case 'ul':
    case 'ol': {
      if (!b.items?.length) return null
      const items = b.items.map((it, i) => <li key={i}>{it}</li>)
      return b.type === 'ol' ? <ol className={s.list}>{items}</ol> : <ul className={s.list}>{items}</ul>
    }
    default:
      return null
  }
}

export default function InstantView({
  url,
  article,
  onClose,
}: {
  url: string
  article: IVArticle
  onClose: () => void
}) {
  const t = useT()
  const container = usePortalContainer()

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  let domain = article.site_name
  try {
    domain = new URL(url).hostname
  } catch {
    /* оставим site_name */
  }

  return createPortal(
    <div className={s.overlay} role="dialog" aria-modal="true">
      <div className={s.header}>
        <IconButton onClick={onClose} aria-label={t('Close')} color="var(--tg-textSecondary)">
          <TgIcon name="close" size={24} />
        </IconButton>
        <Text size={15} weight={600} color="var(--tg-textPrimary)" className={s.domain}>
          {domain}
        </Text>
        <a className={s.openLink} href={url} target="_blank" rel="noopener noreferrer">
          {t('Open in browser')}
        </a>
      </div>
      <div className={s.scroll}>
        <article className={s.article}>
          <h1 className={s.title}>{article.title}</h1>
          {article.byline && <div className={s.byline}>{article.byline}</div>}
          {article.blocks.map((b, i) => (
            <Block key={i} b={b} />
          ))}
        </article>
      </div>
    </div>,
    container,
  )
}
