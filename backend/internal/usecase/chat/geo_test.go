package chat

import (
	"context"
	"encoding/json"
	"errors"
	"slices"
	"testing"
	"time"

	"github.com/messenger-denis/backend/internal/domain"
)

// geoMediaOf — media вложенного сообщения кадра/строки edit_message.
func geoMediaOf(t *testing.T, body map[string]any) map[string]any {
	t.Helper()
	msg, ok := body["message"].(map[string]any)
	if !ok {
		t.Fatalf("тело правки без message: %#v", body)
	}
	media, ok := msg["media"].(map[string]any)
	if !ok {
		t.Fatalf("сообщение правки без media: %#v", msg)
	}
	return media
}

// geoPoint — {lat, long} из geo вложения.
func geoPoint(t *testing.T, media map[string]any) (lat, lng float64) {
	t.Helper()
	g, ok := media["geo"].(map[string]any)
	if !ok {
		t.Fatalf("media без geo: %#v", media)
	}
	lat, _ = g["lat"].(float64)
	lng, _ = g["long"].(float64)
	return lat, lng
}

// F6-geo (В-1): координаты live-локации в группе идут общим путём правки —
// строка edit_message (updateEditMessage с messageMediaGeoLive) в журнале
// КАЖДОГО участника и живой кадр edit_message с курсором; собственного кадра
// geo_live_update нет. Офлайн-участник получает правку в getDifference.
func TestUpdateLiveLocation_Group_EditMessageForEveryMember(t *testing.T) {
	e := newChannelEnv(t)
	ctx := context.Background()
	gid, _, err := e.i.CreateGroup(ctx, 1, "Группа", "", "", false, []int64{2, 3})
	if err != nil {
		t.Fatalf("CreateGroup: %v", err)
	}
	period := 900
	live, err := e.i.Send(ctx, SendInput{ChatID: gid, SenderID: 1, Type: "geo", GeoLat: f64(10), GeoLng: f64(20), GeoLivePeriod: &period})
	if err != nil {
		t.Fatalf("Send: %v", err)
	}
	e.pub.reset()
	before := map[int64]int{}
	for _, uid := range []int64{1, 2, 3} {
		before[uid] = len(e.userLog(uid))
	}
	e.s.mu.Lock()
	ptsBefore3 := e.s.updates[3][len(e.s.updates[3])-1].Pts
	e.s.mu.Unlock()

	if _, err := e.i.UpdateLiveLocation(ctx, gid, live.ID, 1, 11.5, 22.5, nil, false); err != nil {
		t.Fatalf("UpdateLiveLocation: %v", err)
	}

	for _, uid := range []int64{1, 2, 3} {
		log := e.userLog(uid)
		if len(log) != before[uid]+1 || log[len(log)-1] != "edit_message" {
			t.Fatalf("у %d нет строки edit_message в журнале: %v", uid, log)
		}
		frames := e.userFrames(uid, "edit_message")
		if len(frames) != 1 {
			t.Fatalf("у %d кадров edit_message = %d, want 1", uid, len(frames))
		}
		if frames[0]["pts"] == nil {
			t.Fatalf("кадр правки у %d без курсора pts: %#v", uid, frames[0])
		}
		media := geoMediaOf(t, frames[0])
		if media["_"] != domain.MessageMediaGeoLiveTag {
			t.Fatalf("у %d media = %v, want messageMediaGeoLive", uid, media["_"])
		}
		if lat, lng := geoPoint(t, media); lat != 11.5 || lng != 22.5 {
			t.Fatalf("у %d координаты = %v,%v, want 11.5,22.5", uid, lat, lng)
		}
		if len(e.userFrames(uid, "geo_live_update")) != 0 {
			t.Fatalf("у %d остался кадр geo_live_update", uid)
		}
	}

	// Офлайн-участник догоняет правку по getDifference от своего pts до правки.
	d := diffReal(t, e.i, 3, ptsBefore3)
	if len(d.OtherUpdates) != 1 {
		t.Fatalf("разница участника 3: other_updates = %d, want 1", len(d.OtherUpdates))
	}
	var body map[string]any
	if err := json.Unmarshal(d.OtherUpdates[0], &body); err != nil {
		t.Fatal(err)
	}
	if body["_"] != domain.UpdateEditMessageTag {
		t.Fatalf("строка разницы = %v, want %s", body["_"], domain.UpdateEditMessageTag)
	}
	if lat, lng := geoPoint(t, geoMediaOf(t, body)); lat != 11.5 || lng != 22.5 {
		t.Fatalf("координаты в разнице = %v,%v, want 11.5,22.5", lat, lng)
	}
}

// privateGeo — личный чат 1↔2 с живой точкой автора 1 и перехватом кадров.
func privateGeo(t *testing.T) (*Interactor, *fakePublisher, *store, int64, domain.Message) {
	t.Helper()
	s := newStore()
	in := New(fakeTx{}, fakeChats{s}, fakeMsgs{s}, fakeUpdates{s}, fakeReactions{s}, fakeMedia{s}, nil, nil, nil, nil, nil)
	pub := &fakePublisher{}
	in.SetPublisher(pub)
	ctx := context.Background()
	chat, _ := in.CreatePrivateChat(ctx, 1, 2)
	period := 900
	live, err := in.Send(ctx, SendInput{ChatID: chat, SenderID: 1, Type: "geo", GeoLat: f64(1), GeoLng: f64(2), GeoLivePeriod: &period})
	if err != nil {
		t.Fatal(err)
	}
	pub.reset()
	return in, pub, s, chat, live
}

