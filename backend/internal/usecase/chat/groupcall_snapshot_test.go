package chat

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"github.com/messenger-denis/backend/internal/domain"
)

// VA2-03 / A4-13: переходы звонка («в чате появился первый участник», «вышел
// последний», эфир начат или окончен) ведут к абсолютному снимку чата
// (chat_update) с флагами call_active/call_not_empty — и через журнал, и живьём.

type callEnv struct {
	in     *Interactor
	s      *store
	fg     *fakeGroupRepo
	pub    *fakePublisher
	clock  *fakeClock
	calls  *fakeCallStore
	chatID int64
}

const callOwner, callMember int64 = 7, 8

func newCallEnv(t *testing.T) *callEnv {
	t.Helper()
	in, s, fg, pub := newLoggedGroupInteractor()
	clock := newFakeClock()
	calls := newFakeCallStore(clock)
	in.SetGroupCalls(calls)
	in.callNow = clock.Now
	chatID, _, err := in.CreateGroup(context.Background(), callOwner, "Team", "", "", false, []int64{callMember})
	if err != nil {
		t.Fatalf("CreateGroup: %v", err)
	}
	pub.reset()
	return &callEnv{in: in, s: s, fg: fg, pub: pub, clock: clock, calls: calls, chatID: chatID}
}

// restarted — «новый процесс»: другой Interactor поверх тех же хранилищ.
func (e *callEnv) restarted() *Interactor {
	in := New(fakeTx{}, groupChats{e.fg}, fakeMsgs{e.s}, fakeUpdates{e.s}, fakeReactions{e.s}, fakeMedia{e.s}, e.fg, newFakeInviteRepo(), nil, nil, newFakeJoinRequestRepo())
	in.SetPublisher(e.pub)
	in.SetGroupCalls(e.calls)
	in.callNow = e.clock.Now
	return in
}

// chatUpdates — снимки chat_update в журнале пользователя, в порядке записи.
func (e *callEnv) chatUpdates(t *testing.T, userID int64) []map[string]any {
	t.Helper()
	e.in.bg.Wait()
	e.s.mu.Lock()
	defer e.s.mu.Unlock()
	var out []map[string]any
	for _, u := range e.s.updates[userID] {
		if u.Type != "chat_update" {
			continue
		}
		var d map[string]any
		if err := json.Unmarshal(u.Payload, &d); err != nil {
			t.Fatalf("тело chat_update: %v", err)
		}
		out = append(out, d)
	}
	return out
}

func channelFlags(t *testing.T, snapshot map[string]any) map[string]any {
	t.Helper()
	ch := chatOf(t, snapshot)
	flags, _ := ch["pFlags"].(map[string]any)
	return flags
}

func TestCallSnapshot_FirstJoinAndLastLeave(t *testing.T) {
	e := newCallEnv(t)
	ctx := context.Background()

	if _, err := e.in.JoinGroupCall(ctx, e.chatID, callOwner); err != nil {
		t.Fatal(err)
	}
	ups := e.chatUpdates(t, callMember)
	if len(ups) != 1 {
		t.Fatalf("первый вошёл: chat_update у участника = %d, want 1", len(ups))
	}
	if f := channelFlags(t, ups[0]); f["call_active"] != true || f["call_not_empty"] != true {
		t.Fatalf("снимок первого входа: pFlags = %v, want call_active и call_not_empty", f)
	}
	// И живой кадр, и догонка через getDifference несут тот же снимок.
	pts := assertLoggedRow(t, e.s, callMember, "chat_update")
	assertLiveFramePts(t, e.pub, callMember, "chat_update", pts)
	assertInDifference(t, e.in, callMember, "chat_update", pts)

	// Второй участник и выход не-последнего снимка не дают.
	e.clock.advance(10 * time.Second)
	if _, err := e.in.JoinGroupCall(ctx, e.chatID, callMember); err != nil {
		t.Fatal(err)
	}
	if err := e.in.LeaveGroupCall(ctx, e.chatID, callMember); err != nil {
		t.Fatal(err)
	}
	if n := len(e.chatUpdates(t, callMember)); n != 1 {
		t.Fatalf("вошёл/вышел не первый/последний: chat_update = %d, want 1", n)
	}

	// Последний вышел — снимок без флагов.
	if err := e.in.LeaveGroupCall(ctx, e.chatID, callOwner); err != nil {
		t.Fatal(err)
	}
	ups = e.chatUpdates(t, callMember)
	if len(ups) != 2 {
		t.Fatalf("последний вышел: chat_update = %d, want 2", len(ups))
	}
	f := channelFlags(t, ups[1])
	if _, has := f["call_active"]; has {
		t.Fatalf("снимок после ухода последнего несёт call_active: %v", f)
	}
	if _, has := f["call_not_empty"]; has {
		t.Fatalf("снимок после ухода последнего несёт call_not_empty: %v", f)
	}
}

