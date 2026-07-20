// Package libretranslate реализует порт chat.Translator через HTTP-вызов к
// LibreTranslate-совместимому сервису (POST /translate).
package libretranslate

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// Translator обращается к LibreTranslate по baseURL (например http://libretranslate:5000).
type Translator struct {
	baseURL string
	apiKey  string
	client  *http.Client
}

// New создаёт адаптер. baseURL — база сервиса (без завершающего слэша обяз-но не требуется).
func New(baseURL, apiKey string) *Translator {
	return &Translator{
		baseURL: strings.TrimRight(baseURL, "/"),
		apiKey:  apiKey,
		client:  &http.Client{Timeout: 20 * time.Second},
	}
}

type translateReq struct {
	Q      string `json:"q"`
	Source string `json:"source"`
	Target string `json:"target"`
	Format string `json:"format"`
	APIKey string `json:"api_key,omitempty"`
}

type translateResp struct {
	TranslatedText   string `json:"translatedText"`
	DetectedLanguage *struct {
		Language string `json:"language"`
	} `json:"detectedLanguage"`
}

// Translate переводит text на toLang; source="auto" → определяется сервисом.
func (t *Translator) Translate(ctx context.Context, text, toLang string) (string, string, error) {
	body, _ := json.Marshal(translateReq{
		Q: text, Source: "auto", Target: toLang, Format: "text", APIKey: t.apiKey,
	})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, t.baseURL+"/translate", bytes.NewReader(body))
	if err != nil {
		return "", "", err
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := t.client.Do(req)
	if err != nil {
		return "", "", err
	}
	defer resp.Body.Close()

	data, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20)) // 1 MiB хватает на текст
	if resp.StatusCode != http.StatusOK {
		return "", "", fmt.Errorf("libretranslate: status %d: %s", resp.StatusCode, strings.TrimSpace(string(data)))
	}
	var out translateResp
	if err := json.Unmarshal(data, &out); err != nil {
		return "", "", fmt.Errorf("libretranslate: bad response: %w", err)
	}
	source := ""
	if out.DetectedLanguage != nil {
		source = out.DetectedLanguage.Language
	}
	return out.TranslatedText, source, nil
}
