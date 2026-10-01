// Порт tweb `src/hooks/useIsConfirmationNeededOnClose.ts:1-59` (812502980) —
// `isConfirmationNeededOnClose` вкладки с кнопкой «Сохранить» в шапке: при
// несохранённых изменениях закрытие спрашивает «Save / Discard».
// Слайдер (`components/slider.ts::pushNavigationItem`) ждёт промис: разрешён —
// вкладка закрывается, отклонён — остаётся. Отсюда три исхода, как у оригинала:
//  • изменений нет — промис разрешён сразу, вкладка закрывается;
//  • «Discard» (отказ `'canceled'`) — разрешён без записи, закрывается;
//  • крестик/Esc/оверлей (отказ `'closed'`) — отклонён, вкладка остаётся;
//  • «Save» — запись (`saveAllSettings`, дожидаясь её только при `waitForSave`).
//
// Расхождение с оригиналом: `confirmationPopup` — наш хелпер
// (`components/popups/popupPeer.ts`), а не `useHotReloadGuard()` (HMR-охранника
// у нас нет); кнопка — наш `PopupButton`.
import type { Accessor } from 'solid-js'
import type { LangPackKey } from '@lib/langPack'
import type { PopupButton } from '@components/popups/popupElement'
import { confirmationPopup, type ConfirmationPopupRejectReason } from '@components/popups/popupPeer'

type UseIsConfirmationNeededOnCloseArgs = {
  descriptionLangKey: LangPackKey
  hasChanges: Accessor<boolean>
  saveAllSettings: () => Promise<void>
  waitForSave?: boolean
}

const useIsConfirmationNeededOnClose = ({
  descriptionLangKey,
  hasChanges,
  saveAllSettings,
  waitForSave,
}: UseIsConfirmationNeededOnCloseArgs) => {
  return async() => {
    if(!hasChanges()) return

    const saveButton: PopupButton = {
      langKey: 'Save',
    }

    try {
      await confirmationPopup({
        titleLangKey: 'UnsavedChanges',
        descriptionLangKey,
        button: saveButton,
        buttons: [
          saveButton,
          { isCancel: true, langKey: 'Discard' },
        ],
        rejectWithReason: true,
      })
    } catch(_reason: unknown) {
      const reason = _reason as ConfirmationPopupRejectReason

      if(reason === 'closed') throw new Error()
      return
    }

    if(waitForSave) {
      await saveAllSettings()
    } else {
      void saveAllSettings()
    }

    return true
  }
}

export default useIsConfirmationNeededOnClose
