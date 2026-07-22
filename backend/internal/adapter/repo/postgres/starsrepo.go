package postgres

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/messenger-denis/backend/internal/domain"
)

// StarsRepo — баланс звёзд (user_stars), каталог (star_gifts) и выданные
// подарки (saved_star_gifts).
type StarsRepo struct {
	pool *pgxpool.Pool
}

func NewStarsRepo(pool *pgxpool.Pool) *StarsRepo { return &StarsRepo{pool: pool} }

func (r *StarsRepo) Balance(ctx context.Context, userID int64) (int64, error) {
	var bal int64
	err := querier(ctx, r.pool).QueryRow(ctx,
		`SELECT balance FROM user_stars WHERE user_id=$1`, userID).Scan(&bal)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, nil
	}
	return bal, err
}

// AddBalance атомарно меняет баланс на delta (upsert). Недостаток средств при
// списании → domain.ErrForbidden (баланс не уходит в минус).
func (r *StarsRepo) AddBalance(ctx context.Context, userID, delta int64) (int64, error) {
	var bal int64
	err := querier(ctx, r.pool).QueryRow(ctx,
		`INSERT INTO user_stars (user_id, balance) VALUES ($1, $2)
		 ON CONFLICT (user_id) DO UPDATE SET balance = user_stars.balance + $2
		 WHERE user_stars.balance + $2 >= 0
		 RETURNING balance`,
		userID, delta).Scan(&bal)
	if errors.Is(err, pgx.ErrNoRows) {
		// конфликт был, но WHERE не прошёл (ушли бы в минус) — недостаточно звёзд
		return 0, domain.ErrForbidden
	}
	return bal, err
}

