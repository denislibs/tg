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

func (r *ReportRepo) Add(ctx context.Context, rep domain.Report) error {
	var comment any
	if rep.Comment != "" {
		comment = rep.Comment
	}
	_, err := querier(ctx, r.pool).Exec(ctx,
		`INSERT INTO reports (reporter_id, chat_id, msg_id, reason, comment) VALUES ($1,$2,$3,$4,$5)`,
		rep.ReporterID, rep.ChatID, rep.MsgID, string(rep.Reason), comment)
	if isForeignKeyViolation(err) {
		return domain.ErrNotFound
	}
	return err
}
