package config

import (
	"fmt"
	"log"
	"os"
	"strings"
	"time"
)

type Config struct {
	HTTPAddr       string
	DatabaseURL    string
	RedisURL       string
	DevOTPCode     string
	SeedDemo       bool
	MediaURLSecret string

	MinioEndpoint  string
	MinioAccessKey string
	MinioSecretKey string
	MinioBucket    string
	MinioUseSSL    bool

	VAPIDPublicKey  string
	VAPIDPrivateKey string
	VAPIDSubject    string

	// GeoIPDBPath points at a MaxMind GeoLite2-City .mmdb file. Optional: when
	// empty or missing, login alerts simply omit the location line.
	GeoIPDBPath string

	// TURN relay for calls (coturn with use-auth-secret). TurnHost is the
	// host/IP clients can reach (empty → /calls/ice returns STUN only, so
	// calls work on one network but not across NATs). TurnSecret must match
	// coturn's static-auth-secret.
	TurnHost   string
	TurnSecret string

	// WebAuthn (ключи доступа): RP ID — стабильный домен (localhost в dev),
	// Origins — допустимые origin'ы браузера (через запятую).
	WebAuthnRPID    string
	WebAuthnOrigins []string

	// TranslateURL — базовый URL LibreTranslate-совместимого сервиса перевода
	// (POST /translate). Пусто → перевод сообщений отключён (эндпоинт → 503).
	TranslateURL string
	// TranslateAPIKey — необязательный api_key для инстансов, требующих его.
	TranslateAPIKey string

	// TenorAPIKey — ключ Tenor v2 для поиска GIF. Пусто → /gifs/search отдаёт
	// пустую выдачу (фича мягко отключена).
	TenorAPIKey string

	// RTMPBaseURL — базовый URL RTMP-сервера для livestream-трансляций (админ
	// вставляет его + stream key в OBS). Реального ingest в проекте нет — это
	// только выдаваемые креды. Пусто → дефолт rtmp://localhost/live.
	RTMPBaseURL string

	// DNPServerPrivKey — hex 32-байтного Curve25519 приватного статик-ключа
	// сервера (DNP). Пусто → DNP выключен.
	DNPServerPrivKey string

	// Публичные страницы-превью (аналог t.me) живут на СВОЁМ хосте, пути 1:1
	// с t.me (nginx проксирует его на /tme/… бэкенда). PublicLinkOrigin —
	// адрес этого хоста (абсолютные ссылки и og:image страниц), AppOrigin —
	// веб-клиент, куда ведут кнопки «Написать»/«Открыть в приложении».
	PublicLinkOrigin string
	AppOrigin        string

	// AccountResetWait — окно ожидания отложенного сброса аккаунта («забыли
	// пароль» без почты восстановления). Неделя, как в Telegram; сокращается
	// только на стенде, иначе сценарий непроверяем.
	AccountResetWait time.Duration

	// DevPurchases — dev-начисление звёзд и мок оплаты Premium без платёжной
	// формы (POST /stars/topup, /me/premium, /me/premium/checkout), Б-10. По
	// умолчанию выключено: в проде этих маршрутов нет, а help.getAppConfig
	// отдаёт stars_purchase_blocked. Включается на стенде и в разработке.
	DevPurchases bool
}

