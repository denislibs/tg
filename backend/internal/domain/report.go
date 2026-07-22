package domain

// Report — жалоба пользователя на чат или конкретное сообщение (tweb
// reportMessages / reportPeer). Модерации нет — обращения просто складируются.
type Report struct {
	ID         int64
	ReporterID int64
	ChatID     int64
	MsgID      *int64 // nil — жалоба на чат целиком
	Reason     ReportReason
	Comment    string
}

// ReportReason — причина жалобы из белого списка Telegram.
type ReportReason string

const (
	ReportReasonSpam       ReportReason = "spam"
	ReportReasonViolence   ReportReason = "violence"
	ReportReasonPorn       ReportReason = "porn"
	ReportReasonChildAbuse ReportReason = "child_abuse"
	ReportReasonOther      ReportReason = "other"
)

// ValidReportReason проверяет, что причина входит в белый список.
func ValidReportReason(r ReportReason) bool {
	switch r {
	case ReportReasonSpam, ReportReasonViolence, ReportReasonPorn, ReportReasonChildAbuse, ReportReasonOther:
		return true
	default:
		return false
	}
}
