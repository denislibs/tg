package postgres

import (
	"context"
	"testing"

	storepostgres "github.com/messenger-denis/backend/internal/store/postgres"
)

// Миграция 0121 переводит кадры вложений, меняющихся после отправки.
//
// Проверяются обе адресации сразу: своим id внутри объекта (опрос) и парой
// «пир + номер» (превью ссылки, проверка факта, платное медиа) — перепутать их
// легко, а разница видна только на переигрывании.
const attachmentFramesMigrationPrevVersion = 120

func TestMigration0121_AttachmentFramesBecomeConstructors(t *testing.T) {
	pool, url := storepostgres.NewTestDBWithURL(t)
	ctx := context.Background()

	if err := storepostgres.MigrateDownTo(url, attachmentFramesMigrationPrevVersion); err != nil {
		t.Fatalf("откат до %d: %v", attachmentFramesMigrationPrevVersion, err)
	}

	user := seedUser(t, pool, "+79990012001")
	peer := seedUser(t, pool, "+79990012002")

	if _, err := pool.Exec(ctx,
		`INSERT INTO updates (user_id, pts, type, payload) VALUES
		   ($1, 1, 'poll_update', jsonb_build_object('peer_id', $2::bigint, 'media', jsonb_build_object(
		      '_', 'messageMediaPoll',
		      'poll', jsonb_build_object('_', 'poll', 'id', 77),
		      'results', jsonb_build_object('_', 'pollResults', 'pFlags', jsonb_build_object('min', true))))),
		   ($1, 2, 'web_page_update', jsonb_build_object('peer_id', $2::bigint, 'id', 12,
		      'media', jsonb_build_object('_', 'messageMediaWebPage'))),
		   ($1, 3, 'factcheck_update', jsonb_build_object('peer_id', $2::bigint, 'id', 12,
		      'factcheck', jsonb_build_object('text', 'проверено'))),
		   ($1, 4, 'factcheck_update', jsonb_build_object('peer_id', $2::bigint, 'id', 13, 'factcheck', NULL)),
		   ($1, 5, 'paid_media_unlock', jsonb_build_object('_', 'updateNewMessage', 'pts_count', 1,
		      'message', jsonb_build_object('_', 'message', 'id', 14,
		         'peer_id', jsonb_build_object('_', 'peerUser', 'user_id', $2::bigint),
		         'media', jsonb_build_object('_', 'messageMediaPaidMedia',
		            'extended_media', jsonb_build_array(jsonb_build_object('_', 'messageExtendedMedia'))))))`,
		user, peer); err != nil {
		t.Fatalf("seed updates: %v", err)
	}

	if err := storepostgres.Migrate(url); err != nil {
		t.Fatalf("накат 0121: %v", err)
	}

	// Опрос: адрес — СВОЙ id, итоги отдельным параметром (не внутри вложения).
	var tag string
	var pollID int64
	var minFlag bool
	if err := pool.QueryRow(ctx,
		`SELECT payload->>'_', (payload->>'poll_id')::bigint, (payload->'results'->'pFlags'->>'min')::boolean
		   FROM updates WHERE pts = 1`).Scan(&tag, &pollID, &minFlag); err != nil {
		t.Fatalf("кадр опроса: %v", err)
	}
	var pollPeer string
	if err := pool.QueryRow(ctx, `SELECT payload->'peer'->>'_' FROM updates WHERE pts = 1`).Scan(&pollPeer); err != nil {
		t.Fatalf("пир кадра опроса: %v", err)
	}
	if pollPeer != "peerUser" {
		t.Fatalf("пир кадра опроса = %q", pollPeer)
	}
	if tag != "updateMessagePoll" || pollID != 77 || !minFlag {
		t.Fatalf("кадр опроса = %s/%d/min=%v", tag, pollID, minFlag)
	}

	// Превью ссылки: пара «пир + номер», ключ пира конструктором.
	var wpTag, peerTag string
	var msgID int64
	if err := pool.QueryRow(ctx,
		`SELECT payload->>'_', payload->'peer'->>'_', (payload->>'msg_id')::bigint
		   FROM updates WHERE pts = 2`).Scan(&wpTag, &peerTag, &msgID); err != nil {
		t.Fatalf("кадр превью: %v", err)
	}
	if wpTag != "updateMessageWebPage" || peerTag != "peerUser" || msgID != 12 {
		t.Fatalf("кадр превью = %s/%s/%d", wpTag, peerTag, msgID)
	}

	// Проверка факта: есть — параметр на месте; снята — параметра НЕТ ВОВСЕ.
	var fcText string
	if err := pool.QueryRow(ctx,
		`SELECT payload->'factcheck'->>'text' FROM updates WHERE pts = 3`).Scan(&fcText); err != nil {
		t.Fatalf("кадр проверки: %v", err)
	}
	if fcText != "проверено" {
		t.Fatalf("проверка факта = %q", fcText)
	}
	var hasFactCheck bool
	if err := pool.QueryRow(ctx,
		`SELECT payload ? 'factcheck' FROM updates WHERE pts = 4`).Scan(&hasFactCheck); err != nil {
		t.Fatalf("кадр снятия проверки: %v", err)
	}
	if hasFactCheck {
		t.Fatal("снятая проверка осталась ключом со значением null: отсутствие обязано быть отсутствием")
	}

	// Платное медиа: ровно предмет, а не копия всего сообщения.
	var pmTag string
	var items int
	var hasMessage bool
	if err := pool.QueryRow(ctx,
		`SELECT payload->>'_', jsonb_array_length(payload->'extended_media'), payload ? 'message'
		   FROM updates WHERE pts = 5`).Scan(&pmTag, &items, &hasMessage); err != nil {
		t.Fatalf("кадр разблокировки: %v", err)
	}
	if pmTag != "updateMessageExtendedMedia" || items != 1 {
		t.Fatalf("кадр разблокировки = %s, позиций %d", pmTag, items)
	}
	if hasMessage {
		t.Fatal("в кадре разблокировки осталась копия всего сообщения")
	}

	// Круг Down → Up (кадр разблокировки обратно не восстанавливается — так и
	// объявлено в самой миграции).
	if err := storepostgres.MigrateDownTo(url, attachmentFramesMigrationPrevVersion); err != nil {
		t.Fatalf("откат: %v", err)
	}
	var flatMedia string
	if err := pool.QueryRow(ctx, `SELECT payload->'media'->>'_' FROM updates WHERE pts = 1`).Scan(&flatMedia); err != nil {
		t.Fatalf("после отката: %v", err)
	}
	if flatMedia != "messageMediaPoll" {
		t.Fatalf("после отката вложение = %q", flatMedia)
	}
	if err := storepostgres.Migrate(url); err != nil {
		t.Fatalf("повторный накат: %v", err)
	}
	if err := pool.QueryRow(ctx, `SELECT payload->>'_' FROM updates WHERE pts = 1`).Scan(&tag); err != nil {
		t.Fatalf("после круга: %v", err)
	}
	if tag != "updateMessagePoll" {
		t.Fatalf("после круга Down→Up = %q", tag)
	}
	// Ключ пира круг тоже переживает: обратный ход возвращает его числом, прямой
	// снова собирает конструктор. Иначе после отката адрес молча стал бы нулевым.
	if err := pool.QueryRow(ctx, `SELECT payload->'peer'->>'_' FROM updates WHERE pts = 1`).Scan(&pollPeer); err != nil {
		t.Fatalf("пир после круга: %v", err)
	}
	if pollPeer != "peerUser" {
		t.Fatalf("пир после круга Down→Up = %q", pollPeer)
	}
}
