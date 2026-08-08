// Кастомные теги из разметки tweb, которые мы рендерим как есть, чтобы совпадали
// селекторы портированных партиалов (`_audio.scss`, `_reactions.scss` и др.).
// В tweb это настоящие web-components; у нас поведение на React, а узел — тот же.
import type { DetailedHTMLProps, HTMLAttributes } from 'react'

type TwebElement = DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement> & {
  /** имя атрибута класса на кастомном теге — как в tweb-разметке */
  class?: string
}

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      'audio-element': TwebElement
      'middle-ellipsis-element': TwebElement
    }
  }
}
