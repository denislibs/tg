package postgres

import (
	"context"
	"testing"

	storepostgres "github.com/messenger-denis/backend/internal/store/postgres"
)

// Миграция 0114 переводит замороженные кадры удаления и «вложение прослушано»
// на НАШИ конструкторы: схемные пира не несут, а наша нумерация пер-чатная.
//
// Цена ошибки — перепутанный конструктор у соседнего типа: оба кадра лежат в
// одной таблице и различаются только колонкой `type`.
const deleteMediaFrameMigrationPrevVersion = 113

func TestMigration0114_DeleteAndMediaReadBecomeConstructors(t *testing.T) {
	pool, url := storepostgres.NewTestDBWithURL(t)
	ctx := context.Background()

	if err := storepostgres.MigrateDownTo(url, deleteMediaFrameMigrationPrevVersion); err != nil {
		t.Fatalf("откат до %d: %v", deleteMediaFrameMigrationPrevVersion, err)
	}

	user := seedUser(t, pool, "+79990005001")
	peer := seedUser(t, pool, "+79990005002")

	if _, err := pool.Exec(ctx,
		`INSERT INTO updates (user_id, pts, type, payload) VALUES
		   ($1, 1, 'delete_message', jsonb_build_object('id', 12, 'peer_id', $2::bigint, 'for_me', true)),
		   ($1, 2, 'media_read',     jsonb_build_object('id', 13, 'peer_id', $2::bigint))`,
		user, peer); err != nil {
		t.Fatalf("seed updates: %v", err)
	}

	if err := storepostgres.Migrate(url); err != nil {
		t.Fatalf("накат 0114: %v", err)
	}

	assertFrame := func(pts int, wantTag string, wantMsg int64) {
		t.Helper()
		var tag, peerTag string
		var msgID int64
		if err := pool.QueryRow(ctx,
			`SELECT payload->>'_', payload->'peer'->>'_', (payload->'messages'->>0)::bigint
			   FROM updates WHERE pts=$1`, pts).Scan(&tag, &peerTag, &msgID); err != nil {
			t.Fatalf("кадр pts=%d: %v", pts, err)
		}
		if tag != wantTag {
			t.Fatalf("кадр pts=%d = %q, want %q", pts, tag, wantTag)
		}
		if peerTag != "peerUser" || msgID != wantMsg {
			t.Fatalf("кадр pts=%d: peer=%s, messages[0]=%d", pts, peerTag, msgID)
		}
	}
	assertFrame(1, "updateDeletePeerMessages", 12)
	assertFrame(2, "updateReadPeerMessagesContents", 13)

	// Признак «удалить у себя» исчез: предмета у него нет ни в схеме, ни у нас.
	var hasForMe bool
	if err := pool.QueryRow(ctx,
		`SELECT bool_or(payload ? 'for_me') FROM updates`).Scan(&hasForMe); err != nil {
		t.Fatalf("for_me: %v", err)
	}
	if hasForMe {
		t.Fatal("в кадре остался for_me — поле без предмета уехало на провод")
	}

	// Круг Down → Up.
	if err := storepostgres.MigrateDownTo(url, deleteMediaFrameMigrationPrevVersion); err != nil {
		t.Fatalf("откат: %v", err)
	}
	var flatID, flatPeer int64
	if err := pool.QueryRow(ctx,
		`SELECT (payload->>'id')::bigint, (payload->>'peer_id')::bigint FROM updates WHERE pts=1`).
		Scan(&flatID, &flatPeer); err != nil {
		t.Fatalf("после отката: %v", err)
	}
	if flatID != 12 || flatPeer != peer {
		t.Fatalf("после отката id=%d peer_id=%d", flatID, flatPeer)
	}
	if err := storepostgres.Migrate(url); err != nil {
		t.Fatalf("повторный накат: %v", err)
	}
	assertFrame(1, "updateDeletePeerMessages", 12)
}
