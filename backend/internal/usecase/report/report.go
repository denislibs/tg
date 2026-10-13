// Package report — жалобы на чаты и сообщения (tweb reportMessages / reportPeer).
// Модерации нет: обращение валидируется (причина из белого списка, лимит длины
// комментария) и складывается в хранилище.
package report

import (
	"context"
	"strings"

	"github.com/messenger-denis/backend/internal/domain"
)

// commentMaxLen — предел длины комментария к жалобе (символы отсекаются в usecase).
const commentMaxLen = 512

// MaxIDs — потолок вектора номеров в одной жалобе: messages.report несёт
// выбранные сообщения (в tweb — выделение в чате), а лишнее — не жалоба, а залив.
const MaxIDs = 100

// Repo — хранилище жалоб. Add пишет все строки одним действием: либо все, либо
// ни одной.
type Repo interface {
	Add(ctx context.Context, reps []domain.Report) error
}

// Interactor — приём жалоб.
type Interactor struct{ repo Repo }

// New создаёт usecase жалоб.
func New(repo Repo) *Interactor { return &Interactor{repo: repo} }

// Report складывает жалобу — messages.report{peer, id: Vector<int>, option,
// message} (tweb appMessagesManager.ts:7807-7827). msgIDs — внутренние ключи
// сообщений чата: на каждое своя строка. Пустой вектор — жалоба на чат целиком
// (reportAd.tsx:372). Больше MaxIDs номеров — domain.ErrInvalid.
// Причина обязана быть из белого списка (domain.ValidReportReason), иначе
// domain.ErrInvalid.
func (i *Interactor) Report(ctx context.Context, reporterID, chatID int64, msgIDs []int64, reason domain.ReportReason, comment string) error {
	if reporterID <= 0 || chatID == 0 {
		return domain.ErrInvalid
	}
	if !domain.ValidReportReason(reason) || len(msgIDs) > MaxIDs {
		return domain.ErrInvalid
	}
	comment = strings.TrimSpace(comment)
	if len(comment) > commentMaxLen {
		comment = comment[:commentMaxLen]
	}
	base := domain.Report{ReporterID: reporterID, ChatID: chatID, Reason: reason, Comment: comment}
	if len(msgIDs) == 0 {
		return i.repo.Add(ctx, []domain.Report{base})
	}
	reps := make([]domain.Report, 0, len(msgIDs))
	seen := make(map[int64]bool, len(msgIDs))
	for _, id := range msgIDs {
		if seen[id] {
			continue
		}
		seen[id] = true
		r := base
		r.MsgID = &id
		reps = append(reps, r)
	}
	return i.repo.Add(ctx, reps)
}
