/** @jsxImportSource solid-js */
// Порт tweb `src/components/emptySearchPlaceholder/index.tsx:1-52` — заглушка
// «ничего не найдено» группы «Messages» глобального поиска: утка UtyanSearch
// 156px, два текста и кнопка «Search in All Chats», если владелец дал
// `onAllChats` (только когда в `ChatTypeMenu` выбран не `all`,
// `sidebarLeft/index.ts:1105-1116`).
//
// Как им пользуется владелец поиска (у нас — задача 12 плана):
//   searchGroups.messages.createPlaceholder = () => {
//     const placeholder = new EmptySearchPlaceholder()
//     if(…) placeholder.feedProps({ onAllChats: () => … })
//     return placeholder
//   }
// Группа снимает заглушку голым `remove()` (`searchGroup.tsx:137-140`) —
// корень Solid вместе с lottie-плеером гасит `disconnectedCallback`
// custom element'а (`shared/solid/defineSolidElement.solid.tsx`).
//
// Расхождения с оригиналом:
//  1. `if(import.meta.hot) import.meta.hot.accept()` (`:10`) не перенесён —
//     HMR у нас нет (расхождение 1 в шапке `shared/solid/defineSolidElement.solid.tsx`).
//  2. План (задача 10) предлагал монтировать компонент мостом `mountSolid`;
//     взят custom element, как у оригинала: у группы нет сигнала уборки,
//     кроме снятия узла (см. выше).
import { Show } from 'solid-js'
import { i18n } from '@lib/langPack'
import lottieLoader from '@lib/lottie/lottieLoader'
import defineSolidElement, { type PassedProps } from '@shared/solid/defineSolidElement.solid'
import LottieAnimation from '@components/lottieAnimation.solid'
import ripple from '@components/ripple'
import styles from '@components/emptySearchPlaceholder.module.scss'
// tweb :8 (`ripple;`) — держит импорт директивы `use:ripple`: TS не считает
// директиву использованием; `void` — под oxlint `no-unused-expressions`
void ripple

type Props = {
  onAllChats?: () => void
}

const EmptySearchPlaceholder = defineSolidElement({
  name: 'empty-search-placeholder',
  component: (props: PassedProps<Props>) => {
    props.element.classList.add(styles.Container)

    return (
      <>
        <LottieAnimation
          class={styles.LottieAnimation}
          size={156}
          lottieLoader={lottieLoader}
          restartOnClick
          name="UtyanSearch"
        />

        <div class={styles.NoResults}>
          <div class={styles.NoResultsTitle}>{i18n('NoResultsTitle')}</div>
          <div class={styles.NoResultsSubtitle}>{i18n('NoResultsSubtitle')}</div>
        </div>

        <Show when={props.onAllChats}>
          <button
            use:ripple
            class={`btn primary ${styles.ActionButton}`}
            onClick={props.onAllChats}
          >
            {i18n('SearchInAllChats')}
          </button>
        </Show>
      </>
    )
  },
})

export default EmptySearchPlaceholder
