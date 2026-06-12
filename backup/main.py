import os
import subprocess
from datetime import datetime
from pathlib import Path

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.interval import IntervalTrigger
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse

# ── config ────────────────────────────────────────────────────────────────────
PG_HOST     = os.getenv("POSTGRES_HOST", "postgis")
PG_PORT     = os.getenv("POSTGRES_PORT", "5432")
PG_USER     = os.getenv("POSTGRES_USER", "postgres")
PG_PASSWORD = os.getenv("POSTGRES_PASSWORD", "rub1234")
PG_DB       = os.getenv("POSTGRES_DB", "rub2")
BACKUP_DIR  = Path(os.getenv("BACKUP_DIR", "/backups"))
INTERVAL_H  = float(os.getenv("BACKUP_INTERVAL_HOURS", "24"))
KEEP_DAYS   = int(os.getenv("BACKUP_KEEP_DAYS", "7"))
# ─────────────────────────────────────────────────────────────────────────────

app = FastAPI(
    title="DB Backup Service",
    description="Scheduled PostgreSQL backups for rub2",
    version="1.0.0",
)

scheduler = AsyncIOScheduler()

_last_backup: dict = {"file": None, "time": None, "status": None, "error": None}


# ── core backup logic ─────────────────────────────────────────────────────────

def _do_backup() -> Path:
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    out = BACKUP_DIR / f"{PG_DB}_{ts}.sql"

    env = {**os.environ, "PGPASSWORD": PG_PASSWORD}
    result = subprocess.run(
        [
            "pg_dump",
            "-h", PG_HOST,
            "-p", PG_PORT,
            "-U", PG_USER,
            "--clean",
            "--if-exists",
            "--create",
            "--encoding", "UTF8",
            PG_DB,
        ],
        capture_output=True,
        text=True,
        encoding="utf-8",
        env=env,
    )

    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip())

    out.write_text(result.stdout, encoding="utf-8")
    return out


def _purge_old() -> int:
    cutoff = datetime.now().timestamp() - KEEP_DAYS * 86400
    removed = 0
    for f in BACKUP_DIR.glob(f"{PG_DB}_*.sql"):
        if f.stat().st_mtime < cutoff:
            f.unlink()
            removed += 1
    return removed


def scheduled_backup() -> None:
    global _last_backup
    try:
        out = _do_backup()
        removed = _purge_old()
        _last_backup = {
            "file": out.name,
            "time": datetime.now().isoformat(),
            "status": "ok",
            "error": None,
            "purged": removed,
        }
        print(f"[OK] {out.name}  |  purged {removed} old backup(s)")
    except Exception as exc:
        _last_backup = {
            "file": None,
            "time": datetime.now().isoformat(),
            "status": "error",
            "error": str(exc),
        }
        print(f"[ERROR] backup failed: {exc}")


# ── lifecycle ─────────────────────────────────────────────────────────────────

@app.on_event("startup")
async def startup() -> None:
    scheduler.add_job(
        scheduled_backup,
        trigger=IntervalTrigger(hours=INTERVAL_H),
        id="auto_backup",
        next_run_time=datetime.now(),   # run immediately on startup
    )
    scheduler.start()
    print(f"[INFO] Scheduler started — interval={INTERVAL_H}h  keep={KEEP_DAYS}d")


@app.on_event("shutdown")
async def shutdown() -> None:
    scheduler.shutdown(wait=False)


# ── endpoints ─────────────────────────────────────────────────────────────────

@app.get("/health", tags=["system"])
def health():
    return {"status": "ok"}


@app.get("/status", tags=["backup"])
def status():
    job = scheduler.get_job("auto_backup")
    return {
        "last_backup": _last_backup,
        "next_scheduled": job.next_run_time.isoformat() if job else None,
        "interval_hours": INTERVAL_H,
        "keep_days": KEEP_DAYS,
    }


@app.post("/backup", tags=["backup"])
def trigger_backup():
    try:
        out = _do_backup()
        removed = _purge_old()
        info = {
            "file": out.name,
            "size_kb": out.stat().st_size // 1024,
            "time": datetime.now().isoformat(),
            "purged": removed,
        }
        _last_backup.update({"file": out.name, "time": info["time"], "status": "ok", "error": None})
        return info
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@app.get("/backups", tags=["backup"])
def list_backups():
    files = sorted(BACKUP_DIR.glob(f"{PG_DB}_*.sql"), reverse=True)
    return [
        {
            "file": f.name,
            "size_kb": f.stat().st_size // 1024,
            "created": datetime.fromtimestamp(f.stat().st_mtime).isoformat(),
        }
        for f in files
    ]


@app.get("/backups/{filename}", tags=["backup"])
def download_backup(filename: str):
    path = BACKUP_DIR / filename
    if not path.exists() or not path.is_file():
        raise HTTPException(status_code=404, detail="File not found")
    # prevent path traversal
    if path.parent.resolve() != BACKUP_DIR.resolve():
        raise HTTPException(status_code=400, detail="Invalid path")
    return FileResponse(path, media_type="text/plain", filename=filename)


@app.delete("/backups/{filename}", tags=["backup"])
def delete_backup(filename: str):
    path = BACKUP_DIR / filename
    if not path.exists():
        raise HTTPException(status_code=404, detail="File not found")
    if path.parent.resolve() != BACKUP_DIR.resolve():
        raise HTTPException(status_code=400, detail="Invalid path")
    path.unlink()
    return {"deleted": filename}
