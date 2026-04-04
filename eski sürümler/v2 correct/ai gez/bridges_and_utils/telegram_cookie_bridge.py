"""Telegram cookie bridge.

AmaÃ§:
- Sunucuda yenilenen cookie bilgisini Telegram'a gondermek.
- Web tarafinda Telegram'dan son cookie payload'ini alip curl_request.sh'e yazmak.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
load_dotenv()

import requests

PROJECT_ROOT = Path(__file__).resolve().parent
SAHIBINDEN_URL = os.getenv("SAHIBINDEN_URL", "https://www.sahibinden.com/ekran-karti-masaustu")
CURL_PATH = PROJECT_ROOT / "curl_request.sh"
CHROME_VERSION_MAIN = os.getenv("CHROME_VERSION_MAIN")
OFFSET_FILE = PROJECT_ROOT / ".telegram_offset"
PAYLOAD_FILENAME = "access_bundle.json"
LEGACY_PAYLOAD_FILENAME = "cookie_payload.json"
PAYLOAD_CAPTION_PREFIX = "ACCESS_PACKAGE_V1"
PAYLOAD_TEXT_PREFIX = "ACCESS_PACKAGE_JSON::"
LEGACY_PAYLOAD_TEXT_PREFIX = "COOKIE_PAYLOAD_JSON::"


def _require_env(name: str) -> str:
    value = os.getenv(name, "").strip()
    if not value:
        raise RuntimeError(f"Eksik ortam degiskeni: {name}")
    return value


def _token_chat() -> tuple[str, str]:
    token = _require_env("TELEGRAM_BOT_TOKEN")
    chat_id = _require_env("TELEGRAM_CHAT_ID")
    return token, chat_id


def _api_base(token: str) -> str:
    return f"https://api.telegram.org/bot{token}"


def _api_file_base(token: str) -> str:
    return f"https://api.telegram.org/file/bot{token}"


def _post(token: str, method: str, data: dict[str, Any] | None = None, files: dict[str, Any] | None = None) -> Any:
    url = f"{_api_base(token)}/{method}"
    resp = requests.post(url, data=data, files=files, timeout=45)
    resp.raise_for_status()
    payload = resp.json()
    if not payload.get("ok"):
        raise RuntimeError(f"Telegram {method} hatasi: {payload}")
    return payload.get("result")


def _get(token: str, method: str, params: dict[str, Any] | None = None) -> Any:
    url = f"{_api_base(token)}/{method}"
    resp = requests.get(url, params=params, timeout=45)
    resp.raise_for_status()
    payload = resp.json()
    if not payload.get("ok"):
        raise RuntimeError(f"Telegram {method} hatasi: {payload}")
    return payload.get("result")


def _get_file_text(token: str, file_path: str) -> str:
    url = f"{_api_file_base(token)}/{file_path}"
    resp = requests.get(url, timeout=45)
    resp.raise_for_status()
    return resp.text


def _load_offset(path: Path) -> int | None:
    if not path.exists():
        return None
    raw = path.read_text(encoding="utf-8").strip()
    if not raw:
        return None
    try:
        return int(raw)
    except ValueError:
        return None


def _save_offset(path: Path, offset: int) -> None:
    path.write_text(str(offset), encoding="utf-8")
    if os.name == "posix":
        os.chmod(path, 0o600)


def _payload(cookie: str, ua: str, reason: str, source: str) -> dict[str, Any]:
    return {
        "version": 1,
        "created_at_utc": datetime.now(timezone.utc).isoformat(),
        "source": source,
        "reason": reason,
        "url": SAHIBINDEN_URL,
        "access_len": len(cookie),
        "cookie_len": len(cookie),
        "ua": ua,
        "cookie": cookie,
    }


def _extract_chrome_major(ua: str) -> str | None:
    match = re.search(r"Chrome/(\d+)", ua)
    return match.group(1) if match else None


def _sec_ch_platform(ua: str) -> str:
    ua_lower = ua.lower()
    if "windows" in ua_lower:
        return "Windows"
    if "linux" in ua_lower:
        return "Linux"
    if "mac os x" in ua_lower or "macintosh" in ua_lower:
        return "macOS"
    return "Windows"


def parse_curl_file(curl_path: Path = CURL_PATH) -> dict[str, Any]:
    if not curl_path.exists():
        raise FileNotFoundError(f"{curl_path.name} bulunamadi.")

    url = ""
    headers: dict[str, str] = {}
    content = curl_path.read_text(encoding="utf-8")

    for raw in content.splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if line.endswith("\\"):
            line = line[:-1].strip()

        if line.startswith("curl "):
            m = re.search(r"curl\s+'([^']+)'", line)
            if m:
                url = m.group(1)
        elif line.startswith("-H "):
            m = re.search(r"-H\s+'([^:]+):\s*(.*)'$", line)
            if m:
                headers[m.group(1).strip()] = m.group(2).strip()

    if not url:
        url = SAHIBINDEN_URL
    return {"url": url, "headers": headers}


def save_curl_file(cookie: str, ua: str, curl_path: Path = CURL_PATH) -> None:
    chrome_major = _extract_chrome_major(ua) or CHROME_VERSION_MAIN or "145"
    platform = _sec_ch_platform(ua)
    content = f"""#!/bin/bash
