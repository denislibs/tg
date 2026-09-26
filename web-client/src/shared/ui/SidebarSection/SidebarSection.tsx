import type { ReactNode } from 'react'

interface SidebarSectionProps {
  /** заголовок секции — tweb `SectionName` (`section.tsx:60-71`) */
  title?: ReactNode
  /** подпись под карточкой — tweb `SectionCaption` на месте по умолчанию (`section.tsx:112`) */
  caption?: ReactNode
  children: ReactNode
}

// React-двойник tweb `src/components/section.tsx` (812502980) — на время переезда
// React-экранов настроек на Solid `Section` (`components/section.solid.tsx`; план волны 2D,
// снос — задача 31). Стили общие (`styles/tweb/_section.scss`), поэтому и разметка та же:
//
//   div.sidebar-left-section-container                          (:84-89)
//     div.sidebar-left-section                                  (:92-99)
//       div.sidebar-left-section-content                        (:101-108)
//         [div.sidebar-left-h2.sidebar-left-section-name > span] (:102-106)
//         …дети…
//     [div.sidebar-left-section-content.sidebar-left-section-caption]   (:112)
//
// Подпись — СОСЕД карточки внутри контейнера, не её ребёнок: так в HEAD и в старой базе
// (`settingSection.ts:72-79`, `container.append`), так в дампах `15-right-12-edit-group`
// (подпись «You can provide an optional description…» — ребёнок `-container`) и
// `14-left-14-settings-notifications`. Заголовок — первым ребёнком контент-блока.
// Остальные опции tweb (`captionOld`/`captionTop`, `noShadow`, `noMarginBottom`, …) не
// заведены: единственный потребитель — `components/settings/kit.tsx::Section` — их не
// передаёт.
export default function SidebarSection({ title, caption, children }: SidebarSectionProps) {
  return (
    <div className="sidebar-left-section-container">
      <div className="sidebar-left-section">
        <div className="sidebar-left-section-content">
          {title != null && (
            <div className="sidebar-left-h2 sidebar-left-section-name">
              <span>{title}</span>
            </div>
          )}
          {children}
        </div>
      </div>
      {caption != null && (
        <div className="sidebar-left-section-content sidebar-left-section-caption">{caption}</div>
      )}
    </div>
  )
}
