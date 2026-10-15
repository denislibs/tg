package domain

import (
	"testing"
	"time"
)

// Автор видит число просмотров своей истории (`storyViews.views_count`,
// tweb components/stories/viewer.tsx:2425): выборка кладёт его на строку, и
// конструктор обязан его отдать, даже когда реакций нет.
func TestToStoryItem_ViewsCountForAuthor(t *testing.T) {
	rec := StoryRecord{Seq: 3, ViewsCount: 2, CreatedAt: time.Unix(1, 0), ExpiresAt: time.Unix(2, 0)}
	v := rec.ToStoryItem(true).Views
	if v == nil || v.ViewsCount != 2 {
		t.Fatalf("views = %+v; want views_count 2", v)
	}
}

// Зритель счёта не видит: на его строке ViewsCount == 0 и реакций нет — параметр
// `views` не едет вовсе.
func TestToStoryItem_NoViewsWithoutCountAndReactions(t *testing.T) {
	rec := StoryRecord{Seq: 3, CreatedAt: time.Unix(1, 0), ExpiresAt: time.Unix(2, 0)}
	if v := rec.ToStoryItem(false).Views; v != nil {
		t.Fatalf("views = %+v; want nil", v)
	}
}

// Общий счёт выборки — `stories.stories.count`, а не длина страницы.
func TestNewStoriesStories_CountIsTotal(t *testing.T) {
	if got := NewStoriesStories(7, nil, nil).Count; got != 7 {
		t.Fatalf("count = %d; want 7", got)
	}
}
