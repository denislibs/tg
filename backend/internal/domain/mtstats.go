package domain

import (
	"encoding/json"
	"strconv"
	"time"
)

// Статистика канала, группы и поста в форме схемы: `stats.broadcastStats`,
// `stats.megagroupStats`, `stats.messageStats`. Её рисует вкладка
// `AppStatisticsTab` клиента (tweb `sidebarRight/tabs/statistics.tsx`): обзор
// из `statsAbsValueAndPrev`/`statsPercentValue`, графики — `statsGraph` с
// JSON пакета графиков tweb (`lib/tchart`, тот же формат, что у
// `stats.loadAsyncGraph` Telegram), недавние посты —
// `postInteractionCountersMessage`.
//
// Чего нет и почему (графику без данных отвечает `statsGraphError` — клиент
// оригинала такие ключи просто выбрасывает, `statistics.tsx:996-1003`):
//   - mute_graph, top_hours_graph, iv_interactions_graph, views_by_source_graph,
//     new_followers_by_source_graph, languages_graph, reactions_by_emotion_graph,
//     story_* — истории событий «выключил звук», часа просмотра, источника,
//     языка, реакций по времени у нас не пишутся;
//   - у followers_graph одна линия «Joined»: выходы из канала не датируются;
//   - у interactions_graph одна линия «Views»: пересылки по дням не датируются;
//   - previous у `statsAbsValueAndPrev` — 0: снимков прошлого периода нет,
//     клиент при нуле разницу не рисует;
//   - views/shares/reactions_per_story — 0 (клиент нули не показывает): историй
//     у каналов в этой статистике нет;
//   - у группы viewers/posters — 0, actions_graph, new_members_by_source_graph,
//     languages_graph, top_hours_graph, weekdays_graph — statsGraphError,
//     top_posters/top_admins/top_inviters и users — пустые векторы;
//   - имена линий — по-английски, как у Telegram без lang_code: языка
//     клиента ручка не знает.

// Дискриминаторы конструкторов статистики.
const (
	StatsBroadcastStatsTag            = "stats.broadcastStats"
	StatsMegagroupStatsTag            = "stats.megagroupStats"
	StatsMessageStatsTag              = "stats.messageStats"
	StatsDateRangeDaysTag             = "statsDateRangeDays"
	StatsAbsValueAndPrevTag           = "statsAbsValueAndPrev"
	StatsPercentValueTag              = "statsPercentValue"
	StatsGraphTag                     = "statsGraph"
	StatsGraphErrorTag                = "statsGraphError"
	DataJSONTag                       = "dataJSON"
	PostInteractionCountersMessageTag = "postInteractionCountersMessage"
)

// statsGraphNoData — текст `statsGraphError` графика, у которого нет данных.
const statsGraphNoData = "NOT_ENOUGH_DATA"

// statsDateRangeDays#b637edaf min_date:int max_date:int = StatsDateRangeDays;
type StatsDateRangeDays struct {
	Underscore string `json:"_"`
	MinDate    int64  `json:"min_date"`
	MaxDate    int64  `json:"max_date"`
}

// statsAbsValueAndPrev#cb43acde current:double previous:double = StatsAbsValueAndPrev;
type StatsAbsValueAndPrev struct {
	Underscore string  `json:"_"`
	Current    float64 `json:"current"`
	Previous   float64 `json:"previous"`
}

func newStatsAbs(current float64) StatsAbsValueAndPrev {
	return StatsAbsValueAndPrev{Underscore: StatsAbsValueAndPrevTag, Current: current}
}

// statsPercentValue#cbce2fe0 part:double total:double = StatsPercentValue;
type StatsPercentValue struct {
	Underscore string  `json:"_"`
	Part       float64 `json:"part"`
	Total      float64 `json:"total"`
}

// dataJSON#7d748d04 data:string = DataJSON;
type DataJSON struct {
	Underscore string `json:"_"`
	Data       string `json:"data"`
}

// statsGraph#8ea464b6 flags:# json:DataJSON zoom_token:flags.0?string = StatsGraph;
// statsGraphError#bedc9822 error:string = StatsGraph;
//
// Одна структура на два конструктора объединения: у графика есть JSON, у
// ошибки — текст. statsGraphAsync (график по токену) не производится — все
// ряды считаются сразу, догружать нечего; zoom_token (детализация по клику)
// — тоже: почасовых рядов нет.
type StatsGraph struct {
	Underscore string    `json:"_"`
	JSON       *DataJSON `json:"json,omitempty"`
	Error      string    `json:"error,omitempty"`
}

