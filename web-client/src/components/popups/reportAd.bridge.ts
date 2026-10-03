// ВРЕМЕННО до 2C-27 — мост вместо `showMessageReport`/`showPeerReport` из tweb
// `src/components/popups/reportAd.tsx:360-393` (812502980). Solid-попап жалобы
// с деревом вариантов от сервера (`messages.report` → `ReportResult`) портирует
// задача 27 плана 2C; до неё жалобу принимает наш React `ReportPopup`
// (`components/ReportPopup.tsx`, остров оверлеев), цель которому кладёт
// `reportStore`. Задача 2C-27 заменяет импорт у вызывающих на
// `@components/popups/reportAd` и удаляет этот файл:
// `git grep -n "ВРЕМЕННО до 2C-27"` → пусто.
//
// Чего мост не умеет (закроет 2C-27):
//  1. жалоба на ПАЧКУ сообщений: `ReportPopup` адресует одно сообщение
//     (`ReportTarget.msgId`), поэтому уходит первое из выбранных;
//  2. `onFinish` оригинала зовётся по ОТПРАВКЕ жалобы, у моста — сразу: React-попап
//     исхода наружу не отдаёт. Единственный вызывающий с `onFinish` — снятие
//     выделения после жалобы на выбранное (tweb contextMenu.ts:1343-1347).
import { useReportStore } from '@stores/reportStore'

/** tweb `reportAd.tsx:360-366` */
export function showMessageReport(peerId: PeerId, mids: number[], onFinish?: () => void) {
  if(!mids.length) return
  useReportStore.getState().open({ peerId, msgId: mids[0] })
  onFinish?.()
}

/** tweb `reportAd.tsx:368-392` — жалоба на чат целиком (пункт ⋮ шапки, сосед П-5 «шапка»). */
export function showPeerReport(peerId: PeerId) {
  useReportStore.getState().open({ peerId })
}
