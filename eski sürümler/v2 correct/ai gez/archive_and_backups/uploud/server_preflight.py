"""Lightweight preflight checks for Linux server services.

Amac:
- systemd servisleri baslamadan once eksik dosya / env / bagimlilik sorunlarini yakalamak
- hassas dosya izinleri icin hizli uyarilar vermek
"""
from __future__ import annotations

import argparse
import importlib.util
import os
import shutil
import stat
from dataclasses import dataclass
from pathlib import Path

from dotenv import dotenv_values


PROJECT_ROOT = Path(__file__).resolve().parent
ENV_PATH = PROJECT_ROOT / ".env"


@dataclass
class CheckResult:
    level: str
    message: str


def _result(level: str, message: str) -> CheckResult:
    return CheckResult(level=level, message=message)


def _load_env() -> dict[str, str]:
    data: dict[str, str] = {}
    if ENV_PATH.exists():
        for key, value in dotenv_values(ENV_PATH).items():
            if key and value is not None:
                data[key] = str(value)
    for key, value in os.environ.items():
        if value:
            data[key] = value
    return data


def _check_file(path: Path, label: str | None = None, fatal: bool = True) -> CheckResult:
    if path.exists():
        return _result("ok", f"{label or path.name}: bulundu")
    return _result("fail" if fatal else "warn", f"{label or path.name}: eksik ({path})")


def _check_dir_writable(path: Path, label: str | None = None) -> CheckResult:
    if path.exists() and os.access(path, os.W_OK):
        return _result("ok", f"{label or path}: yazilabilir")
    return _result("fail", f"{label or path}: yazma izni yok veya dizin eksik")


def _check_env(env_map: dict[str, str], key: str, fatal: bool = True) -> CheckResult:
    if str(env_map.get(key, "")).strip():
        return _result("ok", f"Env hazir: {key}")
    return _result("fail" if fatal else "warn", f"Env eksik: {key}")


def _check_module(module_name: str, fatal: bool = True) -> CheckResult:
    try:
        spec = importlib.util.find_spec(module_name)
    except ModuleNotFoundError:
        spec = None
    if spec is not None:
        return _result("ok", f"Python modulu hazir: {module_name}")
    return _result("fail" if fatal else "warn", f"Python modulu eksik: {module_name}")


def _check_any_binary(names: list[str], label: str, fatal: bool = True) -> CheckResult:
    for name in names:
        if shutil.which(name):
            return _result("ok", f"{label}: bulundu ({name})")
    return _result("fail" if fatal else "warn", f"{label}: bulunamadi ({', '.join(names)})")


def _check_permissions(path: Path) -> CheckResult | None:
    if os.name != "posix" or not path.exists():
        return None
    mode = stat.S_IMODE(path.stat().st_mode)
    if mode & 0o077:
        return _result("warn", f"{path.name}: izinler genis ({oct(mode)}), onerilen 0o600")
    return _result("ok", f"{path.name}: izinler guvenli ({oct(mode)})")


def _maybe_fix_permissions(path: Path) -> CheckResult | None:
    if os.name != "posix" or not path.exists():
        return None
    try:
        os.chmod(path, 0o600)
        mode = stat.S_IMODE(path.stat().st_mode)
        return _result("ok", f"{path.name}: izinler 0o600 olarak ayarlandi ({oct(mode)})")
    except OSError as exc:
        return _result("warn", f"{path.name}: izin guncelleme basarisiz ({exc})")


def run_checks(service: str, fix_perms: bool) -> list[CheckResult]:
    env_map = _load_env()
    results: list[CheckResult] = [
        _check_dir_writable(PROJECT_ROOT, "Proje dizini"),
        _check_file(PROJECT_ROOT / "requirements.txt"),
    ]

    if service == "cookie-refresh":
        results.extend(
            [
                _check_file(PROJECT_ROOT / "cookie_auto_refresh.py"),
                _check_file(PROJECT_ROOT / "sahibinden_bot.py"),
                _check_file(PROJECT_ROOT / "bulk_scraper.py"),
                _check_module("curl_cffi"),
                _check_module("seleniumbase"),
                _check_module("google.cloud.storage"),
                _check_env(env_map, "GCS_COOKIE_BUCKET"),
                _check_any_binary(
                    ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"],
                    "Chrome/Chromium",
                ),
                _check_module("DrissionPage", fatal=False),
                _check_any_binary(["warp-cli"], "WARP CLI", fatal=False),
            ]
        )
    elif service == "gcs-cookie-pull":
        results.extend(
            [
                _check_file(PROJECT_ROOT / "gcs_cookie_bridge.py"),
                _check_module("google.cloud.storage"),
                _check_env(env_map, "GCS_COOKIE_BUCKET"),
            ]
        )
    elif service == "telegram-cookie-pull":
        results.extend(
            [
                _check_file(PROJECT_ROOT / "telegram_cookie_bridge.py"),
                _check_module("requests"),
                _check_env(env_map, "TELEGRAM_BOT_TOKEN"),
                _check_env(env_map, "TELEGRAM_CHAT_ID"),
            ]
        )
    elif service == "api-server":
        results.extend(
            [
                _check_file(PROJECT_ROOT / "backend" / "api_server.py"),
                _check_file(PROJECT_ROOT / "frontend" / "index.html"),
                _check_file(PROJECT_ROOT / "bulk_scraper.py"),
            ]
        )
    else:
        raise ValueError(f"Bilinmeyen servis: {service}")

    for path in (ENV_PATH, PROJECT_ROOT / "curl_request.sh", PROJECT_ROOT / ".telegram_offset"):
        result = _maybe_fix_permissions(path) if fix_perms else _check_permissions(path)
        if result:
            results.append(result)

    return results


def main() -> None:
    parser = argparse.ArgumentParser(description="Linux sunucu servis onkontrolu")
    parser.add_argument(
        "--service",
        required=True,
        choices=("cookie-refresh", "gcs-cookie-pull", "telegram-cookie-pull", "api-server"),
    )
    parser.add_argument("--fix-perms", action="store_true", help="Hassas dosya izinlerini 0o600 yapmaya calisir")
    args = parser.parse_args()

    exit_code = 0
    for item in run_checks(service=args.service, fix_perms=args.fix_perms):
        print(f"[{item.level.upper()}] {item.message}")
        if item.level == "fail":
            exit_code = 1

    print(f"[{'OK' if exit_code == 0 else 'FAIL'}] Preflight tamamlandi: {args.service}")
    raise SystemExit(exit_code)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n[WARN] Iptal edildi.")
        raise SystemExit(130)
