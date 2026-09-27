#!/usr/bin/env python3
"""Выгрузка каталога обоев и облачных тем Telegram для cmd/seed-wallpapers.

Ходит тем же путём, что и tweb (lib/appManagers/appThemesManager.ts):
account.getWallPapers — каталог обоев (узоры .tgv, фото, «только цвет»),
account.getThemes(format: 'macos') — облачные темы (карусель «Общих»,
chatThemesPicker.tsx:166), account.getChatThemes — темы чатов с эмодзи
(Р4 плана docs/superpowers/plans/2026-09-27-wallpapers-themes.md).

Раскладка на диске — та, что читает backend/cmd/seed-wallpapers --root <out> (засев
заводит задача 6 плана docs/superpowers/plans/2026-09-27-wallpapers-themes.md; формат
meta.json описан там же):

    <out>/wallpapers/meta.json  {"wallpapers": [{slug, source_id, pattern, dark, default,
                                  in_catalog, file, mime, settings: {...}}]}
    <out>/wallpapers/files/<slug>.tgv | .jpg | .png
    <out>/themes/meta.json      {"themes": [{slug, title, emoticon, for_chat,
                                  settings: [{base_theme, accent_color, outbox_accent_color,
                                              message_colors, wallpaper_slug}]}]}

Обои, на которые ссылаются темы, но которых нет в каталоге, выгружаются тоже —
с in_catalog: false (так их хранит план: обои темы вне сетки «Обоев»). Файлы
кладутся как есть: .tgv остаётся gzip'нутым SVG, распаковывает клиент.
meta.json пишутся последними; уже скачанный файл повторно не качается.

По умолчанию выгрузка идёт в backend/assets/telegram/ — каталог в .gitignore:
официальные обои — работы художников, опубликованные Telegram, в репозиторий
они не попадают. Засев из неё — `seed-wallpapers --root backend/assets/telegram`.

Запуск (авторизация интерактивная — телефон, код, при 2FA пароль):

    tools/.venv/bin/python tools/fetch_wallpapers.py            # всё
    tools/.venv/bin/python tools/fetch_wallpapers.py --limit 5  # проба

api_id/api_hash — из TG_API_ID/TG_API_HASH или tools/.tg.env, иначе спрашиваются
в консоли (как у tools/fetch_stickers.py; сессия общая — tools/.tg_session).
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import re
import sys
from pathlib import Path

from telethon import TelegramClient
from telethon.errors import FloodWaitError, RPCError
from telethon.tl import functions, types

TOOLS_DIR = Path(__file__).resolve().parent
REPO_ROOT = TOOLS_DIR.parent
SESSION = TOOLS_DIR / ".tg_session"
ENV_FILE = TOOLS_DIR / ".tg.env"

# Расширение по mime документа обоев: узор — gzip'нутый SVG (tweb
# appDocsManager: 'application/x-tgwallpattern'), фото — jpeg/png.
EXT_BY_MIME = {
    "application/x-tgwallpattern": ".tgv",
    "image/jpeg": ".jpg",
    "image/png": ".png",
}

# Базовые темы — имя конструктора схемы (tweb config/state.ts: base_theme._).
BASE_THEME_NAME = {
    types.BaseThemeClassic: "baseThemeClassic",
    types.BaseThemeDay: "baseThemeDay",
    types.BaseThemeNight: "baseThemeNight",
    types.BaseThemeTinted: "baseThemeTinted",
    types.BaseThemeArctic: "baseThemeArctic",
}


def load_credentials() -> tuple[int, str]:
    """api_id/api_hash из окружения, из tools/.tg.env или из вопроса в консоли."""
    if ENV_FILE.exists():
        for line in ENV_FILE.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                key, value = line.split("=", 1)
                os.environ.setdefault(key.strip(), value.strip())

    api_id = os.environ.get("TG_API_ID") or input("api_id (my.telegram.org): ").strip()
    api_hash = os.environ.get("TG_API_HASH") or input("api_hash: ").strip()
    if not api_id or not api_hash:
        sys.exit("нужны api_id и api_hash — получите их на https://my.telegram.org")
    return int(api_id), api_hash


async def call(client: TelegramClient, request):
    """Запрос с ожиданием FLOOD_WAIT."""
    while True:
        try:
            return await client(request)
        except FloodWaitError as e:
            print(f"  FLOOD_WAIT {e.seconds}s — жду", flush=True)
            await asyncio.sleep(e.seconds + 1)


def safe_slug(value: str) -> str:
    """Slug как имя файла: у Telegram это [A-Za-z0-9_-], но проверяем."""
    return re.sub(r"[^A-Za-z0-9_-]", "_", value) or "wallpaper"


def settings_json(s: types.WallPaperSettings | None) -> dict:
    """WallPaperSettings → поля схемы 1:1 (tweb читает их из wallpaper.settings)."""
    if s is None:
        return {}
    out: dict = {}
    for name in (
        "background_color",
        "second_background_color",
        "third_background_color",
        "fourth_background_color",
        "intensity",
        "rotation",
        "emoticon",
    ):
        value = getattr(s, name, None)
        if value is not None:
            out[name] = value
    if getattr(s, "blur", False):
        out["blur"] = True
    if getattr(s, "motion", False):
        out["motion"] = True
    return out


def wallpaper_slug(wp) -> str:
    """Slug обоев. У wallPaperNoFile slug нет — свой по id, чтобы темы могли сослаться."""
    if isinstance(wp, types.WallPaper) and wp.slug:
        return safe_slug(wp.slug)
    return f"nofile-{wp.id}"


async def export_wallpaper(client: TelegramClient, wp, files_dir: Path, in_catalog: bool) -> dict:
    """Одни обои → запись meta.json; документ качается, если его ещё нет на диске."""
    slug = wallpaper_slug(wp)
    entry: dict = {
        "slug": slug,
        "source_id": wp.id,
        "pattern": bool(getattr(wp, "pattern", False)),
        "dark": bool(getattr(wp, "dark", False)),
        "default": bool(getattr(wp, "default", False)),
        "in_catalog": in_catalog,
        "file": None,
        "mime": None,
        "settings": settings_json(getattr(wp, "settings", None)),
    }
    document = getattr(wp, "document", None)
    if isinstance(document, types.Document):
        ext = EXT_BY_MIME.get(document.mime_type, "")
        if not ext:
            print(f"  ! {slug}: неизвестный mime {document.mime_type} — пропуск файла", flush=True)
        else:
            target = files_dir / f"{slug}{ext}"
            if not target.exists():
                await client.download_media(document, file=str(target))
            entry["file"] = f"files/{target.name}"
            entry["mime"] = document.mime_type
    return entry


def theme_settings_json(ts: types.ThemeSettings, wallpaper_slug_of) -> dict:
    """ThemeSettings → запись; обои темы — ссылкой на slug в wallpapers/meta.json."""
    out: dict = {
        "base_theme": BASE_THEME_NAME.get(type(ts.base_theme), type(ts.base_theme).__name__),
        "accent_color": ts.accent_color,
    }
    if getattr(ts, "outbox_accent_color", None) is not None:
        out["outbox_accent_color"] = ts.outbox_accent_color
    if getattr(ts, "message_colors", None):
        out["message_colors"] = list(ts.message_colors)
    if getattr(ts, "message_colors_animated", False):
        out["message_colors_animated"] = True
    if getattr(ts, "wallpaper", None) is not None:
        out["wallpaper_slug"] = wallpaper_slug_of(ts.wallpaper)
    return out


async def main() -> None:
    ap = argparse.ArgumentParser(description="выгрузка обоев и облачных тем Telegram для seed-wallpapers")
    ap.add_argument(
        "--out", default=str(REPO_ROOT / "backend" / "assets" / "telegram"), help="корень выгрузки (--root засева)"
    )
    ap.add_argument("--limit", type=int, default=0, help="максимум обоев каталога (0 — все)")
    ap.add_argument("--skip-themes", action="store_true", help="не выгружать облачные темы и темы чатов")
    args = ap.parse_args()

    out = Path(args.out)
    wp_dir = out / "wallpapers"
    files_dir = wp_dir / "files"
    themes_dir = out / "themes"
    files_dir.mkdir(parents=True, exist_ok=True)
    themes_dir.mkdir(parents=True, exist_ok=True)

    api_id, api_hash = load_credentials()
    client = TelegramClient(str(SESSION), api_id, api_hash, flood_sleep_threshold=0)
    await client.start()

    entries: dict[str, dict] = {}
    failed: list[tuple[str, str]] = []

    result = await call(client, functions.account.GetWallPapersRequest(hash=0))
    catalog = list(getattr(result, "wallpapers", []) or [])
    if args.limit:
        catalog = catalog[: args.limit]
    print(f"каталог обоев: {len(catalog)}", flush=True)
    for i, wp in enumerate(catalog, start=1):
        slug = wallpaper_slug(wp)
        try:
            entries[slug] = await export_wallpaper(client, wp, files_dir, in_catalog=True)
            print(f"  [{i}/{len(catalog)}] {slug}", flush=True)
        except RPCError as e:
            print(f"  ! {slug}: {e.__class__.__name__} {e}", flush=True)
            failed.append((slug, str(e)))

    themes_out: list[dict] = []
    if not args.skip_themes:
        themes: list[types.Theme] = []
        cloud = await call(client, functions.account.GetThemesRequest(format="macos", hash=0))
        themes += list(getattr(cloud, "themes", []) or [])
        chat = await call(client, functions.account.GetChatThemesRequest(hash=0))
        chat_themes = list(getattr(chat, "themes", []) or [])
        seen = {t.id for t in themes}
        themes += [t for t in chat_themes if t.id not in seen]
        print(f"темы: облачных {len(themes) - len(chat_themes)}+, чатов {len(chat_themes)}", flush=True)

        # Обои тем, которых нет в каталоге, — отдельными записями вне сетки.
        for theme in themes:
            for ts in theme.settings or []:
                wp = getattr(ts, "wallpaper", None)
                if wp is None:
                    continue
                slug = wallpaper_slug(wp)
                if slug in entries:
                    continue
                try:
                    entries[slug] = await export_wallpaper(client, wp, files_dir, in_catalog=False)
                except RPCError as e:
                    print(f"  ! обои темы {slug}: {e.__class__.__name__} {e}", flush=True)
                    failed.append((slug, str(e)))

        for theme in themes:
            themes_out.append(
                {
                    "slug": safe_slug(theme.slug) if theme.slug else f"theme-{theme.id}",
                    "title": theme.title,
                    "emoticon": getattr(theme, "emoticon", None),
                    "for_chat": bool(getattr(theme, "for_chat", False)),
                    "settings": [theme_settings_json(ts, wallpaper_slug) for ts in (theme.settings or [])],
                }
            )

    # meta.json — последними: прерванный прогон не оставит ссылок на недокачанное.
    (wp_dir / "meta.json").write_text(
        json.dumps({"wallpapers": list(entries.values())}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    if not args.skip_themes:
        (themes_dir / "meta.json").write_text(
            json.dumps({"themes": themes_out}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )

    await client.disconnect()
    print(f"\nобоев: {len(entries)}, тем: {len(themes_out)} → {out}", flush=True)
    if failed:
        print(f"не выгружено: {len(failed)}", flush=True)
        for slug, err in failed:
            print(f"  {slug}: {err}", flush=True)


if __name__ == "__main__":
    asyncio.run(main())
