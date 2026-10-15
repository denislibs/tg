package folders

import (
	"context"
	"encoding/json"
	"errors"
	"sort"
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
	f, err := uc.Create(ctx, owner, domain.DialogFilter{Title: "Work", IncludeChats: []int64{10}})
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

// snapshotTx — транзакция с откатом: при ошибке fn состояние репозитория
// возвращается к снимку (как ROLLBACK у Postgres).
type snapshotTx struct{ repo *fakeRepo }

func (t snapshotTx) WithinTx(ctx context.Context, fn func(context.Context) error) error {
	folders := map[int64]domain.DialogFilter{}
	for k, v := range t.repo.folders {
		folders[k] = v
	}
	allPos := map[int64]int{}
	for k, v := range t.repo.allPos {
		allPos[k] = v
	}
	if err := fn(ctx); err != nil {
		t.repo.folders, t.repo.allPos = folders, allPos
		return err
	}
	return nil
}

// failingLog — журнал, который отказывает в записи.
type failingLog struct{}

func (failingLog) AppendUpdate(context.Context, int64, int, int64, string, json.RawMessage) (int64, error) {
	return 0, errors.New("journal down")
}

func seedFolders(t *testing.T, uc *Interactor, owner int64, n int) []int64 {
	t.Helper()
	ids := make([]int64, 0, n)
	for k := 0; k < n; k++ {
		f, err := uc.Create(context.Background(), owner, domain.DialogFilter{Title: "f", IncludeChats: []int64{10}})
		if err != nil {
			t.Fatalf("Create: %v", err)
		}
		f.Pos = k
		uc.repo.(*fakeRepo).folders[f.ID] = f
		ids = append(ids, f.ID)
	}
	return ids
}

// Ф7-З: Reorder([0,3,1]) → место «Все чаты» = 0, порядок папок, строка журнала
// updateDialogFilterOrder с order как пришёл и кадр общего пути конструкторов
// {t, d, pts} (pts в конверте — у конструктора нет параметра pts). У чужого
// пользователя кадра нет.
func TestReorder_LoggedAndLive(t *testing.T) {
	uc, repo, _ := setup()
	log := newFakeUpdateLog()
	pub := newFakeFolderPub()
	uc.SetUpdateLog(log)
	uc.SetPublisher(pub)
	ctx := context.Background()
	const owner, stranger int64 = 1, 2
	ids := seedFolders(t, uc, owner, 3) // ids[0], ids[1], ids[2]
	logged := len(log.rows[owner])

	order := []int64{0, ids[2], ids[0]}
	if err := uc.Reorder(ctx, owner, order); err != nil {
		t.Fatalf("Reorder: %v", err)
	}
	if pos, _ := repo.AllChatsPos(ctx, owner); pos != 0 {
		t.Fatalf("allChatsPos = %d; want 0", pos)
	}
	got, _ := uc.List(ctx, owner)
	sort.Slice(got, func(a, b int) bool { return got[a].Pos < got[b].Pos })
	if len(got) != 3 || got[0].ID != ids[2] || got[1].ID != ids[0] || got[2].ID != ids[1] {
		t.Fatalf("list = %+v; want %d,%d,%d", got, ids[2], ids[0], ids[1])
	}

	rows := log.rows[owner][logged:]
	if len(rows) != 1 || rows[0].typ != domain.UpdateDialogFilterOrderTag {
		t.Fatalf("journal rows = %+v", rows)
	}
	var body struct {
		Underscore string  `json:"_"`
		Order      []int64 `json:"order"`
		Pts        *int64  `json:"pts"`
	}
	if err := json.Unmarshal(rows[0].payload, &body); err != nil {
		t.Fatal(err)
	}
	if body.Underscore != domain.UpdateDialogFilterOrderTag || len(body.Order) != 3 ||
		body.Order[0] != 0 || body.Order[1] != ids[2] || body.Order[2] != ids[0] || body.Pts != nil {
		t.Fatalf("journal body = %s", rows[0].payload)
	}

	frames := pub.frames[owner]
	var env struct {
		T   string         `json:"t"`
		D   map[string]any `json:"d"`
		Pts int64          `json:"pts"`
	}
	if err := json.Unmarshal(frames[len(frames)-1], &env); err != nil {
		t.Fatal(err)
	}
	if env.T != domain.UpdateDialogFilterOrderTag || env.Pts != rows[0].pts || env.D["_"] != domain.UpdateDialogFilterOrderTag {
		t.Fatalf("frame = %s", frames[len(frames)-1])
	}
	if _, inBody := env.D["pts"]; inBody {
		t.Fatalf("pts не должен лежать в теле: %v", env.D)
	}
	if len(pub.frames[stranger]) != 0 || len(log.rows[stranger]) != 0 {
		t.Fatalf("у чужого пользователя кадр/строка журнала: %v", pub.frames[stranger])
	}
}

// Без 0 в order место «Все чаты» не меняется (не-премиум, tweb chatFolders.tsx:365-367).
func TestReorder_WithoutAllChatsKeepsItsPos(t *testing.T) {
	uc, repo, _ := setup()
	ctx := context.Background()
	ids := seedFolders(t, uc, 1, 2)
	_ = repo.SetAllChatsPos(ctx, 1, 2)
	if err := uc.Reorder(ctx, 1, []int64{ids[1], ids[0]}); err != nil {
		t.Fatalf("Reorder: %v", err)
	}
	if pos, _ := repo.AllChatsPos(ctx, 1); pos != 2 {
		t.Fatalf("allChatsPos = %d; want 2", pos)
	}
}

// Место «Все чаты» — индекс 0 в order (число папок перед ней).
func TestReorder_AllChatsPosIsIndexOfZero(t *testing.T) {
	uc, repo, _ := setup()
	ctx := context.Background()
	ids := seedFolders(t, uc, 1, 3)
	if err := uc.Reorder(ctx, 1, []int64{ids[1], ids[0], 0, ids[2]}); err != nil {
		t.Fatalf("Reorder: %v", err)
	}
	if pos, _ := repo.AllChatsPos(ctx, 1); pos != 2 {
		t.Fatalf("allChatsPos = %d; want 2", pos)
	}
}

// Чужая/несуществующая папка, повтор id, второй 0 — ErrInvalid; ничего не пишется.
func TestReorder_Invalid(t *testing.T) {
	uc, repo, _ := setup()
	log := newFakeUpdateLog()
	pub := newFakeFolderPub()
	uc.SetUpdateLog(log)
	uc.SetPublisher(pub)
	ctx := context.Background()
	ids := seedFolders(t, uc, 1, 2)
	foreign := seedFolders(t, uc, 2, 1)[0]
	logged1, logged2 := len(log.rows[1]), len(log.rows[2])
	for name, order := range map[string][]int64{
		"чужая":          {ids[0], foreign},
		"несуществующая": {999},
		"повтор":         {ids[0], ids[0]},
		"два нуля":       {0, ids[0], 0},
	} {
		err := uc.Reorder(ctx, 1, order)
		if !errors.Is(err, domain.ErrInvalid) {
			t.Fatalf("%s: err = %v; want ErrInvalid", name, err)
		}
	}
	if len(log.rows[1]) != logged1 || len(log.rows[2]) != logged2 {
		t.Fatalf("журнал изменился при отказе")
	}
	if pos, _ := repo.AllChatsPos(ctx, 1); pos != 0 {
		t.Fatalf("allChatsPos = %d; want 0", pos)
	}
}

// Отказ журнала откатывает и pos папок, и место «Все чаты»; кадра нет.
func TestReorder_JournalFailureRollsBack(t *testing.T) {
	repo := newFakeRepo()
	uc := New(repo, &fakeChats{}, snapshotTx{repo})
	pub := newFakeFolderPub()
	uc.SetPublisher(pub)
	ctx := context.Background()
	ids := seedFolders(t, uc, 1, 2) // без журнала: сидим папки
	uc.SetUpdateLog(failingLog{})

	err := uc.Reorder(ctx, 1, []int64{0, ids[1], ids[0]})
	if err == nil {
		t.Fatal("Reorder: want error")
	}
	if pos, _ := repo.AllChatsPos(ctx, 1); pos != 0 {
		t.Fatalf("allChatsPos = %d; want 0", pos)
	}
	if repo.folders[ids[0]].Pos != 0 || repo.folders[ids[1]].Pos != 1 {
		t.Fatalf("pos изменились: %+v %+v", repo.folders[ids[0]], repo.folders[ids[1]])
	}
	if len(pub.frames[1]) != 0 {
		t.Fatalf("кадр ушёл при откате: %d", len(pub.frames[1]))
	}
	// Откат проверяем на не нулевой позиции тоже.
	repo.allPos[1] = 3
	if err := uc.Reorder(ctx, 1, []int64{ids[1], 0}); err == nil {
		t.Fatal("Reorder: want error")
	}
	if repo.allPos[1] != 3 {
		t.Fatalf("allChatsPos = %d; want 3", repo.allPos[1])
	}
}

// Перестановка в тот же порядок, пустой order и повтор «Все чаты» на том же месте
// ничего не пишут: ни строки журнала, ни кадра.
func TestReorder_NoOpWritesNothing(t *testing.T) {
	uc, repo, _ := setup()
	log := newFakeUpdateLog()
	pub := newFakeFolderPub()
	uc.SetUpdateLog(log)
	uc.SetPublisher(pub)
	ctx := context.Background()
	ids := seedFolders(t, uc, 1, 2)
	_ = repo.SetAllChatsPos(ctx, 1, 1)
	logged, framed := len(log.rows[1]), len(pub.frames[1])

	for name, order := range map[string][]int64{
		"пустой":         {},
		"nil":            nil,
		"тот же порядок": {ids[0], ids[1]},
		"тот же порядок с нулём": {ids[0], 0, ids[1]},
		"только нуль на месте":   {ids[0], 0},
	} {
		if err := uc.Reorder(ctx, 1, order); err != nil {
			t.Fatalf("%s: %v", name, err)
		}
	}
	if len(log.rows[1]) != logged || len(pub.frames[1]) != framed {
		t.Fatalf("no-op записал журнал/кадр: rows %d→%d frames %d→%d", logged, len(log.rows[1]), framed, len(pub.frames[1]))
	}
}

// Папок может быть больше лимита создания (вступление по ссылке лимит не
// проверяет): полный список из 11 папок и «Все чаты» переставляется.
func TestReorder_MoreThanCreateLimit(t *testing.T) {
	uc, _, _ := setup()
	uc.repo.(*fakeRepo).nextID = 100
	ids := make([]int64, 0, domain.MaxFoldersPerUser+1)
	for k := 0; k <= domain.MaxFoldersPerUser; k++ {
		f, err := uc.repo.Create(context.Background(), 1, domain.DialogFilter{Title: "f", IncludeChats: []int64{10}})
		if err != nil {
			t.Fatal(err)
		}
		f.Pos = k
		uc.repo.(*fakeRepo).folders[f.ID] = f
		ids = append(ids, f.ID)
	}
	order := append([]int64{0}, ids...)
	order[1], order[2] = order[2], order[1]
	if err := uc.Reorder(context.Background(), 1, order); err != nil {
		t.Fatalf("Reorder: %v", err)
	}
}
