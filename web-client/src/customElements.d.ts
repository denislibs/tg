// Кастомные теги из разметки tweb, которые React рендерит как есть, чтобы
// совпадали селекторы портированных партиалов (`_audio.scss`, `_reactions.scss`
// и др.). В tweb это настоящие web-components; в React-ленте узел тот же, а
// поведение живёт в компоненте.
//
// ВАЖНО: два из них теперь ЗАРЕГИСТРИРОВАНЫ как настоящие web-components и
// объявления здесь их не описывают — это только JSX-имена для React:
//   • `audio-element` → `components/audio.ts` (порт tweb `AudioElement`);
//   • `middle-ellipsis-element` → `components/middleEllipsis.ts`.
// Регистрация происходит при импорте этих модулей, то есть только в
// императивной ленте (`VITE_VANILLA_FEED`); React-ветка их не импортирует и
// работает с теми же тегами как раньше. Остальные три тега здесь по-прежнему
// поведения не несут.
import type { DetailedHTMLProps, HTMLAttributes } from 'react'

type TwebElement = DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement> & {
  /** имя атрибута класса на кастомном теге — как в tweb-разметке */
  class?: string
}

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      'audio-element': TwebElement
      'reactions-element': TwebElement
      'reaction-element': TwebElement
      'replies-element': TwebElement
      'middle-ellipsis-element': TwebElement
    }
  }
}
