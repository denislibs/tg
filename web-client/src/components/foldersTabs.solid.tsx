/** @jsxImportSource solid-js */
/**
 * Порт tweb `src/components/foldersTabs.tsx:1-61` — ряд вкладок папок над
 * списком чатов: `Tabs > [MenuGradient] > MenuScrollable > Menu > For each={folderItems}`
 * (`:51-59`). Разбор — `docs/tweb/folders-tabs.md` § 1.4; эталон разметки —
 * живой дамп `docs/tweb/dom/dumps/14-left-01-chatlist.json:46-71` (пин —
 * `foldersTabs.solid.test.tsx`). План — задача 4
 * `docs/superpowers/plans/2026-09-07-solid-wave-3-folders-tabs.md`.
 *
 * Поведения здесь нет, как и в оригинале: выбранную папку компонент не читает и
 * `active` не ставит — это делает полоса `components/horizontalMenu.ts`, которую
 * на готовые узлы вешает владелец (`appDialogsManager.ts:654-686`, `onRef`
 * `:729-822`; у нас — задача 5). Пропы — те же три (`:11-15`): их форму владелец
 * задаёт сам (класс `folders-tabs-scrollable hide`, `id="folders-tabs"`,
 * градиент `surface`/`smaller`, ref-ы на узлы и `contextRef` скроллера).
 *
 * ОБЪЯВЛЕННЫЕ РАСХОЖДЕНИЯ С ОРИГИНАЛОМ
 *
 *  1. Название папки — `item.filter.title` текстом, а не
 *     `wrapFolderTitle(title, middleware, true, {textColor: 'secondary-text-color'})`
 *     → `documentFragmentToNodes` (`:24-30`). У tweb `filter.title` —
 *     `TextWithEntities` с кастомными эмодзи; у нас на проводе `Folder.title` —
 *     строка без сущностей (`core/managers/foldersManager.ts:5-17`, бэкенд
 *     `folders_handler.go`), а `custom-emoji-renderer` не портирован. Предмет
 *     обёртки появится вместе с сущностями — отложенная задача 11 плана.
 *  2. `item.notifications!` — у tweb то же обращение без проверки (`:43`, `:45`):
 *     tweb собирается без `strictNullChecks`, поле в типе необязательно
 *     (`stores/folders.ts:11-14`), но каждый элемент его несёт
 *     (`makeFolderItemPayload`, `:84-96`). Наша проекция тоже кладёт счётчик в
 *     каждый элемент (`stores/folders.solid.ts::project`), `!` — та же гарантия,
 *     выраженная для строгого TS.
 */
import { For } from 'solid-js'
import Badge from '@components/badge.solid'
import Tabs from '@components/tabs.solid'
import { i18n } from '@lib/langPack'
import useFolders from '@stores/folders.solid'
import { ALL_FOLDER_ID } from '@core/folderIds'

export default function FoldersTabs(props: {
  scrollableProps?: Partial<Parameters<typeof Tabs.MenuScrollable>[0]>
  menuProps?: Partial<Parameters<typeof Tabs.Menu>[0]>
  gradientProps?: Parameters<typeof Tabs.MenuGradient>[0]
}) {
  const { folderItems } = useFolders()

  const Tab = (item: typeof folderItems[0]) => {
    const title = () => {
      if (item.id === ALL_FOLDER_ID) {
        return i18n('FilterAllChatsShort')
      }

      // Расхождение 1: без `wrapFolderTitle` — сущностей в названии нет (задача 11).
      return item.filter.title
    }

    return (
      <Tabs.MenuTab
        ref={(ref) => ref.dataset.filterId = '' + item.filter.id}
      >
        <span class="text-super">
          {title()}
        </span>
        <Badge
          tag="div"
          size={20}
          color={item.notifications!.muted ? 'gray' : 'primary'}
        >
          {item.notifications!.count}
        </Badge>
      </Tabs.MenuTab>
    )
  }

  return (
    <Tabs>
      {props.gradientProps && <Tabs.MenuGradient {...props.gradientProps} />}
      <Tabs.MenuScrollable {...(props.scrollableProps || {})}>
        <Tabs.Menu {...(props.menuProps || {})}>
          <For each={folderItems}>{Tab}</For>
        </Tabs.Menu>
      </Tabs.MenuScrollable>
    </Tabs>
  )
}
