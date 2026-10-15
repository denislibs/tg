package config

import (
	"testing"
	"time"
)

func TestLoad_Defaults(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://localhost/db")
	t.Setenv("HTTP_ADDR", "")
	t.Setenv("DEV_OTP_CODE", "")

	c, err := Load()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if c.HTTPAddr != ":8080" {
		t.Errorf("HTTPAddr default = %q, want :8080", c.HTTPAddr)
	}
	if c.DevOTPCode != "12345" {
		t.Errorf("DevOTPCode default = %q, want 12345", c.DevOTPCode)
	}
	if c.DatabaseURL != "postgres://localhost/db" {
		t.Errorf("DatabaseURL = %q", c.DatabaseURL)
	}
}

func TestLoad_MissingDatabaseURL(t *testing.T) {
	t.Setenv("DATABASE_URL", "")
	if _, err := Load(); err == nil {
		t.Fatal("expected error when DATABASE_URL is empty")
	}
}

func TestLoad_MinioDefaults(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://localhost/db")
	c, err := Load()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if c.MinioEndpoint != "localhost:9000" || c.MinioBucket != "media" {
		t.Errorf("minio defaults wrong: %+v", c)
	}
	if c.MinioUseSSL {
		t.Error("MinioUseSSL should default to false")
	}
}

func TestLoad_ProdRejectsDefaultSecrets(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://localhost/db")
	t.Setenv("APP_ENV", "production")
	// секреты не заданы → дефолты → Load должен упасть.
	if _, err := Load(); err == nil {
		t.Fatal("expected error: production with default secrets")
	}
}

func TestLoad_ProdWithRealSecretsOK(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://localhost/db")
	t.Setenv("APP_ENV", "production")
	t.Setenv("MEDIA_URL_SECRET", "real-media-secret-xyz")
	t.Setenv("TURN_SECRET", "real-turn-secret-xyz")
	t.Setenv("MINIO_ACCESS_KEY", "realkey")
	t.Setenv("MINIO_SECRET_KEY", "realsecret")
	t.Setenv("DEV_OTP_CODE", "")                 // getenv-дефолт 12345 сработал бы —
	t.Setenv("DEV_OTP_CODE", "disabled-in-prod") // задаём не-дефолт
	if _, err := Load(); err != nil {
		t.Fatalf("unexpected error with real secrets: %v", err)
	}
}

func TestLoad_DevAllowsDefaultSecrets(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://localhost/db")
	t.Setenv("APP_ENV", "") // development по умолчанию
	if _, err := Load(); err != nil {
		t.Fatalf("dev with defaults должен работать: %v", err)
	}
}

// Окно ожидания сброса аккаунта: по умолчанию неделя, на стенде укорачивается,
// мусор в переменной — ошибка старта, а не тихий откат к дефолту.
func TestLoad_AccountResetWait(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://localhost/db")

	t.Setenv("ACCOUNT_RESET_WAIT", "")
	c, err := Load()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if c.AccountResetWait != 7*24*time.Hour {
		t.Errorf("AccountResetWait default = %s, want 168h", c.AccountResetWait)
	}

	t.Setenv("ACCOUNT_RESET_WAIT", "30s")
	if c, err := Load(); err != nil || c.AccountResetWait != 30*time.Second {
		t.Errorf("ACCOUNT_RESET_WAIT=30s → %v, %v", c.AccountResetWait, err)
	}

	t.Setenv("ACCOUNT_RESET_WAIT", "неделя")
	if _, err := Load(); err == nil {
		t.Error("мусор в ACCOUNT_RESET_WAIT принят молча")
	}
}

// В проде окно укорачивать нельзя: у владельца не остаётся времени отменить
// чужую попытку удалить аккаунт.
func TestLoad_ProdRejectsShortAccountResetWait(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://localhost/db")
	t.Setenv("APP_ENV", "production")
	t.Setenv("MEDIA_URL_SECRET", "real-media-secret-xyz")
	t.Setenv("TURN_SECRET", "real-turn-secret-xyz")
	t.Setenv("MINIO_ACCESS_KEY", "realkey")
	t.Setenv("MINIO_SECRET_KEY", "realsecret")
	t.Setenv("DEV_OTP_CODE", "disabled-in-prod")

	t.Setenv("ACCOUNT_RESET_WAIT", "30s")
	if _, err := Load(); err == nil {
		t.Fatal("прод принял укороченное окно сброса аккаунта")
	}
	t.Setenv("ACCOUNT_RESET_WAIT", "336h") // длиннее недели — можно
	if _, err := Load(); err != nil {
		t.Fatalf("прод отверг удлинённое окно: %v", err)
	}
}

func TestLoad_VAPIDSubjectDefault(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://localhost/db")
	t.Setenv("VAPID_SUBJECT", "")
	c, err := Load()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if c.VAPIDSubject != "mailto:admin@example.com" {
		t.Errorf("VAPIDSubject default = %q", c.VAPIDSubject)
	}
}