# Sahibinden.com - telegram bridge tarafindan guncellendi

curl '{SAHIBINDEN_URL}' \\
  -H 'Upgrade-Insecure-Requests: 1' \\
  -H 'User-Agent: {ua}' \\
  -H 'sec-ch-ua: "Not:A-Brand";v="99", "Google Chrome";v="{chrome_major}", "Chromium";v="{chrome_major}"' \\
  -H 'sec-ch-ua-arch: "x86"' \\
  -H 'sec-ch-ua-bitness: "64"' \\
  -H 'sec-ch-ua-mobile: ?0' \\
  -H 'sec-ch-ua-model: ""' \\
  -H 'sec-ch-ua-platform: "{platform}"' \\
  -H 'Cookie: {cookie}' \\
  --compressed
"""
    curl_path.write_text(content, encoding="utf-8")
    if os.name == "posix":
        os.chmod(curl_path, 0o600)


def send_cookie_payload(cookie: str, ua: str, reason: str, source: str = "cookie_auto_refresh") -> tuple[bool, str]:
    try:
        token, chat_id = _token_chat()
    except Exception as exc:
        return False, str(exc)

    try:
        data = _payload(cookie=cookie, ua=ua, reason=reason, source=source)
        raw = json.dumps(data, ensure_ascii=False).encode("utf-8")

        caption = (
            f"{PAYLOAD_CAPTION_PREFIX}\n"
            f"source={source}\n"
            f"reason={reason}\n"
            f"access_len={len(cookie)}"
        )
        files = {"document": (PAYLOAD_FILENAME, raw, "application/json")}
        _post(token, "sendDocument", data={"chat_id": chat_id, "caption": caption}, files=files)
        return True, "ok"
    except Exception as exc:
        return False, str(exc)


def send_current_curl(reason: str = "manual_push", source: str = "manual") -> tuple[bool, str]:
    try:
        config = parse_curl_file()
    except Exception as exc:
        return False, f"curl parse hatasi: {exc}"

    headers = config.get("headers", {})
    cookie = headers.get("Cookie", "").strip()
    ua = headers.get("User-Agent", "").strip()
    if not cookie:
        return False, "Cookie header bos."
    if not ua:
        return False, "User-Agent header bos."

    return send_cookie_payload(cookie=cookie, ua=ua, reason=reason, source=source)


def _iter_updates_messages(updates: list[dict[str, Any]]) -> list[tuple[int, dict[str, Any]]]:
    result: list[tuple[int, dict[str, Any]]] = []
    for update in updates:
        update_id = int(update.get("update_id", 0))
        message = update.get("message") or update.get("channel_post")
        if not isinstance(message, dict):
            continue
        result.append((update_id, message))
    return result


def _chat_matches(message: dict[str, Any], expected_chat_id: str) -> bool:
    chat = message.get("chat", {})
    chat_id = str(chat.get("id", "")).strip()
    return chat_id == str(expected_chat_id).strip()


def _extract_payload_from_message(token: str, message: dict[str, Any]) -> dict[str, Any] | None:
    doc = message.get("document")
    if isinstance(doc, dict):
        file_id = doc.get("file_id")
        file_name = str(doc.get("file_name", "")).lower()
        if file_id and (file_name.endswith(".json") or PAYLOAD_FILENAME in file_name or LEGACY_PAYLOAD_FILENAME in file_name):
            file_meta = _get(token, "getFile", {"file_id": file_id})
            file_path = file_meta.get("file_path")
            if file_path:
                text = _get_file_text(token, file_path)
                payload = json.loads(text)
                if payload.get("cookie") and payload.get("ua"):
                    return payload

    text = str(message.get("text", ""))
    if text.startswith(PAYLOAD_TEXT_PREFIX) or text.startswith(LEGACY_PAYLOAD_TEXT_PREFIX):
        payload_text = text.split("::", 1)[1]
        payload = json.loads(payload_text)
        if payload.get("cookie") and payload.get("ua"):
            return payload

    return None


def pull_latest_payload(
    offset_file: Path = OFFSET_FILE,
    limit: int = 100,
    commit_offset: bool = True,
) -> tuple[dict[str, Any] | None, str]:
    try:
        token, chat_id = _token_chat()
    except Exception as exc:
        return None, str(exc)

    params: dict[str, Any] = {"limit": limit}
    offset = _load_offset(offset_file)
    if offset is not None:
        params["offset"] = offset

    try:
        updates = _get(token, "getUpdates", params=params)
    except Exception as exc:
        return None, f"getUpdates hatasi: {exc}"

    if not updates:
        return None, "Yeni update yok."

    messages = _iter_updates_messages(updates)
    if not messages:
        if commit_offset:
            max_update = max(int(u.get("update_id", 0)) for u in updates)
            _save_offset(offset_file, max_update + 1)
        return None, "Mesaj update'i yok."

    payload: dict[str, Any] | None = None
    for _, message in reversed(messages):
        if not _chat_matches(message, chat_id):
            continue
        parsed = _extract_payload_from_message(token, message)
        if parsed:
            payload = parsed
            break

    if commit_offset:
        max_update = max(update_id for update_id, _ in messages)
        _save_offset(offset_file, max_update + 1)

    if not payload:
        return None, "Uygun payload bulunamadi."
    return payload, "ok"


def apply_payload_to_curl(payload: dict[str, Any]) -> tuple[bool, str]:
    cookie = str(payload.get("cookie", "")).strip()
    ua = str(payload.get("ua", "")).strip()
    if not cookie or not ua:
        return False, "Payload cookie/ua eksik."
    try:
        save_curl_file(cookie, ua)
        return True, "curl_request.sh guncellendi."
    except Exception as exc:
        return False, f"curl yazma hatasi: {exc}"


def run_pull_once(offset_file: Path, no_commit_offset: bool) -> int:
    payload, msg = pull_latest_payload(offset_file=offset_file, commit_offset=not no_commit_offset)
    if not payload:
        print(f"[!] {msg}")
        return 0
    ok, write_msg = apply_payload_to_curl(payload)
    if not ok:
        print(f"[-] {write_msg}")
        return 1
    print(f"[+] {write_msg}")
    return 0


def run_pull_daemon(offset_file: Path, interval_seconds: int, no_commit_offset: bool) -> int:
    interval = max(10, interval_seconds)
    print(f"[*] Telegram pull daemon basladi (interval={interval}s)")
    while True:
        code = run_pull_once(offset_file=offset_file, no_commit_offset=no_commit_offset)
        if code != 0:
            print(f"[!] Son calisma kodu: {code}")
        time.sleep(interval)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Telegram cookie bridge")
    sub = parser.add_subparsers(dest="cmd", required=True)

    push = sub.add_parser("push", help="Mevcut curl_request.sh bilgisini Telegram'a gonder")
    push.add_argument("--reason", default="manual_push")
    push.add_argument("--source", default="manual")

    pull = sub.add_parser("pull", help="Telegram'dan son cookie payload'ini cek ve curl dosyasina yaz")
    pull.add_argument("--offset-file", default=str(OFFSET_FILE))
    pull.add_argument("--no-commit-offset", action="store_true")

    daemon = sub.add_parser("pull-daemon", help="Belirli araliklarla Telegram'dan cookie cek")
    daemon.add_argument("--offset-file", default=str(OFFSET_FILE))
    daemon.add_argument("--interval-seconds", type=int, default=60)
    daemon.add_argument("--no-commit-offset", action="store_true")
    return parser


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()

    if args.cmd == "push":
        ok, msg = send_current_curl(reason=args.reason, source=args.source)
        if not ok:
            print(f"[-] {msg}")
            raise SystemExit(1)
        print("[+] Telegram'a cookie payload gonderildi.")
        return

    if args.cmd == "pull":
        code = run_pull_once(
            offset_file=Path(args.offset_file),
            no_commit_offset=args.no_commit_offset,
        )
        raise SystemExit(code)

    if args.cmd == "pull-daemon":
        code = run_pull_daemon(
            offset_file=Path(args.offset_file),
            interval_seconds=args.interval_seconds,
            no_commit_offset=args.no_commit_offset,
        )
        raise SystemExit(code)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n[!] Iptal edildi.")



