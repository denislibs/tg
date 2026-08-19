// Inline-клавиатура под сообщением бота (Telegram replyInlineMarkup).
// Ветвление по конструктору кнопки — порт `getKeyboardButtonHandler`
// (tweb `components/wrappers/keyboardButton.ts:64-300`): что делает кнопка,
// решает её `_`, а не наличие того или иного поля.
import { useState } from 'react'
import type { KeyboardButton, KeyboardButtonRow } from '../../core/markup/replyMarkup'
import { useManagers } from '../../core/hooks/useManagers'
import rootScope from '@lib/rootScope'
import ConfirmDialog from '../settings/ConfirmDialog'
import classNames from '../../shared/lib/classNames'
import { openWebApp } from '../../core/webapp'
import { useT } from '../../i18n'
import s from './InlineKeyboard.module.scss'

export default function InlineKeyboard({ rows, chatId, botId, msgId }: { rows: KeyboardButtonRow[]; chatId: number; botId: number; msgId?: number }) {
  const t = useT()
  const managers = useManagers()
  const [alert, setAlert] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const onClick = async (button: KeyboardButton) => {
    switch (button._) {
      case 'keyboardButtonUrl':
        window.open(button.url, '_blank', 'noopener')
        return
      case 'keyboardButtonWebView':
        openWebApp({ url: button.url, botName: button.text, botId })
        return
      case 'keyboardButtonCallback': {
        if (busy) return
        setBusy(true)
        try {
          const ans = await managers.bots.callback(botId, chatId, button.data, msgId)
          if (ans.text) {
            if (ans.alert) setAlert(ans.text)
            else rootScope.dispatchEvent('ui:toast', ans.text)
          }
        } finally { setBusy(false) }
        return
      }
      // tweb `default`: обработчик появляется только у кнопки БЕЗ сообщения
      // (reply-клавиатура — шлёт свой текст). Под баблом сообщение есть, значит
      // нажатие ничего не делает.
      default:
    }
  }

  return (
    <div className={s.keyboard}>
      {rows.map((row, ri) => {
        // tweb: у крайних кнопок ПОСЛЕДНЕГО ряда нижние внешние углы скруглены
        // большим радиусом — как дно бабла (.is-first / .is-last).
        const lastRow = ri === rows.length - 1
        return (
          <div key={ri} className={s.row}>
            {row.buttons.map((button, bi) => (
              <button
                key={bi}
                type="button"
                className={classNames(
                  s.btn,
                  lastRow && bi === 0 ? s.first : '',
                  lastRow && bi === row.buttons.length - 1 ? s.last : '',
                )}
                onClick={() => void onClick(button)}
              >
                {button.text}
                {button._ === 'keyboardButtonUrl' && <span className={s.ext}>↗</span>}
              </button>
            ))}
          </div>
        )
      })}
      {alert && (
        <ConfirmDialog title={t('Bot')} text={alert} action={t('OK')} onConfirm={() => setAlert(null)} onClose={() => setAlert(null)} />
      )}
    </div>
  )
}