func newStatsGraphError() StatsGraph {
	return StatsGraph{Underscore: StatsGraphErrorTag, Error: statsGraphNoData}
}

// postInteractionCountersMessage#e7058e7f msg_id:int views:int forwards:int
// reactions:int = PostInteractionCounters;
type PostInteractionCountersMessage struct {
	Underscore string `json:"_"`
	MsgID      int64  `json:"msg_id"`
	Views      int64  `json:"views"`
	Forwards   int64  `json:"forwards"`
	Reactions  int64  `json:"reactions"`
}

// stats.broadcastStats#396ca5fc … = stats.BroadcastStats;
type StatsBroadcastStats struct {
	Underscore                   string                           `json:"_"`
	Period                       StatsDateRangeDays               `json:"period"`
	Followers                    StatsAbsValueAndPrev             `json:"followers"`
	ViewsPerPost                 StatsAbsValueAndPrev             `json:"views_per_post"`
	SharesPerPost                StatsAbsValueAndPrev             `json:"shares_per_post"`
	ReactionsPerPost             StatsAbsValueAndPrev             `json:"reactions_per_post"`
	ViewsPerStory                StatsAbsValueAndPrev             `json:"views_per_story"`
	SharesPerStory               StatsAbsValueAndPrev             `json:"shares_per_story"`
	ReactionsPerStory            StatsAbsValueAndPrev             `json:"reactions_per_story"`
	EnabledNotifications         StatsPercentValue                `json:"enabled_notifications"`
	GrowthGraph                  StatsGraph                       `json:"growth_graph"`
	FollowersGraph               StatsGraph                       `json:"followers_graph"`
	MuteGraph                    StatsGraph                       `json:"mute_graph"`
	TopHoursGraph                StatsGraph                       `json:"top_hours_graph"`
	InteractionsGraph            StatsGraph                       `json:"interactions_graph"`
	IVInteractionsGraph          StatsGraph                       `json:"iv_interactions_graph"`
	ViewsBySourceGraph           StatsGraph                       `json:"views_by_source_graph"`
	NewFollowersBySourceGraph    StatsGraph                       `json:"new_followers_by_source_graph"`
	LanguagesGraph               StatsGraph                       `json:"languages_graph"`
	ReactionsByEmotionGraph      StatsGraph                       `json:"reactions_by_emotion_graph"`
	StoryInteractionsGraph       StatsGraph                       `json:"story_interactions_graph"`
	StoryReactionsByEmotionGraph StatsGraph                       `json:"story_reactions_by_emotion_graph"`
	RecentPostsInteractions      []PostInteractionCountersMessage `json:"recent_posts_interactions"`
}

// statsGroupTopPoster/Admin/Inviter не производятся (см. шапку) — векторы
// пустые, поэтому их элементы здесь не объявлены.

// stats.megagroupStats#ef7ff916 … = stats.MegagroupStats;
type StatsMegagroupStats struct {
	Underscore              string               `json:"_"`
	Period                  StatsDateRangeDays   `json:"period"`
	Members                 StatsAbsValueAndPrev `json:"members"`
	Messages                StatsAbsValueAndPrev `json:"messages"`
	Viewers                 StatsAbsValueAndPrev `json:"viewers"`
	Posters                 StatsAbsValueAndPrev `json:"posters"`
	GrowthGraph             StatsGraph           `json:"growth_graph"`
	MembersGraph            StatsGraph           `json:"members_graph"`
	NewMembersBySourceGraph StatsGraph           `json:"new_members_by_source_graph"`
	LanguagesGraph          StatsGraph           `json:"languages_graph"`
	MessagesGraph           StatsGraph           `json:"messages_graph"`
	ActionsGraph            StatsGraph           `json:"actions_graph"`
	TopHoursGraph           StatsGraph           `json:"top_hours_graph"`
	WeekdaysGraph           StatsGraph           `json:"weekdays_graph"`
	TopPosters              []struct{}           `json:"top_posters"`
	TopAdmins               []struct{}           `json:"top_admins"`
	TopInviters             []struct{}           `json:"top_inviters"`
	Users                   []UserReal           `json:"users"`
}