// Цикл «вошёл/вышел» пять раз за секунду даёт не больше двух снимков, и
// последний отражает итог (звонок кончился).
func TestCallSnapshot_FlappingIsThrottledAndConverges(t *testing.T) {
	e := newCallEnv(t)
	ctx := context.Background()
	for range 5 {
		if _, err := e.in.JoinGroupCall(ctx, e.chatID, callOwner); err != nil {
			t.Fatal(err)
		}
		if err := e.in.LeaveGroupCall(ctx, e.chatID, callOwner); err != nil {
			t.Fatal(err)
		}
		e.clock.advance(200 * time.Millisecond)
	}
	if n := len(e.chatUpdates(t, callMember)); n != 1 {
		t.Fatalf("внутри окна ушло %d снимков, want 1 (остальные отложены)", n)
	}
	if e.calls.pendingDirty() != 1 {
		t.Fatalf("отложенных снимков = %d, want 1", e.calls.pendingDirty())
	}

	// До срока тик ничего не делает.
	if n, err := e.in.FlushDirtyCallSnapshots(ctx); err != nil || n != 0 {
		t.Fatalf("тик до срока: n=%d err=%v, want 0", n, err)
	}
	e.clock.advance(6 * time.Second)
	if n, err := e.in.FlushDirtyCallSnapshots(ctx); err != nil || n != 1 {
		t.Fatalf("тик после окна: n=%d err=%v, want 1", n, err)
	}
	ups := e.chatUpdates(t, callMember)
	if len(ups) != 2 {
		t.Fatalf("после тика снимков = %d, want 2", len(ups))
	}
	if f := channelFlags(t, ups[1]); f["call_active"] == true {
		t.Fatalf("последний снимок несёт call_active, а звонок кончился: %v", f)
	}
	if e.calls.pendingDirty() != 0 {
		t.Fatal("после публикации запись об отложенном снимке осталась")
	}
	// Повторный тик ничего не публикует.
	if n, _ := e.in.FlushDirtyCallSnapshots(ctx); n != 0 {
		t.Fatalf("повторный тик опубликовал %d", n)
	}
}

// Рестарт процесса внутри окна не теряет итог: отложенная запись лежит в сторе,
// и тик нового экземпляра её публикует.
func TestCallSnapshot_RestartKeepsDeferredSnapshot(t *testing.T) {
	e := newCallEnv(t)
	ctx := context.Background()
	if _, err := e.in.JoinGroupCall(ctx, e.chatID, callOwner); err != nil {
		t.Fatal(err)
	}
	if err := e.in.LeaveGroupCall(ctx, e.chatID, callOwner); err != nil { // занято окном → отложено
		t.Fatal(err)
	}
	if n := len(e.chatUpdates(t, callMember)); n != 1 {
		t.Fatalf("до рестарта снимков = %d, want 1", n)
	}

	fresh := e.restarted()
	e.clock.advance(6 * time.Second)
	if n, err := fresh.FlushDirtyCallSnapshots(ctx); err != nil || n != 1 {
		t.Fatalf("тик нового экземпляра: n=%d err=%v, want 1", n, err)
	}
	fresh.bg.Wait()
	ups := e.chatUpdates(t, callMember)
	if len(ups) != 2 {
		t.Fatalf("итог после рестарта потерян: снимков = %d, want 2", len(ups))
	}
	if f := channelFlags(t, ups[1]); f["call_active"] == true {
		t.Fatalf("итог после рестарта: %v", f)
	}
}

