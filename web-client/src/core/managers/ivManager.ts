import type { RestClient } from '../net/restClient'

// Instant View: типизированные блоки статьи (reader mode) — бэкенд парсит
// страницу через go-readability и отдаёт ТОЛЬКО плоский текст/ссылки, без HTML.
export interface IVBlock {
  type: 'p' | 'h1' | 'h2' | 'blockquote' | 'img' | 'pre' | 'ul' | 'ol'
  text?: string
  src?: string
  items?: string[]
}

export interface IVArticle {
  title: string
  byline: string
  site_name: string
  blocks: IVBlock[]
}

export function newIVManager({ rest }: { rest: RestClient }) {
  return {
    async article(url: string): Promise<IVArticle> {
      return rest.get<IVArticle>('/iv', { url })
    },
  }
}
