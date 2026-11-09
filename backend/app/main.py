"""FastAPI app: plan CRUD + stateless schedule computation.

Run (from backend/):  uv run uvicorn app.main:app --reload
"""

from __future__ import annotations

import os
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles

from .defaults import default_plan
from .engine import ScheduleError, compute_schedule
from .models import PlanConfig, PlanRecord, PlanSummary, ScheduleResult
from .storage import PlanStore

BACKEND_DIR = Path(__file__).resolve().parent.parent
DEFAULT_DB = BACKEND_DIR / "data" / "plans.db"
FRONTEND_DIST = BACKEND_DIR.parent / "frontend" / "dist"


def create_app(db_path: str | Path | None = None) -> FastAPI:
    store = PlanStore(db_path or os.environ.get("DPS_DB_PATH", DEFAULT_DB))
    if not store.list():
        store.create(default_plan())

    app = FastAPI(title="Dark Period Scheduler", version="0.1.0")

    @app.get("/api/health")
    def health() -> dict:
        return {"status": "ok"}

    @app.get("/api/defaults", response_model=PlanConfig)
    def defaults() -> PlanConfig:
        return default_plan()

    @app.get("/api/plans", response_model=list[PlanSummary])
    def list_plans() -> list[PlanSummary]:
        return store.list()

    @app.post("/api/plans", response_model=PlanRecord, status_code=201)
    def create_plan(config: PlanConfig | None = None) -> PlanRecord:
        return store.create(config or default_plan())

    @app.get("/api/plans/{plan_id}", response_model=PlanRecord)
    def get_plan(plan_id: str) -> PlanRecord:
        record = store.get(plan_id)
        if record is None:
            raise HTTPException(404, "plan not found")
        return record

    @app.put("/api/plans/{plan_id}", response_model=PlanRecord)
    def update_plan(plan_id: str, config: PlanConfig) -> PlanRecord:
        record = store.update(plan_id, config)
        if record is None:
            raise HTTPException(404, "plan not found")
        return record

    @app.delete("/api/plans/{plan_id}", status_code=204)
    def delete_plan(plan_id: str) -> None:
        if not store.delete(plan_id):
            raise HTTPException(404, "plan not found")

    @app.post("/api/schedule", response_model=ScheduleResult)
    def schedule(config: PlanConfig) -> ScheduleResult:
        try:
            return compute_schedule(config)
        except ScheduleError as e:
            raise HTTPException(422, str(e)) from e

    # Serve the built frontend (npm run build) when present, so one process can host everything.
    if FRONTEND_DIST.is_dir():
        app.mount("/", StaticFiles(directory=FRONTEND_DIST, html=True), name="frontend")

    return app


app = create_app()
