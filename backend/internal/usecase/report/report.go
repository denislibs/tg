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

// Repo — хранилище жалоб.
type Repo interface {
	Add(ctx context.Context, r domain.Report) error
}

// Interactor — приём жалоб.
type Interactor struct{ repo Repo }

// New создаёт usecase жалоб.
func New(repo Repo) *Interactor { return &Interactor{repo: repo} }

// Report складывает жалобу. msgID == nil — жалоба на чат целиком. Причина обязана
// быть из белого списка (domain.ValidReportReason), иначе domain.ErrInvalid.
func (i *Interactor) Report(ctx context.Context, reporterID, chatID int64, msgID *int64, reason domain.ReportReason, comment string) error {
	if reporterID <= 0 || chatID == 0 {
		return domain.ErrInvalid
	}
	if !domain.ValidReportReason(reason) {
		return domain.ErrInvalid
	}
	comment = strings.TrimSpace(comment)
	if len(comment) > commentMaxLen {
		comment = comment[:commentMaxLen]
	}
	return i.repo.Add(ctx, domain.Report{
		ReporterID: reporterID,
		ChatID:     chatID,
		MsgID:      msgID,
		Reason:     reason,
		Comment:    comment,
	})
}
