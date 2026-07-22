package http

import (
	"net/http"

	"github.com/messenger-denis/backend/internal/domain"
	usecasestats "github.com/messenger-denis/backend/internal/usecase/stats"
)

// StatsHandler — статистика каналов/супергрупп (аналог tweb stats.getBroadcastStats).
type StatsHandler struct{ uc *usecasestats.Interactor }

// NewStatsHandler создаёт хендлер статистики.
func NewStatsHandler(uc *usecasestats.Interactor) *StatsHandler { return &StatsHandler{uc: uc} }

const statDayFmt = "2006-01-02"

// ChannelStats — GET /channels/{chatID}/stats. Доступ только у создателя/админа
// канала (иначе 403). Возвращает обзор + временные ряды + топ-посты.
func (h *StatsHandler) ChannelStats(w http.ResponseWriter, r *http.Request) {
	user, _ := UserFromContext(r.Context())
	chatID, ok := pathInt(w, r, "chatID")
	if !ok {
		return
	}
	st, err := h.uc.ChannelStats(r.Context(), chatID, user.ID)
	switch {
	case err == nil:
	case err == domain.ErrForbidden:
		writeError(w, http.StatusForbidden, "forbidden")
		return
	case err == domain.ErrNotFound:
		writeError(w, http.StatusNotFound, "not found")
		return
	default:
		writeError(w, http.StatusInternalServerError, "server error")
		return
	}

	topPosts := make([]map[string]any, 0, len(st.TopPosts))
	for _, p := range st.TopPosts {
		topPosts = append(topPosts, map[string]any{
			"msg_id": p.MsgID, "seq": p.Seq, "text": p.Text,
			"views": p.Views, "date": p.CreatedAt.Format(statDayFmt),
		})
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"summary": map[string]any{
			"members":          st.Summary.Members,
			"total_views":      st.Summary.TotalViews,
			"posts_count":      st.Summary.PostsCount,
			"avg_reach":        st.Summary.AvgReach,
			"notifications_on": st.Summary.NotificationsOn,
		},
		"members_growth": seriesJSON(st.MembersGrowth),
		"views_by_day":   seriesJSON(st.ViewsByDay),
		"posts_by_day":   seriesJSON(st.PostsByDay),
		"top_posts":      topPosts,
	})
}

// PostStats — GET /chats/{chatID}/messages/{msgID}/stats. Статистика одного
// поста канала/супергруппы (tweb stats.getMessageStats). Доступ только у
// создателя/админа (иначе 403); нет поста — 404.
func (h *StatsHandler) PostStats(w http.ResponseWriter, r *http.Request) {
	user, _ := UserFromContext(r.Context())
	chatID, ok := pathInt(w, r, "chatID")
	if !ok {
		return
	}
	msgID, ok := pathInt(w, r, "msgID")
	if !ok {
		return
	}
	st, err := h.uc.PostStats(r.Context(), chatID, msgID, user.ID)
	switch {
	case err == nil:
	case err == domain.ErrForbidden:
		writeError(w, http.StatusForbidden, "forbidden")
		return
	case err == domain.ErrNotFound:
		writeError(w, http.StatusNotFound, "not found")
		return
	default:
		writeError(w, http.StatusInternalServerError, "server error")
		return
	}

	reactions := make([]map[string]any, 0, len(st.Reactions))
	for _, rc := range st.Reactions {
		reactions = append(reactions, map[string]any{"emoji": rc.Emoji, "count": rc.Count})
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"views":           st.Views,
		"forwards":        st.Forwards,
		"reactions_total": st.ReactionsTotal,
		"reactions":       reactions,
		"views_by_day":    seriesJSON(st.ViewsByDay),
	})
}

// seriesJSON сериализует ряд точек в [{date, value}], даты — YYYY-MM-DD.
func seriesJSON(points []domain.StatPoint) []map[string]any {
	out := make([]map[string]any, 0, len(points))
	for _, p := range points {
		out = append(out, map[string]any{"date": p.Day.Format(statDayFmt), "value": p.Value})
	}
	return out
}