// То же в личке: оба участника получают правку строкой журнала и кадром с
// курсором (отступление проекта: кадр получает и устройство-инициатор).
func TestUpdateLiveLocation_Private_EditMessageBothSides(t *testing.T) {
	in, pub, s, chat, live := privateGeo(t)
	if _, err := in.UpdateLiveLocation(context.Background(), chat, live.ID, 1, 3, 4, nil, false); err != nil {
		t.Fatal(err)
	}
	for _, uid := range []int64{1, 2} {
		body := frameOfType(t, pub, uid, "edit_message")
		if body["pts"] == nil {
			t.Fatalf("кадр правки у %d без курсора: %#v", uid, body)
		}
		if lat, lng := geoPoint(t, geoMediaOf(t, body)); lat != 3 || lng != 4 {
			t.Fatalf("у %d координаты = %v,%v, want 3,4", uid, lat, lng)
		}
		s.mu.Lock()
		last := s.updates[uid][len(s.updates[uid])-1].Type
		s.mu.Unlock()
		if last != "edit_message" {
			t.Fatalf("у %d последняя строка журнала = %s, want edit_message", uid, last)
		}
	}
}

// Остановка трансляции — та же правка; period укорочен (досрочный конец).
func TestUpdateLiveLocation_StopIsEdit(t *testing.T) {
	in, pub, _, chat, live := privateGeo(t)
	if _, err := in.UpdateLiveLocation(context.Background(), chat, live.ID, 1, 1, 2, nil, true); err != nil {
		t.Fatal(err)
	}
	media := geoMediaOf(t, frameOfType(t, pub, 2, "edit_message"))
	if media["_"] != domain.MessageMediaGeoLiveTag {
		t.Fatalf("media = %v, want messageMediaGeoLive", media["_"])
	}
	if p, _ := media["period"].(float64); p >= 900 {
		t.Fatalf("period остановленной трансляции = %v, должен быть укорочен", p)
	}
}

// Правка не гасит реакции: сообщение едет в кадре гидрированным, как история.
func TestUpdateLiveLocation_KeepsReactions(t *testing.T) {
	in, pub, _, chat, live := privateGeo(t)
	ctx := context.Background()
	if err := in.React(ctx, chat, live.ID, 2, "🔥", true); err != nil {
		t.Fatalf("React: %v", err)
	}
	pub.reset()
	if _, err := in.UpdateLiveLocation(ctx, chat, live.ID, 1, 5, 6, nil, false); err != nil {
		t.Fatal(err)
	}
	msg, _ := frameOfType(t, pub, 2, "edit_message")["message"].(map[string]any)
	if _, ok := msg["reactions"].(map[string]any); !ok {
		t.Fatalf("кадр правки гео без reactions: %#v", msg)
	}
}

// Broadcast-канал: правка гео — одна запись журнала КАНАЛА
// (updateEditChannelMessage) с новыми координатами и один кадр в топик;
// в личных журналах подписчиков строк нет, веера «каждому участнику» нет.
func TestUpdateLiveLocation_Broadcast_ChannelJournal(t *testing.T) {
	e := newChannelEnv(t)
	ctx := context.Background()
	period := 900
	live, err := e.i.Send(ctx, SendInput{ChatID: e.ch, SenderID: 7, Type: "geo", GeoLat: f64(10), GeoLng: f64(20), GeoLivePeriod: &period})
	if err != nil {
		t.Fatalf("Send: %v", err)
	}
	e.pub.reset()
	chLogBefore := len(e.channelLog())

	if _, err := e.i.UpdateLiveLocation(ctx, e.ch, live.ID, 7, 12, 34, nil, false); err != nil {
		t.Fatalf("UpdateLiveLocation: %v", err)
	}

	log := e.channelLog()
	if len(log) != chLogBefore+1 || log[len(log)-1].Type != "edit_message" {
		t.Fatalf("журнал канала без edit_message: %+v", log)
	}
	body := bodyTag(t, log[len(log)-1].Payload)
	if body["_"] != domain.UpdateEditChannelMessageTag {
		t.Fatalf("конструктор = %v, want %s", body["_"], domain.UpdateEditChannelMessageTag)
	}
	media := geoMediaOf(t, body)
	if media["_"] != domain.MessageMediaGeoLiveTag {
		t.Fatalf("media = %v, want messageMediaGeoLive", media["_"])
	}
	if lat, lng := geoPoint(t, media); lat != 12 || lng != 34 {
		t.Fatalf("координаты = %v,%v, want 12,34", lat, lng)
	}
	topics := e.topicTypes()
	if !slices.Contains(topics, "edit_message") || slices.Contains(topics, "geo_live_update") {
		t.Fatalf("кадры топика = %v, want edit_message без geo_live_update", topics)
	}
	for _, uid := range []int64{7, 8, 9} {
		if len(e.userFrames(uid, "geo_live_update")) != 0 {
			t.Fatalf("у %d остался кадр geo_live_update", uid)
		}
		// Автору (его устройствам) уходит своя копия с pFlags.out — как у
		// EditMessage; подписчикам личных кадров нет, им хватает топика.
		if uid != 7 && len(e.userFrames(uid, "edit_message")) != 0 {
			t.Fatalf("у %d личный кадр edit_message вместо журнала канала", uid)
		}
		if uid != 7 && slices.Contains(e.userLog(uid), "edit_message") {
			t.Fatalf("у %d строка edit_message в личном журнале", uid)
		}
	}
}