func Load() (*Config, error) {
	c := &Config{
		HTTPAddr:       getenv("HTTP_ADDR", ":8080"),
		DatabaseURL:    os.Getenv("DATABASE_URL"),
		RedisURL:       getenv("REDIS_URL", "redis://localhost:6379"),
		DevOTPCode:     getenv("DEV_OTP_CODE", defOTPCode),
		SeedDemo:       getenv("SEED_DEMO", "") == "true" || getenv("SEED_DEMO", "") == "1",
		DevPurchases:   getenv("DEV_PURCHASES", "") == "true" || getenv("DEV_PURCHASES", "") == "1",
		MediaURLSecret: getenv("MEDIA_URL_SECRET", defMediaURLSecret),
	}
	if c.DatabaseURL == "" {
		return nil, fmt.Errorf("DATABASE_URL is required")
	}
	c.MinioEndpoint = getenv("MINIO_ENDPOINT", "localhost:9000")
	c.MinioAccessKey = getenv("MINIO_ACCESS_KEY", defMinioCred)
	c.MinioSecretKey = getenv("MINIO_SECRET_KEY", defMinioCred)
	c.MinioBucket = getenv("MINIO_BUCKET", "media")
	c.MinioUseSSL = getenv("MINIO_USE_SSL", "false") == "true"
	c.VAPIDPublicKey = os.Getenv("VAPID_PUBLIC_KEY")
	c.VAPIDPrivateKey = os.Getenv("VAPID_PRIVATE_KEY")
	c.VAPIDSubject = getenv("VAPID_SUBJECT", "mailto:admin@example.com")
	c.GeoIPDBPath = os.Getenv("GEOIP_DB_PATH")
	c.TurnHost = os.Getenv("TURN_HOST")
	c.TurnSecret = getenv("TURN_SECRET", defTurnSecret)
	c.WebAuthnRPID = getenv("WEBAUTHN_RP_ID", "localhost")
	c.WebAuthnOrigins = strings.Split(getenv("WEBAUTHN_ORIGINS",
		"https://localhost:38443,http://localhost:38080,http://localhost:5173,http://localhost:8080"), ",")
	c.TranslateURL = os.Getenv("TRANSLATE_URL")
	c.TranslateAPIKey = os.Getenv("TRANSLATE_API_KEY")
	c.TenorAPIKey = os.Getenv("TENOR_API_KEY")
	c.RTMPBaseURL = getenv("RTMP_BASE_URL", "rtmp://localhost/live")
	c.DNPServerPrivKey = os.Getenv("DNP_SERVER_PRIVKEY")
	c.PublicLinkOrigin = strings.TrimRight(getenv("PUBLIC_LINK_ORIGIN", "https://t.me.local"), "/")
	c.AppOrigin = strings.TrimRight(getenv("APP_ORIGIN", "https://web.telegram.local"), "/")
	accountResetWait, err := parseDuration("ACCOUNT_RESET_WAIT", defAccountResetWait)
	if err != nil {
		return nil, err
	}
	c.AccountResetWait = accountResetWait

	// Fail-fast: в проде дефолтные секреты — это доступ к чужому медиа (форж
	// media-токена на MEDIA_URL_SECRET), TURN и хранилищу, плюс статичный OTP.
	// Не даём серверу стартовать молча с ними.
	// APP_ENV сравнивается без учёта регистра и пробелов: «Production » - это
	// прод, а не «незнакомое окружение», в котором fail-fast молча не сработал бы.
	appEnv := strings.ToLower(strings.TrimSpace(getenv("APP_ENV", "development")))
	if appEnv == "" {
		appEnv = "development"
	}
	// DEV_PURCHASES (звёзды и Premium без оплаты) - только при ЯВНО заданном
	// непрод-окружении: пустой или незнакомый APP_ENV (опечатка «prod», забытая
	// переменная в проде) - отказ старта.
	if c.DevPurchases && appEnv != "production" {
		raw := strings.ToLower(strings.TrimSpace(os.Getenv("APP_ENV")))
		if !devAppEnvs[raw] {
			return nil, fmt.Errorf("DEV_PURCHASES=true требует явного APP_ENV из development/dev/local/test (задано %q) — звёзды и Premium без оплаты", raw)
		}
	}
	if appEnv == "production" {
		var bad []string
		if c.MediaURLSecret == defMediaURLSecret {
			bad = append(bad, "MEDIA_URL_SECRET")
		}
		if c.TurnSecret == defTurnSecret {
			bad = append(bad, "TURN_SECRET")
		}
		if c.MinioAccessKey == defMinioCred || c.MinioSecretKey == defMinioCred {
			bad = append(bad, "MINIO_ACCESS_KEY/MINIO_SECRET_KEY")
		}
		if c.DevOTPCode == defOTPCode {
			bad = append(bad, "DEV_OTP_CODE")
		}
		// Бесплатные звёзды и Premium без оплаты — прямая дыра в экономике.
		if c.DevPurchases {
			return nil, fmt.Errorf("APP_ENV=production, но включён DEV_PURCHASES — dev-начисление звёзд и мок Premium в проде запрещены")
		}
		// Групповые звонки и звонки с запретом P2P идут только через TURN (М3-2):
		// без достижимого клиентам TURN_HOST они не соединяются. Старт не рвём —
		// сервер без звонков работает, — но говорим громко.
		if !turnHostReachable(c.TurnHost) {
			log.Printf("WARNING: APP_ENV=production, TURN_HOST=%q недостижим для клиентов — групповые звонки и звонки с запретом P2P не соединятся", c.TurnHost)
		}
		if len(bad) > 0 {
			return nil, fmt.Errorf("APP_ENV=production, но используются дефолтные секреты: %s — задайте их через окружение", strings.Join(bad, ", "))
		}
		// Укороченное окно сброса аккаунта — прямая дыра: владельцу не остаётся
		// времени войти и отменить чужую попытку удаления. Сокращать можно только
		// на стенде.
		if c.AccountResetWait < defAccountResetWait {
			return nil, fmt.Errorf("APP_ENV=production, но ACCOUNT_RESET_WAIT=%s короче недели — окно отмены сброса аккаунта укорачивать нельзя", c.AccountResetWait)
		}
	}
	return c, nil
}

// turnHostReachable — похож ли TURN_HOST на адрес, достижимый клиентам с других
// машин: пустой и петлевой (localhost, 127.*, ::1) — нет.
func turnHostReachable(host string) bool {
	h := strings.ToLower(strings.TrimSpace(host))
	return h != "" && h != "localhost" && h != "::1" && !strings.HasPrefix(h, "127.")
}

// devAppEnvs — значения APP_ENV, про которые известно, что это не прод: только в
// них разрешён DEV_PURCHASES. Любое другое непустое значение (опечатка вроде
// «prod») при включённом флаге - отказ старта.
var devAppEnvs = map[string]bool{"development": true, "dev": true, "local": true, "test": true}

// Дефолтные (dev-)значения секретов — общие для getenv-дефолтов выше и fail-fast
// проверки, чтобы не разъехались.
const (
	defMediaURLSecret = "dev-media-url-secret-change-me"
	defTurnSecret     = "dev-turn-secret-change-me"
	defMinioCred      = "minioadmin"
	defOTPCode        = "12345"
	// defAccountResetWait — окно ожидания сброса аккаунта: неделя, как в Telegram.
	// Одновременно нижняя граница для прода.
	defAccountResetWait = 7 * 24 * time.Hour
)

// parseDuration читает длительность из окружения ("168h", "30s"). Пусто —
// дефолт; мусор — ошибка старта, а не молчаливый откат к дефолту.
func parseDuration(key string, def time.Duration) (time.Duration, error) {
	raw := os.Getenv(key)
	if raw == "" {
		return def, nil
	}
	d, err := time.ParseDuration(raw)
	if err != nil {
		return 0, fmt.Errorf("%s=%q: %w", key, raw, err)
	}
	if d <= 0 {
		return 0, fmt.Errorf("%s=%q: должно быть положительным", key, raw)
	}
	return d, nil
}

func getenv(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}