// stats.messageStats#7fe91c14 views_graph:StatsGraph
// reactions_by_emotion_graph:StatsGraph = stats.MessageStats;
//
// Числа обзора поста (просмотры, реакции, пересылки) клиент оригинала берёт
// из самого сообщения (`statistics.tsx:1050-1056`), поэтому в ответе их нет.
type StatsMessageStats struct {
	Underscore              string     `json:"_"`
	ViewsGraph              StatsGraph `json:"views_graph"`
	ReactionsByEmotionGraph StatsGraph `json:"reactions_by_emotion_graph"`
}

// statsLine — одна линия графика: ключ, тип, имя и цвет в форме JSON графиков.
type statsLine struct {
	name   string
	color  string
	points []StatPoint
	// cumulative — недостающие сутки продолжают предыдущее значение (рост),
	// а не обнуляются (прирост за сутки).
	cumulative bool
}

// Цвета линий — палитра графиков Telegram (`BLUE#3497ED` и т.п.; клиент
// берёт часть после `#`, `statistics.tsx:130-132`).
const (
	statsColorBlue  = "BLUE#3497ED"
	statsColorGreen = "GREEN#4BD964"
)

// newStatsLineGraph собирает график-линию по суточным рядам в формате JSON
// графиков: столбец `x` — полночь суток UTC в миллисекундах, по столбцу на
// линию. Сутки без событий заполняются (иначе линия соединяла бы далёкие
// точки напрямую), а ряд короче двух суток начинается сутками раньше: до
// первого события значение честно нулевое, а графику с одной точкой нечего
// рисовать. Пустые ряды — `statsGraphError`.
func newStatsLineGraph(now time.Time, lines ...statsLine) StatsGraph {
	var first time.Time
	for _, l := range lines {
		if len(l.points) > 0 && (first.IsZero() || l.points[0].Day.Before(first)) {
			first = l.points[0].Day
		}
	}
	if first.IsZero() {
		return newStatsGraphError()
	}
	first = statsDay(first)
	last := statsDay(now)
	if !last.After(first) {
		first = last.AddDate(0, 0, -1)
	}

	x := []any{"x"}
	for d := first; !d.After(last); d = d.AddDate(0, 0, 1) {
		x = append(x, d.UnixMilli())
	}
	columns := []any{x}
	types := map[string]string{"x": "x"}
	names := map[string]string{}
	colors := map[string]string{}
	for i, l := range lines {
		key := "y" + strconv.Itoa(i)
		byDay := make(map[int64]int64, len(l.points))
		for _, p := range l.points {
			byDay[statsDay(p.Day).UnixMilli()] += p.Value
		}
		col := []any{key}
		var running int64
		for _, ts := range x[1:] {
			v, ok := byDay[ts.(int64)]
			switch {
			case ok:
				running = v
			case !l.cumulative:
				running = 0
			}
			col = append(col, running)
		}
		columns = append(columns, col)
		types[key] = "line"
		names[key] = l.name
		colors[key] = l.color
	}

	data, _ := json.Marshal(map[string]any{
		"columns":           columns,
		"types":             types,
		"names":             names,
		"colors":            colors,
		"hidden":            []string{},
		"subchart":          map[string]any{"show": true, "defaultZoom": []any{x[max(1, len(x)-30)], x[len(x)-1]}},
		"strokeWidth":       2,
		"xTickFormatter":    "statsFormat('day')",
		"xTooltipFormatter": "statsTooltipFormat('day')",
		"xRangeFormatter":   "null",
		"yTickFormatter":    "null",
		"yTooltipFormatter": "statsFormatTooltipValue",
	})
	return StatsGraph{Underscore: StatsGraphTag, JSON: &DataJSON{Underscore: DataJSONTag, Data: string(data)}}
}

func statsDay(t time.Time) time.Time {
	y, m, d := t.UTC().Date()
	return time.Date(y, m, d, 0, 0, 0, 0, time.UTC)
}

// statsPeriod — период обзора: от первых суток рядов до сейчас.
func statsPeriod(now time.Time, series ...[]StatPoint) StatsDateRangeDays {
	minDate := now
	for _, s := range series {
		if len(s) > 0 && s[0].Day.Before(minDate) {
			minDate = s[0].Day
		}
	}
	return StatsDateRangeDays{Underscore: StatsDateRangeDaysTag, MinDate: statsDay(minDate).Unix(), MaxDate: now.Unix()}
}

func perPost(total, posts int64) float64 {
	if posts == 0 {
		return 0
	}
	return float64(total) / float64(posts)
}

