package config

import (
	"fmt"
	"os"
	"strings"
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
}

func Load() (*Config, error) {
	c := &Config{
		HTTPAddr:       getenv("HTTP_ADDR", ":8080"),
		DatabaseURL:    os.Getenv("DATABASE_URL"),
		RedisURL:       getenv("REDIS_URL", "redis://localhost:6379"),
		DevOTPCode:     getenv("DEV_OTP_CODE", "12345"),
		SeedDemo:       getenv("SEED_DEMO", "") == "true" || getenv("SEED_DEMO", "") == "1",
		MediaURLSecret: getenv("MEDIA_URL_SECRET", "dev-media-url-secret-change-me"),
	}
	if c.DatabaseURL == "" {
		return nil, fmt.Errorf("DATABASE_URL is required")
	}
	c.MinioEndpoint = getenv("MINIO_ENDPOINT", "localhost:9000")
	c.MinioAccessKey = getenv("MINIO_ACCESS_KEY", "minioadmin")
	c.MinioSecretKey = getenv("MINIO_SECRET_KEY", "minioadmin")
	c.MinioBucket = getenv("MINIO_BUCKET", "media")
	c.MinioUseSSL = getenv("MINIO_USE_SSL", "false") == "true"
	c.VAPIDPublicKey = os.Getenv("VAPID_PUBLIC_KEY")
	c.VAPIDPrivateKey = os.Getenv("VAPID_PRIVATE_KEY")
	c.VAPIDSubject = getenv("VAPID_SUBJECT", "mailto:admin@example.com")
	c.GeoIPDBPath = os.Getenv("GEOIP_DB_PATH")
	c.TurnHost = os.Getenv("TURN_HOST")
	c.TurnSecret = getenv("TURN_SECRET", "dev-turn-secret-change-me")
	c.WebAuthnRPID = getenv("WEBAUTHN_RP_ID", "localhost")
	c.WebAuthnOrigins = strings.Split(getenv("WEBAUTHN_ORIGINS",
		"https://localhost:38443,http://localhost:38080,http://localhost:5173,http://localhost:8080"), ",")
	c.TranslateURL = os.Getenv("TRANSLATE_URL")
	c.TranslateAPIKey = os.Getenv("TRANSLATE_API_KEY")
	c.TenorAPIKey = os.Getenv("TENOR_API_KEY")
	return c, nil
}

func getenv(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}
