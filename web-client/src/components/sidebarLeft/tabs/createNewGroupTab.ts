/**
 * Порт tweb `src/components/sidebarLeft/tabs/createNewGroupTab.ts` (812502980) —
 * флоу «Новая группа»: сначала выбор участников (`AppAddMembersTab`,
 * `skippable` — можно никого не звать), «Далее» открывает `AppNewGroupTab` с
 * выбранными. `takeOut` отдаёт ПРОМИС открытия, поэтому вкладка выбора
 * закрывает себя, лишь когда вторая уже въехала (`addMembers.solid.tsx`
 * `attachToPromise`), — и не верхней: слайдер вынимает её из истории
 * (`closeTab` → `removeTabFromHistory`). «Назад» со второй вкладки ведёт
 * поэтому не на выбор, а туда, откуда флоу начали, — как у оригинала.
 */
import type SidebarSlider from '@components/slider'
import { AppAddMembersTab, AppNewGroupTab } from '@components/solidJsTabs/tabs'

export default function createNewGroupTab(slider: SidebarSlider) {
  void slider.createTab(AppAddMembersTab).open({
    type: 'chat',
    skippable: true,
    takeOut: (peerIds) => slider.createTab(AppNewGroupTab).open({ peerIds }),
    title: 'GroupAddMembers',
    placeholder: 'SendMessageTo',
  })
}