// Аренда: пока одна реплика держит запись, вторая её не берёт; упавшая реплика
// оставляет запись, и после срока аренды её подбирает любая.
func TestCallSnapshot_LeaseIsExclusiveAndExpires(t *testing.T) {
	e := newCallEnv(t)
	ctx := context.Background()
	_, _ = e.in.JoinGroupCall(ctx, e.chatID, callOwner)
	_ = e.in.LeaveGroupCall(ctx, e.chatID, callOwner)
	e.clock.advance(6 * time.Second)

	now := e.clock.Now()
	first, _ := e.calls.LeaseDirtySnapshots(ctx, now, now.Add(callSnapshotLease), 10)
	second, _ := e.calls.LeaseDirtySnapshots(ctx, now, now.Add(callSnapshotLease), 10)
	if len(first) != 1 || len(second) != 0 {
		t.Fatalf("аренда: первая реплика %v, вторая %v; want 1 и 0", first, second)
	}
	// Реплика упала, не опубликовав: через срок аренды запись снова доступна.
	e.clock.advance(callSnapshotLease + time.Second)
	if n, err := e.in.FlushDirtyCallSnapshots(ctx); err != nil || n != 1 {
		t.Fatalf("после срока аренды: n=%d err=%v, want 1", n, err)
	}
}

// Эфир начат/окончен — тоже переход: снимок с флагами и без.
func TestCallSnapshot_LivestreamStartAndStop(t *testing.T) {
	e := newCallEnv(t)
	ctx := context.Background()
	e.in.SetLivestreams(newFakeLivestreamRepo(), "rtmp://test/live")

	if _, err := e.in.StartLivestream(ctx, e.chatID, callOwner); err != nil {
		t.Fatal(err)
	}
	ups := e.chatUpdates(t, callMember)
	if len(ups) != 1 {
		t.Fatalf("эфир начат: chat_update = %d, want 1", len(ups))
	}
	if f := channelFlags(t, ups[0]); f["call_active"] != true || f["call_not_empty"] != true {
		t.Fatalf("снимок начала эфира: %v", f)
	}
	e.clock.advance(10 * time.Second)
	if err := e.in.StopLivestream(ctx, e.chatID, callOwner); err != nil {
		t.Fatal(err)
	}
	ups = e.chatUpdates(t, callMember)
	if len(ups) != 2 {
		t.Fatalf("эфир окончен: chat_update = %d, want 2", len(ups))
	}
	if f := channelFlags(t, ups[1]); f["call_active"] == true {
		t.Fatalf("снимок конца эфира несёт call_active: %v", f)
	}
}

// Без Redis звонков нет, а эфир публикует снимок сразу, без ограничителя.
func TestCallSnapshot_LivestreamWithoutRedisPublishesImmediately(t *testing.T) {
	in, s, _, pub := newLoggedGroupInteractor()
	ctx := context.Background()
	in.SetLivestreams(newFakeLivestreamRepo(), "rtmp://test/live")
	chatID, _, err := in.CreateGroup(ctx, callOwner, "Team", "", "", false, []int64{callMember})
	if err != nil {
		t.Fatal(err)
	}
	pub.reset()
	if _, err := in.StartLivestream(ctx, chatID, callOwner); err != nil {
		t.Fatal(err)
	}
	if err := in.StopLivestream(ctx, chatID, callOwner); err != nil {
		t.Fatal(err)
	}
	in.bg.Wait()
	s.mu.Lock()
	defer s.mu.Unlock()
	n := 0
	for _, u := range s.updates[callMember] {
		if u.Type == "chat_update" {
			n++
		}
	}
	if n != 2 {
		t.Fatalf("без Redis: chat_update = %d, want 2 (старт и стоп без ограничителя)", n)
	}
}

