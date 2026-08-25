package chat

import (
	"context"
	"time"

	"github.com/messenger-denis/backend/internal/domain"
)

// CalendarPage — содержимое контейнера `messages.searchResultsCalendar`:
// отрезки дней плюс САМИ сообщения-превью и карточки их авторов.
//
// Почему сообщение, а не выжимка медиа. У оригинала ячейку дня наполняет
// объект сообщения: `datePicker.tsx:437-444` берёт `result.messages` и рисует
// превью из `message.media`. Прежде мы отдавали `{media_id, type, has_thumb}` —
// второй, урезанный снимок того же медиа рядом с настоящим. Ровно этот дефект
// уже убирался у диалогов (`last_sender_name`) и контактов (плоский профиль).
type CalendarPage struct {
	Periods  []domain.SearchResultsCalendarPeriod
	Messages []domain.MTMessage
	Users    []domain.UserReal
}

// CalendarMonth — календарь медиа за месяц, которому принадлежит [from, to).
// Не участник — domain.ErrNotFound.
func (i *Interactor) CalendarMonth(ctx context.Context, chatID, userID int64, from, to time.Time) (CalendarPage, error) {
	ok, err := i.chats.IsMember(ctx, chatID, userID)
	if err != nil {
		return CalendarPage{}, err
	}
	if !ok {
		return CalendarPage{}, domain.ErrNotFound
	}

	days, err := i.msgs.CalendarMonth(ctx, chatID, from, to)
	if err != nil {
		return CalendarPage{}, err
	}
	if len(days) == 0 {
		return CalendarPage{}, nil
	}

	periods := make([]domain.SearchResultsCalendarPeriod, 0, len(days))
	seqs := make([]int64, 0, len(days))
	for _, d := range days {
		periods = append(periods, domain.NewSearchResultsCalendarPeriod(
			d.Day.Unix(), d.MinSeq, d.MaxSeq, d.Count))
		seqs = append(seqs, d.TopSeq)
	}

	// Сообщения-превью ОДНИМ запросом на месяц, а не по одному на день: дней
	// до тридцати одного, и тридцать один поход в базу ради одной панели —
	// та же ошибка, что чинилась у тем форума.
	msgs, err := i.msgs.GetBySeqs(ctx, chatID, seqs)
	if err != nil {
		return CalendarPage{}, err
	}
	// Вложение наполняется тем же ходом, что у истории: строка сообщения несёт
	// только КЛЮЧ файла, а конструктор `messageMediaPhoto` собирается из меты
	// медиа. Без этого шага сообщение уехало бы без `media` — то есть ячейке
	// дня нечего было бы рисовать.
	if err := i.hydrateMedia(ctx, msgs); err != nil {
		return CalendarPage{}, err
	}
	wire, users, err := i.MessagesContainer(ctx, userID, msgs)
	if err != nil {
		return CalendarPage{}, err
	}
	return CalendarPage{Periods: periods, Messages: wire, Users: users}, nil
}