func (r *StarsRepo) Catalog(ctx context.Context) ([]domain.StarGift, error) {
	rows, err := querier(ctx, r.pool).Query(ctx,
		`SELECT id, emoji, title, price_stars, convert_stars, total, remains,
		        (remains IS NOT NULL AND remains <= 0) AS sold_out
		   FROM star_gifts ORDER BY sort, id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []domain.StarGift
	for rows.Next() {
		var g domain.StarGift
		if e := rows.Scan(&g.ID, &g.Emoji, &g.Title, &g.PriceStars, &g.ConvertStars, &g.Total, &g.Remains, &g.SoldOut); e != nil {
			return nil, e
		}
		out = append(out, g)
	}
	return out, rows.Err()
}

func (r *StarsRepo) GiftByID(ctx context.Context, giftID int64) (domain.StarGift, error) {
	var g domain.StarGift
	err := querier(ctx, r.pool).QueryRow(ctx,
		`SELECT id, emoji, title, price_stars, convert_stars, total, remains,
		        (remains IS NOT NULL AND remains <= 0) AS sold_out
		   FROM star_gifts WHERE id=$1`, giftID).
		Scan(&g.ID, &g.Emoji, &g.Title, &g.PriceStars, &g.ConvertStars, &g.Total, &g.Remains, &g.SoldOut)
	if errors.Is(err, pgx.ErrNoRows) {
		return domain.StarGift{}, domain.ErrNotFound
	}
	return g, err
}

// DecRemains уменьшает остаток ограниченного подарка (безлимитный — no-op).
func (r *StarsRepo) DecRemains(ctx context.Context, giftID int64) error {
	_, err := querier(ctx, r.pool).Exec(ctx,
		`UPDATE star_gifts SET remains = remains - 1 WHERE id=$1 AND remains IS NOT NULL AND remains > 0`, giftID)
	return err
}

func (r *StarsRepo) SaveGift(ctx context.Context, ownerID int64, fromID *int64, giftID int64, message string, anonymous bool) (int64, error) {
	var id int64
	err := querier(ctx, r.pool).QueryRow(ctx,
		`INSERT INTO saved_star_gifts (owner_id, from_id, gift_id, message, anonymous)
		 VALUES ($1,$2,$3,$4,$5) RETURNING id`,
		ownerID, fromID, giftID, message, anonymous).Scan(&id)
	return id, err
}

// giftInfoRow — общий SELECT для GiftInfo (подарок + каталог + отправитель).
const giftInfoCols = `sg.id, sg.owner_id, sg.from_id, sg.message, sg.anonymous, sg.hidden, sg.converted,
	g.id, g.emoji, g.title, g.price_stars, g.convert_stars, g.total, g.remains,
	(g.remains IS NOT NULL AND g.remains <= 0),
	COALESCE(u.display_name, ''), sg.created_at`

func scanGiftInfo(s scanner, viewerID int64) (domain.GiftInfo, int64, error) {
	var gi domain.GiftInfo
	var ownerID int64
	var fromName string
	var createdAt time.Time
	err := s.Scan(&gi.ID, &ownerID, &gi.FromID, &gi.Message, &gi.Anonymous, &gi.Hidden, &gi.Converted,
		&gi.Gift.ID, &gi.Gift.Emoji, &gi.Gift.Title, &gi.Gift.PriceStars, &gi.Gift.ConvertStars,
		&gi.Gift.Total, &gi.Gift.Remains, &gi.Gift.SoldOut, &fromName, &createdAt)
	if err != nil {
		return domain.GiftInfo{}, 0, err
	}
	gi.ConvertStars = gi.Gift.ConvertStars
	gi.Date = createdAt.UTC().Format(time.RFC3339)
	// Отправитель раскрывается только не-анонимного подарка, либо владельцу.
	if gi.Anonymous && viewerID != ownerID {
		gi.FromID = nil
	} else {
		gi.FromName = fromName
	}
	return gi, ownerID, nil
}

func (r *StarsRepo) GiftInfo(ctx context.Context, savedID, viewerID int64) (domain.GiftInfo, error) {
	row := querier(ctx, r.pool).QueryRow(ctx,
		`SELECT `+giftInfoCols+`
		   FROM saved_star_gifts sg
		   JOIN star_gifts g ON g.id = sg.gift_id
		   LEFT JOIN users u ON u.id = sg.from_id
		  WHERE sg.id=$1`, savedID)
	gi, _, err := scanGiftInfo(row, viewerID)
	if errors.Is(err, pgx.ErrNoRows) {
		return domain.GiftInfo{}, domain.ErrNotFound
	}
	return gi, err
}

func (r *StarsRepo) ProfileGifts(ctx context.Context, ownerID, viewerID int64) ([]domain.GiftInfo, error) {
	// Владелец видит и скрытые; остальные — только показанные. Обменянные
	// (converted) не показываются никому.
	where := `sg.owner_id=$1 AND NOT sg.converted`
	if ownerID != viewerID {
		where += ` AND NOT sg.hidden`
	}
	rows, err := querier(ctx, r.pool).Query(ctx,
		`SELECT `+giftInfoCols+`
		   FROM saved_star_gifts sg
		   JOIN star_gifts g ON g.id = sg.gift_id
		   LEFT JOIN users u ON u.id = sg.from_id
		  WHERE `+where+`
		  ORDER BY sg.created_at DESC`, ownerID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []domain.GiftInfo
	for rows.Next() {
		gi, _, e := scanGiftInfo(rows, viewerID)
		if e != nil {
			return nil, e
		}
		out = append(out, gi)
	}
	return out, rows.Err()
}

func (r *StarsRepo) SetHidden(ctx context.Context, savedID, ownerID int64, hidden bool) error {
	tag, err := querier(ctx, r.pool).Exec(ctx,
		`UPDATE saved_star_gifts SET hidden=$3 WHERE id=$1 AND owner_id=$2`, savedID, ownerID, hidden)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return domain.ErrForbidden
	}
	return nil
}

// Convert помечает подарок обменянным (только владелец, только раз) и
// возвращает число звёзд к зачислению (convert_stars из каталога).
func (r *StarsRepo) Convert(ctx context.Context, savedID, ownerID int64) (int64, error) {
	var stars int64
	err := querier(ctx, r.pool).QueryRow(ctx,
		`UPDATE saved_star_gifts sg SET converted=true
		   FROM star_gifts g
		  WHERE sg.id=$1 AND sg.owner_id=$2 AND NOT sg.converted AND g.id = sg.gift_id
		  RETURNING g.convert_stars`, savedID, ownerID).Scan(&stars)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, domain.ErrForbidden
	}
	return stars, err
}
