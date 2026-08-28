package chat

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/messenger-denis/backend/internal/domain"
)

// Кадры диалогов — конструкторы схемы, а не словари с признаками.
//
// Три проверки на каждый кадр, и каждая закрывает свой способ разъехаться со
// схемой:
//
//  1. форма: тот конструктор, те вложенные обёртки пира, тех прежних ключей
//     («pinned», «archived», «peer_id») больше нет;
//  2. журнал и живой кадр — ОДНО тело: /sync переигрывает ровно то, что уехало
//     живым путём;
//  3. КОДЕК: тело живого кадра кодируется в TL. Это не украшение — кодек
//     отвергает и лишний ключ (checkNoStrayFields), и пропущенный обязательный
//     параметр, то есть проверяет соответствие конструктору целиком, а не по
//     тем полям, которые вспомнил автор теста.
func TestDialogFrames_AreSchemaConstructors(t *testing.T) {
	in, s, _, pub := newLoggedGroupInteractor()
	ctx := context.Background()
	const owner int64 = 7
	chatID, err := in.CreateGroup(ctx, owner, "Team", "", "", false, nil)
	if err != nil {
		t.Fatalf("CreateGroup: %v", err)
	}

	// ── Закрепление: бит, а не поле ─────────────────────────────────────────
	pub.reset()
	if err := in.PinDialog(ctx, chatID, owner, true); err != nil {
		t.Fatalf("PinDialog: %v", err)
	}
	d := lastFrameOfType(t, pub, owner, "dialog_pin")
	assertFrameEqualsLoggedRow(t, s, owner, "dialog_pin", d)
	if d["_"] != domain.UpdateDialogPinnedTag {
		t.Fatalf("кадр закрепления = %v", d["_"])
	}
	peer, _ := d["peer"].(map[string]any)
	if peer["_"] != domain.DialogPeerTag {
		t.Fatalf("ключ пира не обёрнут в dialogPeer: %#v", d["peer"])
	}
	if inner, _ := peer["peer"].(map[string]any); inner["_"] != "peerChannel" {
		t.Fatalf("внутри dialogPeer не ссылка на пир: %#v", peer["peer"])
	}
	if pf, _ := d["pFlags"].(map[string]any); pf["pinned"] != true {
		t.Fatalf("у закрепления нет бита pinned: %#v", d["pFlags"])
	}
	assertEncodesAsTL(t, d)

	// «Открепили» — ТОТ ЖЕ конструктор с опущенным битом.
	pub.reset()
	if err := in.PinDialog(ctx, chatID, owner, false); err != nil {
		t.Fatalf("PinDialog(false): %v", err)
	}
	d = lastFrameOfType(t, pub, owner, "dialog_pin")
	if _, present := d["pFlags"]; present {
		t.Fatalf("у открепления появился pFlags: %#v", d)
	}
	if _, present := d["pinned"]; present {
		t.Fatalf("у открепления осталось поле pinned: %#v", d)
	}
	assertEncodesAsTL(t, d)

	// ── Архив: ПАПКА, а не признак ──────────────────────────────────────────
	pub.reset()
	if err := in.ArchiveDialog(ctx, chatID, owner, true); err != nil {
		t.Fatalf("ArchiveDialog: %v", err)
	}
	d = lastFrameOfType(t, pub, owner, "dialog_archive")
	assertFrameEqualsLoggedRow(t, s, owner, "dialog_archive", d)
	if d["_"] != domain.UpdateFolderPeersTag {
		t.Fatalf("кадр архива = %v", d["_"])
	}
	if _, present := d["archived"]; present {
		t.Fatalf("в кадре осталось поле archived: %#v", d)
	}
	if folder := folderIDOf(t, d); folder != int64(domain.FolderArchive) {
		t.Fatalf("папка кадра = %d; ждали архив (%d)", folder, domain.FolderArchive)
	}
	assertEncodesAsTL(t, d)

	// «Вернуть из архива» — тот же кадр с нулевой папкой.
	pub.reset()
	if err := in.ArchiveDialog(ctx, chatID, owner, false); err != nil {
		t.Fatalf("ArchiveDialog(false): %v", err)
	}
	d = lastFrameOfType(t, pub, owner, "dialog_archive")
	if folder := folderIDOf(t, d); folder != int64(domain.FolderAll) {
		t.Fatalf("папка возврата = %d; ждали общий список (%d)", folder, domain.FolderAll)
	}
	assertEncodesAsTL(t, d)

	// ── Мьют: настройки целиком, срок внутри ────────────────────────────────
	pub.reset()
	if err := in.SetMute(ctx, chatID, owner, true, nil); err != nil {
		t.Fatalf("SetMute: %v", err)
	}
	d = lastFrameOfType(t, pub, owner, "dialog_mute")
	assertFrameEqualsLoggedRow(t, s, owner, "dialog_mute", d)
	if d["_"] != domain.UpdateNotifySettingsTag {
		t.Fatalf("кадр мьюта = %v", d["_"])
	}
	if peer, _ := d["peer"].(map[string]any); peer["_"] != domain.NotifyPeerTag {
		t.Fatalf("ключ пира не обёрнут в notifyPeer: %#v", d["peer"])
	}
	settings, _ := d["notify_settings"].(map[string]any)
	if settings["_"] != domain.PeerNotifySettingsTag {
		t.Fatalf("настройки не конструктор: %#v", d["notify_settings"])
	}
	if settings["mute_until"] == nil {
		t.Fatal("в настройках нет срока: мьют снова стал признаком без срока годности")
	}
	assertEncodesAsTL(t, d)
}

