"""SQLite persistence. Each plan is stored as one JSON document."""

from __future__ import annotations

import sqlite3
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

from .models import PlanConfig, PlanRecord, PlanSummary

SCHEMA = """
CREATE TABLE IF NOT EXISTS plans (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    config TEXT NOT NULL,
    updated_at TEXT NOT NULL
)
"""


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


class PlanStore:
    def __init__(self, db_path: str | Path):
        self.db_path = str(db_path)
        if self.db_path != ":memory:":
            Path(self.db_path).parent.mkdir(parents=True, exist_ok=True)
        with self._conn() as c:
            c.execute(SCHEMA)

    @contextmanager
    def _conn(self):
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        try:
            yield conn
            conn.commit()
        finally:
            conn.close()

    def list(self) -> list[PlanSummary]:
        with self._conn() as c:
            rows = c.execute("SELECT id, name, updated_at FROM plans ORDER BY updated_at DESC").fetchall()
        return [PlanSummary(**dict(r)) for r in rows]

    def get(self, plan_id: str) -> PlanRecord | None:
        with self._conn() as c:
            row = c.execute("SELECT * FROM plans WHERE id = ?", (plan_id,)).fetchone()
        if row is None:
            return None
        return PlanRecord(
            id=row["id"],
            name=row["name"],
            updated_at=row["updated_at"],
            config=PlanConfig.model_validate_json(row["config"]),
        )

    def create(self, config: PlanConfig) -> PlanRecord:
        plan_id = uuid.uuid4().hex[:12]
        now = _now()
        with self._conn() as c:
            c.execute(
                "INSERT INTO plans (id, name, config, updated_at) VALUES (?, ?, ?, ?)",
                (plan_id, config.name, config.model_dump_json(), now),
            )
        return PlanRecord(id=plan_id, name=config.name, updated_at=now, config=config)

    def update(self, plan_id: str, config: PlanConfig) -> PlanRecord | None:
        now = _now()
        with self._conn() as c:
            cur = c.execute(
                "UPDATE plans SET name = ?, config = ?, updated_at = ? WHERE id = ?",
                (config.name, config.model_dump_json(), now, plan_id),
            )
            if cur.rowcount == 0:
                return None
        return PlanRecord(id=plan_id, name=config.name, updated_at=now, config=config)

    def delete(self, plan_id: str) -> bool:
        with self._conn() as c:
            cur = c.execute("DELETE FROM plans WHERE id = ?", (plan_id,))
            return cur.rowcount > 0
