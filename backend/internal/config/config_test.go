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
