package domain

import (
	"encoding/json"
	"sort"
	"testing"
	"time"

	"github.com/messenger-denis/backend/internal/pkg/tl"
)

// Сверка статистики канала, группы и поста со схемой TL: имена и
// обязательность параметров (сверщик) и раскладка на проводе (кодек без
// заглушек — пропущенный обязательный параметр для него ошибка).

func statsDayAt(s string) time.Time { t, _ := time.Parse("2006-01-02", s); return t }

func sampleChannelStats() ChannelStats {
	return ChannelStats{
		Broadcast: true,
		Summary: ChannelStatsSummary{
			Members: 4, TotalViews: 30, TotalForwards: 6, TotalReactions: 3, PostsCount: 3, NotificationsOn: 3,
		},
		MembersGrowth: []StatPoint{{Day: statsDayAt("2026-09-01"), Value: 1}, {Day: statsDayAt("2026-09-03"), Value: 4}},
		JoinedByDay:   []StatPoint{{Day: statsDayAt("2026-09-01"), Value: 1}, {Day: statsDayAt("2026-09-03"), Value: 3}},
		ViewsByDay:    []StatPoint{{Day: statsDayAt("2026-09-02"), Value: 30}},
		PostsByDay:    []StatPoint{{Day: statsDayAt("2026-09-02"), Value: 3}},
		RecentPosts:   []RecentPost{{Seq: 7, Views: 10, Forwards: 2, Reactions: 1}},
	}
}

func TestStats_MatchesSchema(t *testing.T) {
	now := statsDayAt("2026-09-04").Add(10 * time.Hour)
	cases := []struct {
		name  string
		value any
	}{
		{"канал", sampleChannelStats().ToBroadcastWire(now)},
		{"группа", sampleChannelStats().ToMegagroupWire(now)},
		{"пост", PostStats{ViewsByDay: []StatPoint{{Day: statsDayAt("2026-09-02"), Value: 5}}}.ToWire(now)},
		{"пустой канал", ChannelStats{Broadcast: true}.ToBroadcastWire(now)},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			c := &schemaChecker{
				constructors: loadSchemaConstructors(t),
				additional:   loadAdditionalParams(t),
				own:          loadOwnConstructors(t),
			}
			c.walk(roundTripJSON(t, tc.value), "stats")
			sort.Strings(c.unexpected)
			sort.Strings(c.omitted)
			for _, s := range c.unexpected {
				t.Errorf("лишнее: %s", s)
			}
			for _, s := range c.omitted {
				t.Errorf("пропущено: %s", s)
			}
			if _, err := tl.Marshal(tc.value); err != nil {
				t.Errorf("на провод TL не кладётся: %v", err)
			}
		})
	}
}

// График — JSON пакета графиков tweb (`lib/tchart`): столбец x по суткам UTC
// без пропусков, рост продолжает значение, прирост в пустые сутки — ноль.
func TestStats_LineGraphFillsDays(t *testing.T) {
	now := statsDayAt("2026-09-04").Add(10 * time.Hour)
	wire := sampleChannelStats().ToBroadcastWire(now)

	var growth, joined struct {
		Columns [][]any           `json:"columns"`
		Types   map[string]string `json:"types"`
		Colors  map[string]string `json:"colors"`
	}
	if wire.GrowthGraph.Underscore != StatsGraphTag || wire.FollowersGraph.Underscore != StatsGraphTag {
		t.Fatalf("графики роста: %s / %s", wire.GrowthGraph.Underscore, wire.FollowersGraph.Underscore)
	}
	if err := json.Unmarshal([]byte(wire.GrowthGraph.JSON.Data), &growth); err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal([]byte(wire.FollowersGraph.JSON.Data), &joined); err != nil {
		t.Fatal(err)
	}

	// 1, 2, 3, 4 сентября — четыре суток.
	wantX := []float64{
		float64(statsDayAt("2026-09-01").UnixMilli()), float64(statsDayAt("2026-09-02").UnixMilli()),
		float64(statsDayAt("2026-09-03").UnixMilli()), float64(statsDayAt("2026-09-04").UnixMilli()),
	}
	if len(growth.Columns) != 2 || growth.Columns[0][0] != "x" || len(growth.Columns[0]) != 5 {
		t.Fatalf("столбцы роста: %v", growth.Columns)
	}
	for i, x := range wantX {
		if growth.Columns[0][i+1] != x {
			t.Fatalf("x[%d] = %v, ожидалось %v", i, growth.Columns[0][i+1], x)
		}
	}
	if got := growth.Columns[1][1:]; got[0] != 1.0 || got[1] != 1.0 || got[2] != 4.0 || got[3] != 4.0 {
		t.Fatalf("рост продолжает значение: %v", got)
	}
	if got := joined.Columns[1][1:]; got[0] != 1.0 || got[1] != 0.0 || got[2] != 3.0 || got[3] != 0.0 {
		t.Fatalf("прирост в пустые сутки — ноль: %v", got)
	}
	if growth.Types["y0"] != "line" || growth.Colors["y0"] != statsColorBlue {
		t.Fatalf("тип/цвет линии: %v %v", growth.Types, growth.Colors)
	}

	// Без данных — statsGraphError, клиент такой ключ выбрасывает.
	if wire.MuteGraph.Underscore != StatsGraphErrorTag {
		t.Fatalf("mute_graph: %s", wire.MuteGraph.Underscore)
	}
	empty := ChannelStats{Broadcast: true}.ToBroadcastWire(now)
	if empty.GrowthGraph.Underscore != StatsGraphErrorTag {
		t.Fatalf("пустой ряд должен давать statsGraphError: %s", empty.GrowthGraph.Underscore)
	}

	// Обзор: средние на пост, доля включённых уведомлений.
	if wire.ViewsPerPost.Current != 10 || wire.SharesPerPost.Current != 2 || wire.ReactionsPerPost.Current != 1 {
		t.Fatalf("средние на пост: %+v %+v %+v", wire.ViewsPerPost, wire.SharesPerPost, wire.ReactionsPerPost)
	}
	if wire.EnabledNotifications.Part != 3 || wire.EnabledNotifications.Total != 4 {
		t.Fatalf("уведомления: %+v", wire.EnabledNotifications)
	}
	if len(wire.RecentPostsInteractions) != 1 || wire.RecentPostsInteractions[0].MsgID != 7 {
		t.Fatalf("недавние посты: %+v", wire.RecentPostsInteractions)
	}
}

// Ряд из одних суток сегодня всё равно даёт две точки: графику с одной
// точкой нечего рисовать.
func TestStats_LineGraphSingleDay(t *testing.T) {
	now := statsDayAt("2026-09-04").Add(10 * time.Hour)
	g := PostStats{ViewsByDay: []StatPoint{{Day: statsDayAt("2026-09-04"), Value: 2}}}.ToWire(now).ViewsGraph
	var data struct {
		Columns [][]any `json:"columns"`
	}
	if err := json.Unmarshal([]byte(g.JSON.Data), &data); err != nil {
		t.Fatal(err)
	}
	if len(data.Columns[0]) != 3 {
		t.Fatalf("ожидались двое суток: %v", data.Columns[0])
	}
	if data.Columns[1][1] != 0.0 || data.Columns[1][2] != 2.0 {
		t.Fatalf("значения: %v", data.Columns[1])
	}
}
