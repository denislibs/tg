#!/usr/bin/env python3
"""Выгрузка стикер-наборов из Telegram в assets/stickers/ для seed-stickers.

Ходит тем же путём, что и tweb (appStickersManager): messages.getAllStickers —
установленные наборы, messages.getFeaturedStickers + getOldFeaturedStickers —
весь Trending, messages.getFeaturedEmojiStickers — наборы анимированных эмодзи.
Состав набора всегда берётся отдельным messages.getStickerSet: featured отдаёт
лишь обложку из пяти стикеров.

Раскладка на диске — ровно та, что ждёт backend/cmd/seed-stickers:

    <out>/<short_name>/meta.json  {title, kind, stickers: [{file, emoji}]}
    <out>/<short_name>/1.tgs      (или .webm / .webp)

Файлы кладутся как есть: .tgs остаётся gzip'нутым (бэкенд читает из него
размеры, фронт распаковывает DecompressionStream). meta.json пишется последним,
поэтому прогон возобновляем: набор с meta.json пропускается целиком.

Запуск (авторизация интерактивная — телефон, код, при 2FA пароль):

    tools/.venv/bin/python tools/fetch_stickers.py --limit 3   # проба
    tools/.venv/bin/python tools/fetch_stickers.py             # всё

api_id/api_hash берутся из TG_API_ID/TG_API_HASH или tools/.tg.env, иначе
спрашиваются в консоли. Получить их: https://my.telegram.org → API development.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
import time
from pathlib import Path

from telethon import TelegramClient
from telethon.errors import FloodWaitError, RPCError
from telethon.tl import functions, types

TOOLS_DIR = Path(__file__).resolve().parent
REPO_ROOT = TOOLS_DIR.parent
SESSION = TOOLS_DIR / ".tg_session"
ENV_FILE = TOOLS_DIR / ".tg.env"

# Расширение файла по mime документа. Telegram отдаёт стикеры ровно тремя
# видами: lottie в gzip (.tgs), видео vp9 (.webm) и статика (.webp).
EXT_BY_MIME = {
    "application/x-tgsticker": ".tgs",
    "video/webm": ".webm",
    "image/webp": ".webp",
    "image/png": ".png",
}

# Спец-наборы: у них нет short_name в каталоге, клиент берёт их по типу запроса
# (tweb: appStickersManager.getAnimatedEmojiStickerSet, STICKERS_LOCAL_IDS).
# Слаг задан явно, потому что каталог на диске — это slug в нашей БД, а фронт
# ищет большие эмодзи по фиксированному 'animated_emoji' (core/animatedEmoji.ts).
SPECIAL_SETS = [
    ("animated_emoji", "emoji", types.InputStickerSetAnimatedEmoji()),
    ("emoji_animations", "emoji", types.InputStickerSetAnimatedEmojiAnimations()),
    ("animated_dice", "sticker", types.InputStickerSetDice(emoticon="\U0001f3b2")),
    ("emoji_generic_animations", "emoji", types.InputStickerSetEmojiGenericAnimations()),
    ("emoji_statuses", "emoji", types.InputStickerSetEmojiDefaultStatuses()),
    ("topic_icons", "emoji", types.InputStickerSetEmojiDefaultTopicIcons()),
    ("premium_gifts", "sticker", types.InputStickerSetPremiumGifts()),
]


# Роли анимированной реакции: имя файла на диске → поле availableReaction.
# tweb показывает не все: appReactionsManager.ts:95-98 грузит around, static,
# appear и center, остальные нужны для полной анимации выбора и эффекта.
REACTION_ROLES = [
    ("static", "static_icon"),
    ("appear", "appear_animation"),
    ("select", "select_animation"),
    ("activate", "activate_animation"),
    ("effect", "effect_animation"),
    ("around", "around_animation"),
    ("center", "center_icon"),
]


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


def unwrap_covered(covered) -> types.StickerSet | None:
    """StickerSetCovered/FullCovered/MultiCovered — обёртки над самим набором."""
    return getattr(covered, "set", None)


def sticker_emoji(document: types.Document) -> str:
    """Эмодзи стикера — alt из DocumentAttributeSticker (или CustomEmoji у эмодзи-наборов)."""
    for attr in document.attributes:
        if isinstance(attr, (types.DocumentAttributeSticker, types.DocumentAttributeCustomEmoji)):
            return attr.alt or ""
    return ""


async def call(client: TelegramClient, request):
    """Запрос с ожиданием FLOOD_WAIT: выгрузка длинная, падать на лимите незачем."""
    while True:
        try:
            return await client(request)
        except FloodWaitError as e:
            print(f"  FLOOD_WAIT {e.seconds}s — жду", flush=True)
            await asyncio.sleep(e.seconds + 1)


async def collect_sets(
    client: TelegramClient, skip_installed: bool, skip_emoji: bool, skip_archive: bool = False
) -> list[types.StickerSet]:
    """Список наборов из всех источников, без дублей, в порядке появления."""
    found: dict[str, types.StickerSet] = {}

    def add(sets, source: str):
        added = 0
        for item in sets:
            s = item if isinstance(item, types.StickerSet) else unwrap_covered(item)
            # Маски нам не нужны: в схеме kind — только 'sticker' и 'emoji'.
            if s is None or s.masks:
                continue
            if s.short_name.lower() not in found:
                found[s.short_name.lower()] = s
                added += 1
        print(f"{source}: +{added} (всего {len(found)})", flush=True)

    if not skip_installed:
        res = await call(client, functions.messages.GetAllStickersRequest(hash=0))
        add(res.sets, "установленные")

    res = await call(client, functions.messages.GetFeaturedStickersRequest(hash=0))
    add(res.sets, "trending")

    # Старый featured — постранично, пока API отдаёт наборы: это наборы, которые
    # были в трендах раньше. Их на порядок больше, и качество там сильно ниже,
    # поэтому за флагом.
    offset, page = 0, 100
    while not skip_archive:
        res = await call(client, functions.messages.GetOldFeaturedStickersRequest(offset=offset, limit=page, hash=0))
        if not res.sets:
            break
        add(res.sets, f"trending (архив, offset {offset})")
        offset += page

    if not skip_emoji:
        res = await call(client, functions.messages.GetFeaturedEmojiStickersRequest(hash=0))
        add(res.sets, "emoji-наборы")

    return list(found.values())


async def download_cover(client: TelegramClient, s: types.StickerSet, target: Path) -> str | None:
    """Обложка набора (иконка вкладки в панели) в target/cover.*; None — обложки нет.

    Разбор 1:1 с tweb appStickersManager.getStickerSetThumbDownloadOptions:499 —
    берём photoSize (stripped-превью не годится), тип 'a' значит lottie, 'v' —
    видео, остальное webp. Набор без thumbs обложки не имеет: и tweb, и мы рисуем
    вместо неё первый стикер набора, поэтому качать нечего.
    """
    thumb = next((t for t in (s.thumbs or []) if isinstance(t, types.PhotoSize)), None)
    if thumb is None or s.thumb_version is None:
        return None

    ext = {"a": ".tgs", "v": ".webm"}.get(thumb.type, ".webp")
    path = target / f"cover{ext}"
    if not path.exists():
        location = types.InputStickerSetThumb(
            stickerset=types.InputStickerSetID(id=s.id, access_hash=s.access_hash),
            thumb_version=s.thumb_version,
        )
        await client.download_file(location, file=str(path), dc_id=s.thumb_dc_id)
    return path.name


async def fetch_set(
    client: TelegramClient,
    input_set,
    out: Path,
    slug: str,
    kind: str | None = None,
) -> tuple[int, int]:
    """Скачивает набор в out/<slug>/. kind=None — определить по флагу set.emojis.

    Возвращает (файлов, байт).
    """
    target = out / slug
    meta_path = target / "meta.json"
    if meta_path.exists():
        print(f"= {slug}: уже выгружен", flush=True)
        return 0, 0

    full = await call(client, functions.messages.GetStickerSetRequest(stickerset=input_set, hash=0))
    s = full.set
    if kind is None:
        kind = "emoji" if s.emojis else "sticker"

    target.mkdir(parents=True, exist_ok=True)
    stickers, total = [], 0
    for i, doc in enumerate(full.documents, start=1):
        ext = EXT_BY_MIME.get(doc.mime_type)
        if ext is None:
            print(f"  ? {slug}: пропускаю неизвестный mime {doc.mime_type}", flush=True)
            continue
        name = f"{i}{ext}"
        path = target / name
        if not path.exists():
            await client.download_media(doc, file=str(path))
        stickers.append({"file": name, "emoji": sticker_emoji(doc)})
        total += path.stat().st_size

    if not stickers:
        print(f"! {slug}: нечего сохранять", flush=True)
        return 0, 0

    cover = await download_cover(client, s, target)
    # short_name — чтобы набор можно было перезапросить по каталогу (докачка обложек),
    # cover игнорируется сидом: Go пропускает неизвестные поля meta.json.
    meta = {"title": s.title, "short_name": s.short_name, "kind": kind, "stickers": stickers}
    if cover:
        meta["cover"] = cover
    # meta.json — последним: он и служит отметкой «набор выгружен целиком».
    meta_path.write_text(json.dumps(meta, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"+ {slug}: {len(stickers)} шт., {total / 1024:.0f} KB — {s.title}", flush=True)
    return len(stickers), total


async def fetch_missing_covers(client: TelegramClient, out: Path) -> int:
    """Докачивает обложки наборам, выгруженным до того, как скрипт научился их брать.

    Признак «набор уже обработан новой версией» — поле short_name в meta.json:
    оно появляется вместе с обложкой, поэтому набор без обложки (у Telegram её
    просто нет) не перезапрашивается на каждом прогоне.
    """
    special_by_slug = {slug: inp for slug, _, inp in SPECIAL_SETS}
    done = 0
    for meta_path in sorted(out.glob("*/meta.json")):
        meta = json.loads(meta_path.read_text(encoding="utf-8"))
        slug = meta_path.parent.name
        if "short_name" in meta:
            continue

        input_set = special_by_slug.get(slug) or types.InputStickerSetShortName(short_name=slug)
        try:
            full = await call(client, functions.messages.GetStickerSetRequest(stickerset=input_set, hash=0))
        except RPCError as e:
            print(f"! {slug}: {e.__class__.__name__} {e}", flush=True)
            continue

        cover = await download_cover(client, full.set, meta_path.parent)
        meta["short_name"] = full.set.short_name
        if cover:
            meta["cover"] = cover
        meta_path.write_text(json.dumps(meta, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(f"+ {slug}: обложка {cover or '— нет, будет первый стикер'}", flush=True)
        done += 1
    return done


async def fetch_reactions(client: TelegramClient, out: Path) -> tuple[int, int]:
    """Анимированные реакции (messages.getAvailableReactions) в out/<кодпоинты>/.

    Каталог называется кодпоинтами эмодзи ('2764'), а не самим эмодзи: имя файла
    с эмодзи переживает не всякую файловую систему и не всякий архиватор. Сам
    эмодзи лежит в reactions.json — он и есть ключ, по которому клиент ищет набор.
    """
    res = await call(client, functions.messages.GetAvailableReactionsRequest(hash=0))
    out.mkdir(parents=True, exist_ok=True)

    index, files, size = [], 0, 0
    for r in res.reactions:
        slug = "-".join(f"{ord(ch):04x}" for ch in r.reaction)
        target = out / slug
        target.mkdir(parents=True, exist_ok=True)

        entry = {
            "reaction": r.reaction,
            "title": r.title,
            "slug": slug,
            "premium": bool(r.premium),
            "inactive": bool(r.inactive),
            "files": {},
        }
        for name, attr in REACTION_ROLES:
            doc = getattr(r, attr, None)
            ext = EXT_BY_MIME.get(doc.mime_type) if doc else None
            if ext is None:
                continue
            path = target / f"{name}{ext}"
            if not path.exists():
                await client.download_media(doc, file=str(path))
            entry["files"][name] = path.name
            files += 1
            size += path.stat().st_size

        index.append(entry)
        print(f"+ {r.reaction} {r.title}: {len(entry['files'])} файлов", flush=True)

    (out / "reactions.json").write_text(json.dumps(index, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"индекс: {out / 'reactions.json'} ({len(index)} реакций)", flush=True)
    return files, size


async def main() -> None:
    ap = argparse.ArgumentParser(description="выгрузка стикер-наборов Telegram в assets/stickers/")
    ap.add_argument("--out", default=str(REPO_ROOT / "backend" / "assets" / "stickers"), help="каталог выгрузки")
    ap.add_argument("--limit", type=int, default=0, help="максимум наборов (0 — все)")
    ap.add_argument("--skip-installed", action="store_true", help="не брать мои установленные наборы")
    ap.add_argument("--skip-emoji", action="store_true", help="не брать наборы анимированных эмодзи")
    ap.add_argument("--skip-archive", action="store_true", help="не брать архив трендов (getOldFeaturedStickers)")
    ap.add_argument("--special", action="store_true", help="выгрузить спец-наборы: большие эмодзи, эффекты, кубик")
    ap.add_argument("--reactions", action="store_true", help="выгрузить анимированные реакции в assets/reactions/")
    ap.add_argument("--covers", action="store_true", help="докачать обложки наборам, выгруженным раньше")
    ap.add_argument("--skip-sets", action="store_true", help="не качать стикер-наборы (например, только --reactions)")
    ap.add_argument(
        "--reactions-out",
        default=str(REPO_ROOT / "backend" / "assets" / "reactions"),
        help="каталог для реакций",
    )
    args = ap.parse_args()

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    api_id, api_hash = load_credentials()

    # flood_sleep_threshold=0 — ждём сами в call(), чтобы ожидание было видно в логе.
    client = TelegramClient(str(SESSION), api_id, api_hash, flood_sleep_threshold=0)
    await client.start()

    started = time.monotonic()
    files = size = done = 0
    failed: list[tuple[str, str]] = []

    if args.covers:
        print("докачка обложек:", flush=True)
        print(f"обновлено наборов: {await fetch_missing_covers(client, out)}\n", flush=True)

    if args.reactions:
        print("анимированные реакции:", flush=True)
        n, b = await fetch_reactions(client, Path(args.reactions_out))
        files += n
        size += b
        print(flush=True)

    if args.special:
        print("спец-наборы:", flush=True)
        for slug, kind, input_set in SPECIAL_SETS:
            try:
                n, b = await fetch_set(client, input_set, out, slug, kind)
            except RPCError as e:
                print(f"! {slug}: {e.__class__.__name__} {e}", flush=True)
                failed.append((slug, str(e)))
                continue
            files += n
            size += b
            if n:
                done += 1
        print(flush=True)

    sets = []
    if not args.skip_sets:
        sets = await collect_sets(client, args.skip_installed, args.skip_emoji, args.skip_archive)
        if args.limit:
            sets = sets[: args.limit]
        print(f"\nк выгрузке: {len(sets)} наборов\n", flush=True)

    for i, s in enumerate(sets, start=1):
        try:
            n, b = await fetch_set(client, types.InputStickerSetShortName(short_name=s.short_name), out, s.short_name.lower())
        except RPCError as e:
            # Набор мог быть удалён или закрыт — это не повод ронять весь прогон.
            print(f"! {s.short_name}: {e.__class__.__name__} {e}", flush=True)
            failed.append((s.short_name, str(e)))
            continue
        files += n
        size += b
        if n:
            done += 1
        if i % 25 == 0:
            print(f"  ... {i}/{len(sets)}", flush=True)

    await client.disconnect()

    print(f"\nготово: {done} наборов, {files} файлов, {size / 1024 / 1024:.1f} MB "
          f"за {time.monotonic() - started:.0f}s → {out}")
    if failed:
        print(f"не выгружено ({len(failed)}):")
        for name, err in failed:
            print(f"  {name}: {err}")


if __name__ == "__main__":
    asyncio.run(main())
