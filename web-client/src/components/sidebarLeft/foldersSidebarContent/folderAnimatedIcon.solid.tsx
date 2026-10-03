/** @jsxImportSource solid-js */
/**
 * Порт tweb `components/sidebarLeft/foldersSidebarContent/folderAnimatedIcon.tsx`
 * (812502980) — иконка папки из эмодзи её названия.
 *
 * Расхождения:
 *  1. Ветки `docId` (`EmojiDocumentIcon` — анимированный кастомный эмодзи) нет:
 *     кастомных эмодзи в названии папки у нас нет (шапка `types.ts`), поэтому
 *     нет и пропов `managers`/`color`/`size`/`dontAnimate`, которые нужны только ей.
 *  2. `wrapSingleEmoji(emoji)` — наш `wrapEmojiText(emoji)`: на строке из одного
 *     эмодзи он даёт ту же единственную сущность `messageEntityEmoji`.
 */
import { Match, onMount, Switch } from 'solid-js'
import wrapEmojiText from '@lib/richtext/wrapEmojiText'

export default function FolderAnimatedIcon(props: {
  emoji?: string
  class?: string
  onFail?: () => void
}) {
  const Fallback = () => {
    onMount(() => props.onFail?.())
    // Keep the div for maintaining the layout
    return <div class={props.class}></div>
  }

  return (
    <Switch
      fallback={<Fallback />}
    >
      <Match when={props.emoji} keyed>
        {(emoji) => <div class={props.class}>{wrapEmojiText(emoji)}</div>}
      </Match>
    </Switch>
  )
}