// Тест-сторож: любой вектор chats, где сервер отдаёт полный channel, несёт
// флаги звонка — иначе клиент заменит лежащий канал целиком и погасит иконку.
func TestCallFlags_RideEveryChannelVector(t *testing.T) {
	e := newCallEnv(t)
	ctx := context.Background()
	if _, err := e.in.JoinGroupCall(ctx, e.chatID, callOwner); err != nil {
		t.Fatal(err)
	}
	e.in.bg.Wait()
	hasCall := func(name string, chats []domain.Chat) {
		t.Helper()
		for _, c := range chats {
			if ch, ok := c.(domain.Channel); ok && ch.PeerID().ToChatID() == e.chatID {
				if !ch.CallActive() || !ch.CallNotEmpty() {
					t.Fatalf("%s: канал со звонком без флагов: %v", name, ch.PFlags)
				}
				return
			}
		}
		t.Fatalf("%s: канала чата %d нет в векторе %v", name, e.chatID, chats)
	}

	// История, разница и поиск собирают chats одним сборщиком — peerVectors.
	_, chats := e.in.PeerVectorsForRefs(ctx, callMember, domain.PeerRefs{Chats: []int64{e.chatID}})
	hasCall("peerVectors (история/разница/поиск)", chats)

	full, err := e.in.ChatFullContainer(ctx, e.chatID, callMember)
	if err != nil {
		t.Fatal(err)
	}
	hasCall("карточка (chatFull)", full.Chats)

	card, err := e.in.ChatCard(ctx, e.chatID, callMember)
	if err != nil {
		t.Fatal(err)
	}
	if !card.Call.Active || !card.Call.NotEmpty {
		t.Fatalf("ChatCard без состояния звонка: %+v", card.Call)
	}

	// send_as: личность-группа (создатель пишет от имени группы) — полная карточка.
	asPeers, err := e.in.GetSendAs(ctx, callOwner, e.chatID)
	if err != nil {
		t.Fatal(err)
	}
	var asGroup *domain.Channel
	for _, p := range asPeers {
		if p.Chat != nil && p.Chat.ID == e.chatID {
			asGroup = p.Chat
		}
	}
	if asGroup == nil {
		t.Fatalf("send_as без личности-группы: %+v", asPeers)
	}
	if !asGroup.CallActive() || !asGroup.CallNotEmpty() {
		t.Fatalf("send_as: канал со звонком без флагов: %v", asGroup.PFlags)
	}

	// Участник без звонка: флагов нет (другой чат).
	other, _, err := e.in.CreateGroup(ctx, callOwner, "Other", "", "", false, nil)
	if err != nil {
		t.Fatal(err)
	}
	_, chats = e.in.PeerVectorsForRefs(ctx, callOwner, domain.PeerRefs{Chats: []int64{other}})
	for _, c := range chats {
		if ch, ok := c.(domain.Channel); ok && ch.CallActive() {
			t.Fatalf("чат без звонка несёт call_active: %v", ch.PFlags)
		}
	}
}

// Список диалогов: чат со звонком несёт флаг, а проверка звонков — один пакетный
// вопрос на страницу, не по вопросу на чат.
func TestCallFlags_DialogsPageBatchesTheLookup(t *testing.T) {
	in, s := newInteractor()
	in.SetPublisher(&fakePublisher{})
	clock := newFakeClock()
	calls := newFakeCallStore(clock)
	in.SetGroupCalls(calls)
	in.callNow = clock.Now
	ctx := context.Background()
	const a, b int64 = 1, 2
	s.seedChat(100, domain.ChatTypeGroup, a, b)
	s.seedChat(101, domain.ChatTypeGroup, a, b)
	s.seedChat(102, domain.ChatTypeGroup, a, b)
	if _, err := in.JoinGroupCall(ctx, 101, b); err != nil {
		t.Fatal(err)
	}
	in.bg.Wait()
	calls.activeAmongCalls = 0

	page, err := in.DialogsPage(ctx, a, domain.DialogPage{Limit: 20})
	if err != nil {
		t.Fatalf("DialogsPage: %v", err)
	}
	if calls.activeAmongCalls != 1 {
		t.Fatalf("ActiveAmong вызван %d раз на страницу, want 1", calls.activeAmongCalls)
	}
	active := map[int64]bool{}
	for _, c := range page.Chats {
		if ch, ok := c.(domain.Channel); ok {
			active[ch.PeerID().ToChatID()] = ch.CallActive() && ch.CallNotEmpty()
		}
	}
	if len(active) != 3 || !active[101] || active[100] || active[102] {
		t.Fatalf("флаги звонка по чатам списка = %v, want только 101", active)
	}
}