// folderIDOf — номер папки из вектора folder_peers (вектор, потому что у
// оригинала одно действие переносит пачку; мы кладём в него один пир).
func folderIDOf(t *testing.T, d map[string]any) int64 {
	t.Helper()
	peers, _ := d["folder_peers"].([]any)
	if len(peers) != 1 {
		t.Fatalf("folder_peers = %#v; ждали ровно один пир", d["folder_peers"])
	}
	fp, _ := peers[0].(map[string]any)
	if fp["_"] != domain.FolderPeerTag {
		t.Fatalf("элемент вектора = %#v; ждали folderPeer", peers[0])
	}
	if inner, _ := fp["peer"].(map[string]any); inner["_"] == nil {
		t.Fatalf("в folderPeer нет ссылки на пир: %#v", fp)
	}
	return asInt64(t, fp["folder_id"])
}

// assertFrameEqualsLoggedRow — тело живого кадра совпадает с записью журнала.
// Курсор при этом сравнивать нечего: у записи он колонка, у кадра — параметр
// конструктора либо поле конверта.
func assertFrameEqualsLoggedRow(t *testing.T, s *store, userID int64, typ string, frame map[string]any) {
	t.Helper()
	s.mu.Lock()
	ups := append([]domain.UpdateRecord(nil), s.updates[userID]...)
	s.mu.Unlock()
	for i := len(ups) - 1; i >= 0; i-- {
		if ups[i].Type != typ {
			continue
		}
		var row map[string]any
		if err := json.Unmarshal(ups[i].Payload, &row); err != nil {
			t.Fatalf("разбор записи журнала: %v", err)
		}
		body := make(map[string]any, len(frame))
		for k, v := range frame {
			if k == "pts" {
				continue // пер-получательский курсор, у записи он колонка
			}
			body[k] = v
		}
		gotJSON, _ := json.Marshal(body)
		wantJSON, _ := json.Marshal(row)
		if string(gotJSON) != string(wantJSON) {
			t.Fatalf("кадр и запись журнала разошлись:\n кадр:   %s\n журнал: %s", gotJSON, wantJSON)
		}
		return
	}
	t.Fatalf("в журнале %d нет записи %q", userID, typ)
}

// assertEncodesAsTL — тело кадра кодируется в TL. Кодек отвергает лишний ключ и
// пропущенный обязательный параметр, поэтому проверяет соответствие
// конструктору ЦЕЛИКОМ, а не по вспомненным полям.
func assertEncodesAsTL(t *testing.T, body map[string]any) {
	t.Helper()
	if _, err := domain.WireCodec.Marshal(body); err != nil {
		t.Fatalf("тело кадра не кодируется в TL: %v\n%#v", err, body)
	}
}
