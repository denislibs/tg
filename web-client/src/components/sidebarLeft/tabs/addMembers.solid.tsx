/** @jsxImportSource solid-js */
/**
 * Порт tweb `src/components/sidebarLeft/tabs/addMembers.tsx` (812502980) —
 * вкладка выбора участников на `AppSelectPeers` (`components/appSelectPeers.solid.tsx`):
 * селектор кладётся прямо в `.sidebar-content` (свой скроллер вкладки снимается,
 * :38), угловая кнопка «Далее» `btn-circle btn-corner` отдаёт выбор в
 * `takeOut` полезной нагрузки.
 *
 * Потребители в волне 2D — исключения правил приватности (`type: 'privacy'`,
 * задача 17: `privacySection.tsx:189-210`); открывается
 * `tab.slider.createTab(AppAddMembersTab).open({…})`. Вкладка `AppAddMembersTab` —
 * `solidJsTabs/tabs.ts` (tweb :1034-1063).
 *
 * ОБЪЯВЛЕННЫЕ РАСХОЖДЕНИЯ С ОРИГИНАЛОМ
 *
 *  1. Категории поверх списка (`extraCategories`, `extraCategoriesSectionLangKey`,
 *     `selectedExtras`, строковые ключи в `takeOut(peerIds, extras)`, :42-48, :98-136) не
 *     портированы: их единственный потребитель — «мини-приложения» в исключениях
 *     приватности (`privacySection.tsx:204-209`, `allowMiniApps`), а мини-приложений
 *     и такого правила у нас нет — О-33. `takeOut` получает только пиров.
 *  2. `channelParticipantsPeerId` (:62-66, :68) — нет: участников канала селектор
 *     не портирует (расхождение 1 `appSelectPeers.solid.tsx`).
 *  3. `peerLoader` (`peerType: 'custom'`), `limit`/`limitCallback` (:85-96) и
 *     `filterPeerTypeBy` функцией — нет: потребители у оригинала — автоматизация
 *     чатов (бизнес-боты), платные сообщения (О-15) и истории, в волне их нет
 *     (расхождение 14 `appSelectPeers.solid.tsx`).
 *  4. `ButtonCorner` без `ariaLabel: 'Next'` (:36) — шапка `components/buttonCorner.ts`.
 */
import ButtonCorner from '@components/buttonCorner'
import AppSelectPeers from '@components/appSelectPeers.solid'
import { setButtonLoader } from '@components/putPreloader'
import { useSuperTab } from '@components/solidJsTabs/superTabProvider.solid'
import type { AppAddMembersTab } from '@components/solidJsTabs/tabs'

type AppAddMembersTabClass = typeof AppAddMembersTab

const AddMembersTab = () => {
  const [tab] = useSuperTab<AppAddMembersTabClass>()
  const {
    type,
    placeholder,
    takeOut,
    skippable,
    selectedPeerIds,
    peerType,
    exceptSelf,
    filterPeerTypeBy,
  } = tab.payload

  // :34-38
  tab.container.classList.add('add-members-container')

  const nextBtn = ButtonCorner({ icon: 'arrow_next' })
  tab.content.append(nextBtn)
  tab.scrollable.container.remove()

  // :40-57 (без строковых ключей категорий — расхождение 1)
  nextBtn.addEventListener('click', () => {
    const peerIds = selector.getSelected() as PeerId[]
    const result = takeOut?.(peerIds)

    if(skippable && !(result instanceof Promise)) {
      tab.close()
    } else if(result instanceof Promise) {
      attachToPromise(result)
    } else if(result === undefined) {
      tab.close()
    }
  })

  // :59-83
  const isPrivacy = type === 'privacy'
  const selector = new AppSelectPeers({
    middleware: tab.middlewareHelper.get(),
    appendTo: tab.content,
    onChange: skippable ? undefined : (length) => {
      nextBtn.classList.toggle('is-visible', !!length)
    },
    peerType: peerType || [isPrivacy ? 'dialogs' : 'contacts'],
    placeholder,
    exceptSelf: exceptSelf ?? isPrivacy,
    filterPeerTypeBy: filterPeerTypeBy ??
      (isPrivacy ? ['isAnyGroup', 'isUser'] : undefined),
    managers: tab.managers!,
    design: isPrivacy ? 'round' : 'square',
    checkboxSide: isPrivacy ? 'right' : 'left',
  })

  // :138-143
  const initialPeerIds = selectedPeerIds || []
  if(initialPeerIds.length) {
    selector.addInitial(initialPeerIds)
  }

  // :145-146
  nextBtn.disabled = false
  nextBtn.classList.toggle('is-visible', skippable)

  // :148-160
  function attachToPromise(promise: Promise<unknown>) {
    const removeLoader = setButtonLoader(nextBtn)
    promise.then((result) => {
      if(result === false) {
        removeLoader()
        return
      }

      tab.close()
    }, () => {
      removeLoader()
    })
  }

  // :162
  tab.payload.attachToPromise = attachToPromise

  return <></>
}

export default AddMembersTab
