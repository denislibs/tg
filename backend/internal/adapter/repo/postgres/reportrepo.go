package postgres

import (
	"context"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/messenger-denis/backend/internal/domain"
	usecasereport "github.com/messenger-denis/backend/internal/usecase/report"
)

// ReportRepo реализует report.Repo поверх таблицы reports.
type ReportRepo struct{ pool *pgxpool.Pool }

// NewReportRepo создаёт репозиторий жалоб.
func NewReportRepo(pool *pgxpool.Pool) *ReportRepo { return &ReportRepo{pool: pool} }

var _ usecasereport.Repo = (*ReportRepo)(nil)

// Add пишет все строки одним INSERT … SELECT unnest: оператор атомарен, поэтому
// жалоба на несколько сообщений ложится целиком или не ложится вовсе.
func (r *ReportRepo) Add(ctx context.Context, reps []domain.Report) error {
	if len(reps) == 0 {
		return nil
	}
	reporters := make([]int64, len(reps))
	chats := make([]int64, len(reps))
	msgs := make([]*int64, len(reps))
	reasons := make([]string, len(reps))
	comments := make([]*string, len(reps))
	for n, rep := range reps {
		reporters[n], chats[n], msgs[n], reasons[n] = rep.ReporterID, rep.ChatID, rep.MsgID, string(rep.Reason)
		if rep.Comment != "" {
			c := rep.Comment
			comments[n] = &c
		}
	}
	_, err := querier(ctx, r.pool).Exec(ctx,
		`INSERT INTO reports (reporter_id, chat_id, msg_id, reason, comment)
		 SELECT * FROM unnest($1::bigint[], $2::bigint[], $3::bigint[], $4::text[], $5::text[])`,
		reporters, chats, msgs, reasons, comments)
	if isForeignKeyViolation(err) {
		return domain.ErrNotFound
	}
	return err
}