func TestLoad_PublicLinkOrigins(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://localhost/db")
	t.Setenv("PUBLIC_LINK_ORIGIN", "")
	t.Setenv("APP_ORIGIN", "")
	c, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	if c.PublicLinkOrigin != "https://t.me.local" || c.AppOrigin != "https://web.telegram.local" {
		t.Errorf("defaults = %q, %q", c.PublicLinkOrigin, c.AppOrigin)
	}

	t.Setenv("PUBLIC_LINK_ORIGIN", "https://links.example/")
	t.Setenv("APP_ORIGIN", "https://app.example/")
	if c, err = Load(); err != nil {
		t.Fatal(err)
	}
	if c.PublicLinkOrigin != "https://links.example" || c.AppOrigin != "https://app.example" {
		t.Errorf("завершающий «/» не снят: %q, %q", c.PublicLinkOrigin, c.AppOrigin)
	}
}

// DEV_PURCHASES: dev-начисление звёзд и мок Premium (Б-10). По умолчанию закрыто,
// в проде включить нельзя.
func TestLoad_DevPurchases(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://localhost/db")

	t.Setenv("DEV_PURCHASES", "")
	if c, err := Load(); err != nil || c.DevPurchases {
		t.Fatalf("по умолчанию DevPurchases = %v, %v; want false", c != nil && c.DevPurchases, err)
	}
	t.Setenv("DEV_PURCHASES", "true")
	if c, err := Load(); err != nil || !c.DevPurchases {
		t.Fatalf("DEV_PURCHASES=true → %v, %v", c != nil && c.DevPurchases, err)
	}
}

func TestLoad_ProdRejectsDevPurchases(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://localhost/db")
	t.Setenv("APP_ENV", "production")
	t.Setenv("MEDIA_URL_SECRET", "real-media-secret-xyz")
	t.Setenv("TURN_SECRET", "real-turn-secret-xyz")
	t.Setenv("MINIO_ACCESS_KEY", "realkey")
	t.Setenv("MINIO_SECRET_KEY", "realsecret")
	t.Setenv("DEV_OTP_CODE", "disabled-in-prod")

	t.Setenv("DEV_PURCHASES", "true")
	if _, err := Load(); err == nil {
		t.Fatal("прод принял DEV_PURCHASES=true")
	}
	t.Setenv("DEV_PURCHASES", "")
	if _, err := Load(); err != nil {
		t.Fatalf("прод без DEV_PURCHASES отвергнут: %v", err)
	}
}

// APP_ENV сравнивается без учёта регистра и пробелов: «Production » - прод, и
// DEV_PURCHASES в нём запрещён, как и дефолтные секреты.
func TestLoad_AppEnvNormalized(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://localhost/db")
	t.Setenv("MEDIA_URL_SECRET", "real-media-secret-xyz")
	t.Setenv("TURN_SECRET", "real-turn-secret-xyz")
	t.Setenv("MINIO_ACCESS_KEY", "realkey")
	t.Setenv("MINIO_SECRET_KEY", "realsecret")
	t.Setenv("DEV_OTP_CODE", "disabled-in-prod")

	t.Setenv("APP_ENV", "Production ")
	t.Setenv("DEV_PURCHASES", "true")
	if _, err := Load(); err == nil {
		t.Fatal(`APP_ENV="Production " + DEV_PURCHASES принят`)
	}
	// fail-fast на дефолтных секретах тоже срабатывает на нормализованном значении.
	t.Setenv("DEV_PURCHASES", "")
	t.Setenv("MEDIA_URL_SECRET", "")
	if _, err := Load(); err == nil {
		t.Fatal(`APP_ENV="Production " не включил проверку дефолтных секретов`)
	}
}

// Незнакомое окружение + DEV_PURCHASES=true - отказ старта (опечатка «prod»
// не должна открывать дармовые звёзды).
func TestLoad_UnknownAppEnvRejectsDevPurchases(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://localhost/db")
	t.Setenv("DEV_PURCHASES", "true")

	t.Setenv("APP_ENV", "prod")
	if _, err := Load(); err == nil {
		t.Fatal(`APP_ENV=prod + DEV_PURCHASES принят`)
	}
	for _, env := range []string{"", "  ", "development", "Dev", "test"} {
		t.Setenv("APP_ENV", env)
		if _, err := Load(); err != nil {
			t.Fatalf("APP_ENV=%q + DEV_PURCHASES отвергнут: %v", env, err)
		}
	}
	// Без флага незнакомое окружение стартует, как и раньше.
	t.Setenv("DEV_PURCHASES", "")
	t.Setenv("APP_ENV", "prod")
	if _, err := Load(); err != nil {
		t.Fatalf("APP_ENV=prod без флага отвергнут: %v", err)
	}
}
