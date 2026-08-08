// CountryInput — поле выбора страны на экране входа (порт tweb
// components/countryInputField.ts): outlined-инпут с плавающим лейблом
// «Country» и стрелкой-шевроном; фокус/клик открывает дропдаун со всеми
// странами (флаг-эмодзи + имя + серый телефонный код), ввод фильтрует по
// имени/iso2/аббревиатуре, Enter при единственном совпадении выбирает его.
// Закрытие — по клику вне или Esc.
import { useEffect, useRef, useState } from 'react'
import TgIcon from '../TgIcon'
import classNames from '../../shared/lib/classNames'
import { useT } from '../../i18n'
import { COUNTRIES, countryFlag, filterCountries, type Country } from './countries'
import s from './CountryInput.module.scss'

export default function CountryInput({ value, onChange }: {
  value: Country | null
  onChange: (c: Country) => void
}) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const [text, setText] = useState(value?.name ?? '')
  // Фильтр включается только после ввода: на фокусе tweb показывает ВСЕ страны
  // (имя выбранной выделено и заменится первым же символом).
  const [typed, setTyped] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Внешняя смена страны (автоопределение по «+49…» в поле телефона) — обновить текст.
  useEffect(() => { setText(value?.name ?? '') }, [value])

  // tweb: закрытие по mousedown вне .input-select (capture).
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) close()
    }
    document.addEventListener('mousedown', onDown, { capture: true })
    return () => document.removeEventListener('mousedown', onDown, { capture: true })
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  const close = () => {
    setOpen(false)
    setText(value?.name ?? '') // вернуть имя выбранной страны вместо фильтра
  }

  const pick = (c: Country) => {
    onChange(c)
    setText(c.name)
    setOpen(false)
    inputRef.current?.blur()
  }

  // Пустой фильтр или отсутствие совпадений → полный список (tweb onKeyPress).
  const filtered = typed ? filterCountries(text.trim()) : COUNTRIES
  const list = filtered.length ? filtered : COUNTRIES

  return (
    <div ref={wrapRef} className={s.wrap}>
      <div className={s.field}>
        <input
          ref={inputRef}
          className={s.input}
          value={text}
          placeholder=" "
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => { setText(e.target.value); setTyped(true); setOpen(true) }}
          onFocus={(e) => { setTyped(false); setOpen(true); e.target.select() }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') { e.preventDefault(); close(); inputRef.current?.blur() }
            if (e.key === 'Enter' && filtered.length === 1) { e.preventDefault(); pick(filtered[0]) }
          }}
        />
        <label className={s.label}>{t('Country')}</label>
        {/* стрелка (tweb .arrow-down): клик открывает/закрывает список */}
        <span
          className={classNames(s.arrow, open ? s.arrowUp : '')}
          onMouseDown={(e) => {
            e.preventDefault()
            if (open) { close(); inputRef.current?.blur() }
            else inputRef.current?.focus()
          }}
        >
          <TgIcon name="down" size={24} color="var(--secondary-text-color)" />
        </span>
      </div>

      {open && (
        <ul className={s.dropdown}>
          {list.map((c) => (
            <li
              key={`${c.iso2}${c.code}`}
              className={s.item}
              onMouseDown={(e) => { e.preventDefault(); pick(c) }}
            >
              <span className={s.flag}>{countryFlag(c.iso2)}</span>
              <span className={s.name}>{c.name}</span>
              <span className={s.phoneCode}>{c.code}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