// Чат удалён, пока снимок ждал окна: запись снимается, а не крутится вечно.
func TestCallSnapshot_DeletedChatLeavesTheQueue(t *testing.T) {
	e := newCallEnv(t)
	ctx := context.Background()
	if err := e.calls.MarkSnapshotDirty(ctx, 99999, e.clock.Now().Add(callSnapshotWindow)); err != nil {
		t.Fatal(err)
	}
	e.clock.advance(6 * time.Second)
	if n, err := e.in.FlushDirtyCallSnapshots(ctx); err != nil || n != 0 {
		t.Fatalf("тик: n=%d err=%v, want 0", n, err)
	}
	if e.calls.pendingDirty() != 0 {
		t.Fatal("запись удалённого чата осталась в очереди")
	}
}

// Снимок, собранный по старому состоянию, не должен остаться последним: пока он
// писался, вышел последний участник (публикации одного чата ничем не упорядочены).
// После публикации состояние читается заново, и исправляющий снимок отложен.
func TestCallSnapshot_StaleSnapshotIsCorrected(t *testing.T) {
	e := newCallEnv(t)
	ctx := context.Background()
	e.calls.afterActiveAmong = func() { _, _ = e.calls.Leave(ctx, e.chatID, callOwner) }
	if _, err := e.in.JoinGroupCall(ctx, e.chatID, callOwner); err != nil {
		t.Fatal(err)
	}
	ups := e.chatUpdates(t, callMember)
	if len(ups) != 1 || channelFlags(t, ups[0])["call_active"] != true {
		t.Fatalf("первый снимок собран по состоянию «идёт»: %d, %v", len(ups), ups)
	}
	if e.calls.pendingDirty() != 1 {
		t.Fatal("расхождение с текущим состоянием не откладывает исправляющий снимок")
	}
	e.clock.advance(6 * time.Second)
	if n, err := e.in.FlushDirtyCallSnapshots(ctx); err != nil || n != 1 {
		t.Fatalf("тик: n=%d err=%v", n, err)
	}
	ups = e.chatUpdates(t, callMember)
	if len(ups) != 2 {
		t.Fatalf("снимков = %d, want 2", len(ups))
	}
	if f := channelFlags(t, ups[1]); f["call_active"] == true {
		t.Fatalf("последний снимок несёт устаревший call_active: %v", f)
	}
}

// Источник звонков недоступен: снимок «без флагов» в журнал не пишется (он погасил
// бы иконку идущего звонка при догонке), переход не теряется — повтор тиком.
func TestCallSnapshot_SourceFailureDoesNotPublishWithoutFlags(t *testing.T) {
	e := newCallEnv(t)
	ctx := context.Background()
	e.calls.activeAmongErr = errors.New("redis down")
	if _, err := e.in.JoinGroupCall(ctx, e.chatID, callOwner); err != nil {
		t.Fatal(err)
	}
	if n := len(e.chatUpdates(t, callMember)); n != 0 {
		t.Fatalf("при сбое источника опубликовано %d снимков, want 0", n)
	}
	if e.calls.pendingDirty() != 1 {
		t.Fatal("переход потерян: повтора в очереди нет")
	}
	e.calls.activeAmongErr = nil
	e.clock.advance(6 * time.Second)
	if n, err := e.in.FlushDirtyCallSnapshots(ctx); err != nil || n != 1 {
		t.Fatalf("повтор: n=%d err=%v", n, err)
	}
	ups := e.chatUpdates(t, callMember)
	if len(ups) != 1 || channelFlags(t, ups[0])["call_active"] != true {
		t.Fatalf("повтор не опубликовал снимок с флагами: %v", ups)
	}
}

// Личный снимок (вступил по ссылке, назначен админом, ограничен) — полный channel
// зрителя, а клиент заменяет им лежащий целиком: флаги звонка обязаны ехать и в нём.
func TestCallFlags_ViewerSnapshotCarriesTheCall(t *testing.T) {
	e := newCallEnv(t)
	ctx := context.Background()
	if _, err := e.in.JoinGroupCall(ctx, e.chatID, callOwner); err != nil {
		t.Fatal(err)
	}
	e.in.bg.Wait()
	if err := e.in.publishViewerChatErr(ctx, e.chatID, callMember); err != nil {
		t.Fatal(err)
	}
	ups := e.chatUpdates(t, callMember)
	last := channelFlags(t, ups[len(ups)-1])
	if last["min"] == true {
		t.Fatalf("личный снимок оказался min: %v", last)
	}
	if last["call_active"] != true || last["call_not_empty"] != true {
		t.Fatalf("личный снимок без флагов звонка: %v", last)
	}
}
