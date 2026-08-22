package postgres

import (
	"context"
	"testing"

	storepostgres "github.com/messenger-denis/backend/internal/store/postgres"
)

// Миграция 0118 переводит замороженные кадры диалогов на конструкторы схемы.
//
// Главное, что она обязана сделать, — перестать выражать значения признаками:
// «открепили» становится ОТСУТСТВИЕМ бита, а архив — НОМЕРОМ ПАПКИ рядом с
// пиром (и «вернуть из архива» это ноль, а не второй кадр).
const dialogFrameMigrationPrevVersion = 117

func TestMigration0118_DialogFramesBecomeConstructors(t *testing.T) {
	pool, url := storepostgres.NewTestDBWithURL(t)
	ctx := context.Background()

	if err := storepostgres.MigrateDownTo(url, dialogFrameMigrationPrevVersion); err != nil {
		t.Fatalf("откат до %d: %v", dialogFrameMigrationPrevVersion, err)
	}

	user := seedUser(t, pool, "+79990009001")
	peer := seedUser(t, pool, "+79990009002")

	if _, err := pool.Exec(ctx,
		`INSERT INTO updates (user_id, pts, type, payload) VALUES
		   ($1, 1, 'dialog_pin',     jsonb_build_object('peer_id', $2::bigint, 'pinned', true)),
		   ($1, 2, 'dialog_pin',     jsonb_build_object('peer_id', -5::bigint, 'pinned', false)),
		   ($1, 3, 'dialog_archive', jsonb_build_object('peer_id', $2::bigint, 'archived', true)),
		   ($1, 4, 'dialog_archive', jsonb_build_object('peer_id', $2::bigint, 'archived', false)),
		   ($1, 5, 'dialog_mute',    jsonb_build_object('peer_id', -5::bigint, 'notify_settings',
		      jsonb_build_object('_', 'peerNotifySettings', 'mute_until', 2147483647)))`,
		user, peer); err != nil {
		t.Fatalf("seed updates: %v", err)
	}

	if err := storepostgres.Migrate(url); err != nil {
		t.Fatalf("накат 0118: %v", err)
	}

	// Закрепление: бит есть у пина и ОТСУТСТВУЕТ у анпина.
	var tag, peerTag, innerTag string
	var pinned *bool
	if err := pool.QueryRow(ctx,
		`SELECT payload->>'_', payload->'peer'->>'_', payload->'peer'->'peer'->>'_',
		        (payload->'pFlags'->>'pinned')::boolean
		   FROM updates WHERE pts = 1`).Scan(&tag, &peerTag, &innerTag, &pinned); err != nil {
		t.Fatalf("кадр закрепления: %v", err)
	}
	if tag != "updateDialogPinned" || peerTag != "dialogPeer" || innerTag != "peerUser" {
		t.Fatalf("кадр закрепления = %s/%s/%s", tag, peerTag, innerTag)
	}
	if pinned == nil || !*pinned {
		t.Fatal("у закрепления нет бита pinned")
	}
	var hasFlags, hasLegacy bool
	if err := pool.QueryRow(ctx,
		`SELECT payload ? 'pFlags', (payload ? 'pinned') OR (payload ? 'peer_id')
		   FROM updates WHERE pts = 2`).Scan(&hasFlags, &hasLegacy); err != nil {
		t.Fatalf("кадр открепления: %v", err)
	}
	if hasFlags {
		t.Fatal("у открепления появился pFlags — «выключено» снова стало значением")
	}
	if hasLegacy {
		t.Fatal("в кадре открепления остались поля старой формы")
	}

	// Архив: номер папки рядом с пиром; «вернуть» — ноль, тем же конструктором.
	var archTag, folderPeerTag string
	var folderID int
	if err := pool.QueryRow(ctx,
		`SELECT payload->>'_', payload->'folder_peers'->0->>'_',
		        (payload->'folder_peers'->0->>'folder_id')::int
		   FROM updates WHERE pts = 3`).Scan(&archTag, &folderPeerTag, &folderID); err != nil {
		t.Fatalf("кадр архива: %v", err)
	}
	if archTag != "updateFolderPeers" || folderPeerTag != "folderPeer" || folderID != 1 {
		t.Fatalf("кадр архива = %s/%s/%d", archTag, folderPeerTag, folderID)
	}
	if err := pool.QueryRow(ctx,
		`SELECT (payload->'folder_peers'->0->>'folder_id')::int FROM updates WHERE pts = 4`).Scan(&folderID); err != nil {
		t.Fatalf("кадр возврата: %v", err)
	}
	if folderID != 0 {
		t.Fatalf("папка возврата = %d; ждали общий список", folderID)
	}

	// Уведомления: ключ пира обёрнут, настройки со сроком остались как были.
	var muteTag, notifyPeerTag string
	var muteUntil int64
	if err := pool.QueryRow(ctx,
		`SELECT payload->>'_', payload->'peer'->>'_', (payload->'notify_settings'->>'mute_until')::bigint
		   FROM updates WHERE pts = 5`).Scan(&muteTag, &notifyPeerTag, &muteUntil); err != nil {
		t.Fatalf("кадр мьюта: %v", err)
	}
	if muteTag != "updateNotifySettings" || notifyPeerTag != "notifyPeer" || muteUntil != 2147483647 {
		t.Fatalf("кадр мьюта = %s/%s/%d", muteTag, notifyPeerTag, muteUntil)
	}

	// Круг Down → Up.
	if err := storepostgres.MigrateDownTo(url, dialogFrameMigrationPrevVersion); err != nil {
		t.Fatalf("откат: %v", err)
	}
	var archived bool
	if err := pool.QueryRow(ctx, `SELECT (payload->>'archived')::boolean FROM updates WHERE pts = 3`).Scan(&archived); err != nil {
		t.Fatalf("после отката: %v", err)
	}
	if !archived {
		t.Fatal("после отката архив потерялся")
	}
	if err := storepostgres.Migrate(url); err != nil {
		t.Fatalf("повторный накат: %v", err)
	}
	if err := pool.QueryRow(ctx,
		`SELECT (payload->'folder_peers'->0->>'folder_id')::int FROM updates WHERE pts = 3`).Scan(&folderID); err != nil {
		t.Fatalf("после круга: %v", err)
	}
	if folderID != 1 {
		t.Fatalf("после круга Down→Up папка = %d", folderID)
	}
}