// Остановленная трансляция не воскресает от запоздавшего тика: запрос
// «стоп» и тик могут прийти не по порядку, а в схеме конец трансляции —
// истечение срока (tweb geo.ts:178). Ответ — MESSAGE_NOT_MODIFIED, строк
// журнала не прибавляется, остановка остаётся.
func TestUpdateLiveLocation_StoppedStaysStopped(t *testing.T) {
	in, pub, s, chat, live := privateGeo(t)
	ctx := context.Background()
	if _, err := in.UpdateLiveLocation(ctx, chat, live.ID, 1, 1, 2, nil, true); err != nil {
		t.Fatal(err)
	}
	pub.reset()
	s.mu.Lock()
	rows := len(s.updates[2])
	s.mu.Unlock()
	if _, err := in.UpdateLiveLocation(ctx, chat, live.ID, 1, 9, 9, nil, false); !errors.Is(err, domain.ErrMessageNotModified) {
		t.Fatalf("тик после остановки: %v, want ErrMessageNotModified", err)
	}
	if _, err := in.UpdateLiveLocation(ctx, chat, live.ID, 1, 9, 9, nil, true); !errors.Is(err, domain.ErrMessageNotModified) {
		t.Fatalf("повторная остановка: %v, want ErrMessageNotModified", err)
	}
	s.mu.Lock()
	grown := len(s.updates[2]) != rows
	s.mu.Unlock()
	if grown {
		t.Fatal("журнал вырос")
	}
	cur, _ := fakeMsgs{s}.GetByID(ctx, live.ID)
	if !cur.GeoLiveStopped {
		t.Fatal("остановка снята запоздавшим тиком")
	}
}

// Срок трансляции вышел — точку принять нельзя.
func TestUpdateLiveLocation_ExpiredRejected(t *testing.T) {
	in, _, s, chat, live := privateGeo(t)
	s.mu.Lock()
	for idx, m := range s.messages[chat] {
		if m.ID == live.ID {
			m.CreatedAt = time.Now().Add(-time.Hour) // period 900 с
			s.messages[chat][idx] = m
		}
	}
	s.mu.Unlock()
	if _, err := in.UpdateLiveLocation(context.Background(), chat, live.ID, 1, 9, 9, nil, false); !errors.Is(err, domain.ErrMessageNotModified) {
		t.Fatalf("тик после срока: %v, want ErrMessageNotModified", err)
	}
}

// Та же точка — не правка: журнал не растёт, кадров нет.
func TestUpdateLiveLocation_SamePointIsNotAnEdit(t *testing.T) {
	in, pub, s, chat, live := privateGeo(t)
	ctx := context.Background()
	s.mu.Lock()
	rows := len(s.updates[2])
	s.mu.Unlock()
	if _, err := in.UpdateLiveLocation(ctx, chat, live.ID, 1, 1, 2, nil, false); err != nil {
		t.Fatal(err)
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if len(s.updates[2]) != rows || len(pub.frames) != 0 {
		t.Fatalf("та же точка записана: журнал %d -> %d, кадров %d", rows, len(s.updates[2]), len(pub.frames))
	}
}

// Вышедший из группы автор двигать точку не может: ни строки журнала, ни
// кадра остальным.
func TestUpdateLiveLocation_NonMemberForbidden(t *testing.T) {
	e := newChannelEnv(t)
	ctx := context.Background()
	gid, _, err := e.i.CreateGroup(ctx, 1, "Группа", "", "", false, []int64{2, 3})
	if err != nil {
		t.Fatal(err)
	}
	period := 900
	live, err := e.i.Send(ctx, SendInput{ChatID: gid, SenderID: 2, Type: "geo", GeoLat: f64(1), GeoLng: f64(2), GeoLivePeriod: &period})
	if err != nil {
		t.Fatal(err)
	}
	e.fg.mu.Lock()
	delete(e.fg.members[gid], 2)
	e.fg.mu.Unlock()
	e.pub.reset()
	before := len(e.userLog(3))
	if _, err := e.i.UpdateLiveLocation(ctx, gid, live.ID, 2, 5, 5, nil, false); !errors.Is(err, domain.ErrForbidden) {
		t.Fatalf("не участник: %v, want ErrForbidden", err)
	}
	if len(e.userLog(3)) != before || len(e.userFrames(3, "edit_message")) != 0 {
		t.Fatal("правка не участника ушла участникам")
	}
}
