package postgres

import (
	"context"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

type ctxKey int

const txKey ctxKey = 0

// Querier is satisfied by both *pgxpool.Pool and pgx.Tx, so repository methods
// can run either standalone or inside a transaction.
type Querier interface {
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

// TxManager begins a pgx transaction and carries it in the context.
type TxManager struct{ pool *pgxpool.Pool }

func NewTxManager(pool *pgxpool.Pool) *TxManager { return &TxManager{pool: pool} }

// WithinTx runs fn inside a transaction. The tx is stashed in the ctx passed to
// fn; repo adapters pick it up via querier(ctx, pool).
func (m *TxManager) WithinTx(ctx context.Context, fn func(context.Context) error) error {
	tx, err := m.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if err := fn(context.WithValue(ctx, txKey, tx)); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// querier returns the ctx-carried tx if present, else the pool.
func querier(ctx context.Context, pool *pgxpool.Pool) Querier {
	if tx, ok := ctx.Value(txKey).(pgx.Tx); ok {
		return tx
	}
	return pool
}