// ToBroadcastWire — статистика канала в форме `stats.broadcastStats`.
func (s ChannelStats) ToBroadcastWire(now time.Time) StatsBroadcastStats {
	recent := make([]PostInteractionCountersMessage, 0, len(s.RecentPosts))
	for _, p := range s.RecentPosts {
		recent = append(recent, PostInteractionCountersMessage{
			Underscore: PostInteractionCountersMessageTag,
			MsgID:      p.Seq, Views: p.Views, Forwards: p.Forwards, Reactions: p.Reactions,
		})
	}
	sum := s.Summary
	return StatsBroadcastStats{
		Underscore:        StatsBroadcastStatsTag,
		Period:            statsPeriod(now, s.MembersGrowth, s.ViewsByDay),
		Followers:         newStatsAbs(float64(sum.Members)),
		ViewsPerPost:      newStatsAbs(perPost(sum.TotalViews, sum.PostsCount)),
		SharesPerPost:     newStatsAbs(perPost(sum.TotalForwards, sum.PostsCount)),
		ReactionsPerPost:  newStatsAbs(perPost(sum.TotalReactions, sum.PostsCount)),
		ViewsPerStory:     newStatsAbs(0),
		SharesPerStory:    newStatsAbs(0),
		ReactionsPerStory: newStatsAbs(0),
		EnabledNotifications: StatsPercentValue{
			Underscore: StatsPercentValueTag,
			Part:       float64(sum.NotificationsOn),
			Total:      float64(sum.Members),
		},
		GrowthGraph:                  newStatsLineGraph(now, statsLine{name: "Total followers", color: statsColorBlue, points: s.MembersGrowth, cumulative: true}),
		FollowersGraph:               newStatsLineGraph(now, statsLine{name: "Joined", color: statsColorGreen, points: s.JoinedByDay}),
		MuteGraph:                    newStatsGraphError(),
		TopHoursGraph:                newStatsGraphError(),
		InteractionsGraph:            newStatsLineGraph(now, statsLine{name: "Views", color: statsColorBlue, points: s.ViewsByDay}),
		IVInteractionsGraph:          newStatsGraphError(),
		ViewsBySourceGraph:           newStatsGraphError(),
		NewFollowersBySourceGraph:    newStatsGraphError(),
		LanguagesGraph:               newStatsGraphError(),
		ReactionsByEmotionGraph:      newStatsGraphError(),
		StoryInteractionsGraph:       newStatsGraphError(),
		StoryReactionsByEmotionGraph: newStatsGraphError(),
		RecentPostsInteractions:      recent,
	}
}

// ToMegagroupWire — статистика группы в форме `stats.megagroupStats`.
func (s ChannelStats) ToMegagroupWire(now time.Time) StatsMegagroupStats {
	return StatsMegagroupStats{
		Underscore:              StatsMegagroupStatsTag,
		Period:                  statsPeriod(now, s.MembersGrowth, s.PostsByDay),
		Members:                 newStatsAbs(float64(s.Summary.Members)),
		Messages:                newStatsAbs(float64(s.Summary.PostsCount)),
		Viewers:                 newStatsAbs(0),
		Posters:                 newStatsAbs(0),
		GrowthGraph:             newStatsLineGraph(now, statsLine{name: "Total members", color: statsColorBlue, points: s.MembersGrowth, cumulative: true}),
		MembersGraph:            newStatsLineGraph(now, statsLine{name: "Joined", color: statsColorGreen, points: s.JoinedByDay}),
		NewMembersBySourceGraph: newStatsGraphError(),
		LanguagesGraph:          newStatsGraphError(),
		MessagesGraph:           newStatsLineGraph(now, statsLine{name: "Messages", color: statsColorBlue, points: s.PostsByDay}),
		ActionsGraph:            newStatsGraphError(),
		TopHoursGraph:           newStatsGraphError(),
		WeekdaysGraph:           newStatsGraphError(),
		TopPosters:              []struct{}{},
		TopAdmins:               []struct{}{},
		TopInviters:             []struct{}{},
		Users:                   []UserReal{},
	}
}

// ToWire — статистика поста в форме `stats.messageStats`.
func (s PostStats) ToWire(now time.Time) StatsMessageStats {
	return StatsMessageStats{
		Underscore:              StatsMessageStatsTag,
		ViewsGraph:              newStatsLineGraph(now, statsLine{name: "Views", color: statsColorBlue, points: s.ViewsByDay}),
		ReactionsByEmotionGraph: newStatsGraphError(),
	}
}
