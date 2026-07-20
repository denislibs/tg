package chat

import (
	"context"
	"strings"

	"github.com/messenger-denis/backend/internal/domain"
)

// maxTranslateLen ограничивает объём переводимого текста (одно сообщение/фрагмент).
const maxTranslateLen = 8192

// TranslateResult — переведённый текст + определённый провайдером исходный язык.
type TranslateResult struct {
	Text   string
	Source string
}

// TranslateText переводит text на toLang (ISO-код, напр. "en"/"ru"). Исходный
// язык определяет сам провайдер. Возвращает domain.ErrUnavailable, если перевод
// не сконфигурирован (нет TRANSLATE_URL), и domain.ErrTooLong при переборе длины.
func (i *Interactor) TranslateText(ctx context.Context, text, toLang string) (TranslateResult, error) {
	if i.translator == nil {
		return TranslateResult{}, domain.ErrUnavailable
	}
	text = strings.TrimSpace(text)
	toLang = strings.ToLower(strings.TrimSpace(toLang))
	if text == "" || toLang == "" {
		return TranslateResult{}, domain.ErrNotFound
	}
	if len([]rune(text)) > maxTranslateLen {
		return TranslateResult{}, domain.ErrTooLong
	}
	translated, source, err := i.translator.Translate(ctx, text, toLang)
	if err != nil {
		return TranslateResult{}, err
	}
	return TranslateResult{Text: translated, Source: source}, nil
}
