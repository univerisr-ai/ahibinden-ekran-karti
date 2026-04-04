"""GCS cookie bridge.

Amac:
- Yenilenen cookie payload'ini Google Cloud Storage'a yazmak.
- Baska bir makinede ayni payload'i okuyup curl_request.sh dosyasini guncellemek.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from dotenv import load_dotenv

load_dotenv()

PROJECT_ROOT = Path(__file__).resolve().parent
SAHIBINDEN_URL = os.getenv("SAHIBINDEN_URL", "https://www.sahibinden.com/ekran-karti-masaustu")
CURL_PATH = PROJECT_ROOT / "curl_request.sh"
CHROME_VERSION_MAIN = os.getenv("CHROME_VERSION_MAIN")
DEFAULT_BUCKET = os.getenv("GCS_COOKIE_BUCKET", "").strip()
DEFAULT_OBJECT = os.getenv("GCS_COOKIE_OBJECT", "cookie/latest.json").strip() or "cookie/latest.json"
DEFAULT_HISTORY_PREFIX = os.getenv("GCS_COOKIE_HISTORY_PREFIX", "cookie/history").strip()


def _require_env(name: str) -> str:
    value = os.getenv(name, "").strip()
    if not value:
        raise RuntimeError(f"Eksik ortam degiskeni: {name}")
    return value


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
            match = re.search(r"curl\s+'([^']+)'", line)
            if match:
                url = match.group(1)
        elif line.startswith("-H "):
            match = re.search(r"-H\s+'([^:]+):\s*(.*)'$", line)
            if match:
                headers[match.group(1).strip()] = match.group(2).strip()

    if not url:
        url = SAHIBINDEN_URL
    return {"url": url, "headers": headers}


def save_curl_file(cookie: str, ua: str, curl_path: Path = CURL_PATH) -> None:
    chrome_major = _extract_chrome_major(ua) or CHROME_VERSION_MAIN or "145"
    platform = _sec_ch_platform(ua)
    content = f"""#!/bin/bash
# Sahibinden.com - gcs bridge tarafindan guncellendi

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


def _payload(cookie: str, ua: str, reason: str, source: str) -> dict[str, Any]:
    return {
        "version": 1,
        "created_at_utc": datetime.now(timezone.utc).isoformat(),
        "source": source,
        "reason": reason,
        "url": SAHIBINDEN_URL,
        "cookie_len": len(cookie),
        "ua": ua,
        "cookie": cookie,
    }


def _storage_client():
    try:
        from google.cloud import storage
    except Exception as exc:
        raise RuntimeError(
            "google-cloud-storage paketi yok. `pip install google-cloud-storage` calistirin."
        ) from exc
    return storage.Client()


def _resolve_bucket_object(bucket: str | None, object_name: str | None) -> tuple[str, str]:
    bucket_name = (bucket or DEFAULT_BUCKET or _require_env("GCS_COOKIE_BUCKET")).strip()
    blob_name = (object_name or DEFAULT_OBJECT).strip()
    if not bucket_name:
        raise RuntimeError("GCS bucket bos olamaz.")
    if not blob_name:
        raise RuntimeError("GCS object yolu bos olamaz.")
    return bucket_name, blob_name


def upload_cookie_payload(
    cookie: str,
    ua: str,
    reason: str,
    source: str = "cookie_auto_refresh",
    bucket: str | None = None,
    object_name: str | None = None,
    write_history: bool = True,
) -> tuple[bool, str]:
    if not cookie or not ua:
        return False, "cookie/ua bos."

    try:
        bucket_name, blob_name = _resolve_bucket_object(bucket, object_name)
        data = _payload(cookie=cookie, ua=ua, reason=reason, source=source)
        raw = json.dumps(data, ensure_ascii=False).encode("utf-8")

        client = _storage_client()
        bucket_ref = client.bucket(bucket_name)

        latest_blob = bucket_ref.blob(blob_name)
        latest_blob.upload_from_string(raw, content_type="application/json")

        if write_history and DEFAULT_HISTORY_PREFIX:
            ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
            suffix = uuid.uuid4().hex[:8]
            history_name = f"{DEFAULT_HISTORY_PREFIX.rstrip('/')}/{ts}-{suffix}.json"
            bucket_ref.blob(history_name).upload_from_string(raw, content_type="application/json")

        return True, f"ok bucket={bucket_name} object={blob_name}"
    except Exception as exc:
        return False, str(exc)


