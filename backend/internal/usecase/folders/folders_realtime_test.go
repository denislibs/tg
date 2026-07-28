package folders

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/messenger-denis/backend/internal/domain"
)

// fakeUpdateLog — in-memory per-user update log (dense pts), like the postgres one.
type fakeUpdateLog struct {
	pts  map[int64]int64
	rows map[int64][]loggedRow
}

type loggedRow struct {
	pts     int64
	typ     string
	payload json.RawMessage
}

func newFakeUpdateLog() *fakeUpdateLog {
	return &fakeUpdateLog{pts: map[int64]int64{}, rows: map[int64][]loggedRow{}}
}

func (l *fakeUpdateLog) AppendUpdate(_ context.Context, userID int64, ptsCount int, _ int64, typ string, payload json.RawMessage) (int64, error) {
	l.pts[userID] += int64(ptsCount)
	p := l.pts[userID]
	l.rows[userID] = append(l.rows[userID], loggedRow{pts: p, typ: typ, payload: payload})
	return p, nil
}

// fakeFolderPub captures published frames per user.
type fakeFolderPub struct {
	frames map[int64][][]byte
}

func newFakeFolderPub() *fakeFolderPub { return &fakeFolderPub{frames: map[int64][][]byte{}} }

func (p *fakeFolderPub) PublishToUser(_ context.Context, userID int64, frame []byte) error {
	p.frames[userID] = append(p.frames[userID], frame)
	return nil
}

// folder_update: create/update/delete each log a dense-pts row to the owner's log
// and fan out a live frame carrying that pts.
func TestFolderUpdate_LoggedAndLive(t *testing.T) {
	uc, _, _ := setup()
	log := newFakeUpdateLog()
	pub := newFakeFolderPub()
	uc.SetUpdateLog(log)
	uc.SetPublisher(pub)
	ctx := context.Background()
	const owner int64 = 1

	// Create.
	f, err := uc.Create(ctx, owner, domain.Folder{Title: "Work", IncludeChats: []int64{10}})
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	assertFolderFrame(t, log, pub, owner, "folder", 1)

	// Update.
	f.Title = "Work2"
	if _, err := uc.Update(ctx, owner, f); err != nil {
		t.Fatalf("Update: %v", err)
	}
	assertFolderFrame(t, log, pub, owner, "folder", 2)

	// Delete → payload flags deleted:true, no folder snapshot.
	if err := uc.Delete(ctx, owner, f.ID); err != nil {
		t.Fatalf("Delete: %v", err)
	}
	pts := assertFolderFrame(t, log, pub, owner, "", 3)
	last := log.rows[owner][len(log.rows[owner])-1]
	var d map[string]any
	_ = json.Unmarshal(last.payload, &d)
	if d["deleted"] != true {
		t.Fatalf("delete row payload = %v; want deleted:true", d)
	}
	if int64(lastFramePts(t, pub, owner)) != pts {
		t.Fatalf("delete frame pts mismatch")
	}
}

// assertFolderFrame checks the owner's last logged row is folder_update at wantPts,
// its live frame carries that pts, and (when wantField != "") the payload has it.
func assertFolderFrame(t *testing.T, log *fakeUpdateLog, pub *fakeFolderPub, owner int64, wantField string, wantPts int64) int64 {
	t.Helper()
	rows := log.rows[owner]
	if len(rows) == 0 {
		t.Fatalf("no logged rows for owner %d", owner)
	}
	last := rows[len(rows)-1]
	if last.typ != "folder_update" {
		t.Fatalf("last row type = %q; want folder_update", last.typ)
	}
	if last.pts != wantPts {
		t.Fatalf("last row pts = %d; want %d", last.pts, wantPts)
	}
	if wantField != "" {
		var d map[string]any
		if err := json.Unmarshal(last.payload, &d); err != nil {
			t.Fatalf("unmarshal payload: %v", err)
		}
		if _, ok := d[wantField]; !ok {
			t.Fatalf("payload missing %q: %v", wantField, d)
		}
	}
	if int64(lastFramePts(t, pub, owner)) != wantPts {
		t.Fatalf("live frame pts = %d; want %d", int64(lastFramePts(t, pub, owner)), wantPts)
	}
	return last.pts
}

func lastFramePts(t *testing.T, pub *fakeFolderPub, owner int64) float64 {
	t.Helper()
	frames := pub.frames[owner]
	if len(frames) == 0 {
		t.Fatalf("no frames for owner %d", owner)
	}
	var env struct {
		T string         `json:"t"`
		D map[string]any `json:"d"`
	}
	if err := json.Unmarshal(frames[len(frames)-1], &env); err != nil {
		t.Fatalf("unmarshal frame: %v", err)
	}
	if env.T != "folder_update" {
		t.Fatalf("frame type = %q; want folder_update", env.T)
	}
	pts, ok := env.D["pts"].(float64)
	if !ok {
		t.Fatalf("frame missing pts: %v", env.D)
	}
	return pts
}
