import { useEffect, useState } from 'react'
import type { LangPackLanguage } from '@layer'
import Text from '../../shared/ui/Text'
import { useLang } from '../../i18n'
import { useManagers } from '../../core/hooks/useManagers'
import { useSettings } from '../../settings'
import { SettingsScreen, Section, Row } from './kit'
import s from './LanguageSettings.module.scss'

function Radio({ on }: { on: boolean }) {
  return (
    <div className={s.radio} data-on={on || undefined}>
      {on && <div className={s.radioDot} />}
    </div>
  )
}

/**
 * Экран выбора языка. Список приезжает С СЕРВЕРА (задача 8).
 *
 * До этой задачи здесь лежала таблица из 33 языков, у шести из которых был код,
 * а у остальных 27 — не было: клик по «Italiano» не делал НИЧЕГО, строка
 * зажигала кружок и молчала. Теперь строки ровно те, что у сервера есть
 * (`langpack.getLanguages`), и каждая работает.
 *
 * ПОРЯДОК СПИСКА — СЕРВЕРНЫЙ, и здесь его не трогают: `position` (миграция 0129)
 * ставит предложенные первыми (английский, русский), дальше по алфавиту. У tweb
 * так же — выдачу перебирают без сортировки (`sidebarLeft/tabs/language.tsx:117`).
 * Отсортируй список тут, и русский уехал бы на четвёртое место.
 *
 * Имена берутся у сервера обоими полями, как в оригинале: `name` (английское
 * имя) титулом, `native_name` (самоназвание) подписью — tweb `language.tsx:120-127`
 * (`RadioField.text` + `Row.subtitle`).
 *
 * ОТКАЗ СЕТИ показывает пустую секцию, и это то же, что у оригинала: у него
 * список собирает `promiseCollector`, и на отказе вкладка не открывается вовсе.
 * Своей подписи «не удалось загрузить» у tweb нет — выдумывать её не стали.
 */
export default function LanguageSettings({ onBack }: { onBack: () => void }) {
  const [lang, setLang] = useLang()
  const managers = useManagers()
  const [languages, setLanguages] = useState<LangPackLanguage[]>([])
  const { showTranslateButton, update } = useSettings()

  useEffect(() => {
    let alive = true
    managers.langPack.getLanguages()
      .then((list) => { if (alive) setLanguages(list) })
      .catch(() => { /* сети нет — секция остаётся пустой, см. докблок */ })
    return () => { alive = false }
  }, [managers])

  return (
    <SettingsScreen title="Telegram.LanguageViewController" onBack={onBack}>
      {/* message translation */}
      <Section caption="Translate.SectionTitle" footer="Translate.SectionCaption">
        <Row label="ShowTranslateButton" toggle checked={showTranslateButton} onClick={() => update({ showTranslateButton: !showTranslateButton })} />
      </Section>

      {/* language list */}
      <Section>
        {languages.map((it) => (
          <div
            key={it.lang_code}
            className={s.langRow}
            // Код языка — на самой строке, как у оригинала (`RadioField.value`,
            // tweb `language.tsx:124`): по нему строку и адресуют.
            data-lang-code={it.lang_code}
            onClick={() => setLang(it.lang_code)}
          >
            {/* Выбранное берётся у ВЛАДЕЛЬЦА языка (`useLang` — зеркало ядра), а не
                у своего состояния экрана: иначе кружок горел бы там, куда кликнули,
                даже если язык не сменился. */}
            <Radio on={lang === it.lang_code} />
            <div className={s.langBody}>
              <Text size={16} color="var(--primary-text-color)">{it.name}</Text>
              <Text size={13.5} color="var(--secondary-text-color)">{it.native_name}</Text>
            </div>
          </div>
        ))}
      </Section>
    </SettingsScreen>
  )
}