def send_current_curl(
    reason: str = "manual_push",
    source: str = "manual",
    bucket: str | None = None,
    object_name: str | None = None,
    write_history: bool = True,
) -> tuple[bool, str]:
    try:
        config = parse_curl_file()
    except Exception as exc:
        return False, f"curl parse hatasi: {exc}"

    headers = config.get("headers", {})
    cookie = str(headers.get("Cookie", "")).strip()
    ua = str(headers.get("User-Agent", "")).strip()
    if not cookie:
        return False, "Cookie header bos."
    if not ua:
        return False, "User-Agent header bos."

    return upload_cookie_payload(
        cookie=cookie,
        ua=ua,
        reason=reason,
        source=source,
        bucket=bucket,
        object_name=object_name,
        write_history=write_history,
    )


def download_latest_payload(
    bucket: str | None = None,
    object_name: str | None = None,
) -> tuple[dict[str, Any] | None, str]:
    try:
        bucket_name, blob_name = _resolve_bucket_object(bucket, object_name)
        client = _storage_client()
        blob = client.bucket(bucket_name).blob(blob_name)
        raw = blob.download_as_text(encoding="utf-8")
        payload = json.loads(raw)
    except Exception as exc:
        return None, f"GCS okuma hatasi: {exc}"

    cookie = str(payload.get("cookie", "")).strip()
    ua = str(payload.get("ua", "")).strip()
    if not cookie or not ua:
        return None, "Payload cookie/ua eksik."
    return payload, "ok"


def apply_payload_to_curl(payload: dict[str, Any]) -> tuple[bool, str]:
    cookie = str(payload.get("cookie", "")).strip()
    ua = str(payload.get("ua", "")).strip()
    if not cookie or not ua:
        return False, "Payload cookie/ua eksik."
    try:
        save_curl_file(cookie=cookie, ua=ua)
        return True, "curl_request.sh guncellendi."
    except Exception as exc:
        return False, f"curl yazma hatasi: {exc}"


def run_pull_once(bucket: str | None, object_name: str | None) -> int:
    payload, msg = download_latest_payload(bucket=bucket, object_name=object_name)
    if not payload:
        print(f"[!] {msg}")
        return 1
    ok, write_msg = apply_payload_to_curl(payload)
    if not ok:
        print(f"[-] {write_msg}")
        return 1
    print(f"[+] {write_msg}")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="GCS cookie bridge")
    sub = parser.add_subparsers(dest="cmd", required=True)

    push = sub.add_parser("push", help="Mevcut curl_request.sh bilgisini GCS'e gonder")
    push.add_argument("--reason", default="manual_push")
    push.add_argument("--source", default="manual")
    push.add_argument("--bucket", default=None)
    push.add_argument("--object", dest="object_name", default=None)
    push.add_argument("--no-history", action="store_true")

    pull = sub.add_parser("pull", help="GCS'ten payload cek ve curl_request.sh dosyasini guncelle")
    pull.add_argument("--bucket", default=None)
    pull.add_argument("--object", dest="object_name", default=None)
    return parser


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()

    if args.cmd == "push":
        ok, msg = send_current_curl(
            reason=args.reason,
            source=args.source,
            bucket=args.bucket,
            object_name=args.object_name,
            write_history=not args.no_history,
        )
        if not ok:
            print(f"[-] {msg}")
            raise SystemExit(1)
        print(f"[+] GCS'e payload gonderildi. {msg}")
        return

    if args.cmd == "pull":
        code = run_pull_once(bucket=args.bucket, object_name=args.object_name)
        raise SystemExit(code)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n[!] Iptal edildi.")

