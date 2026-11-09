# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

This tool schedules in-house crystal preparation during a synchrotron beam dark period. Each **batch** is a number of pucks that flows through an ordered list of **stages**: setup → growth → mount → ship out → data collection at an external synchrotron → ship back → clean mounts. Each stage is timed against the calendar of the **facility** it belongs to.

An **external delivery** is a batch with `entry_stage_id` set. It holds pucks prepared elsewhere, skips every stage before that one, and is ready for it on `start_date`.

The UI shows the resulting timeline across three duration scenarios. It also shows puck demand: the purpose is to tell the user whether to buy more pucks and sample mounts.

## Commands

All commands run from the repo root through the Makefile. Python is managed by `uv` (3.12), so don't use the system `python3`, which is 3.9.

- `make install`: runs `uv sync` in `backend/` and `npm install` in `frontend/`.
- `make backend`: starts uvicorn on :8000 with reload.
- `make frontend`: starts Vite on :5173 and proxies `/api` to :8000.
- `make test`: backend pytest suite.
- Single test: `cd backend && uv run pytest tests/test_engine.py::test_pallet_capacity_overflow_rolls_to_next_slot`.
- `make typecheck` / `make build`: the frontend `tsc -b`, and the production build. `make build` also runs `tsc`.
- `make serve`: builds the UI and runs one process. When `frontend/dist` exists, FastAPI serves it at `/`.
- For an isolated UI check that leaves the user's data alone:
  1. Run uvicorn with `DPS_DB_PATH=<copy of plans.db>` on another port.
  2. Run Vite with `API_URL=http://127.0.0.1:<that port>`. `vite.config.ts` reads `API_URL` for the `/api` proxy target.

There is no frontend test suite or linter yet. The checks are `tsc` and a manual or browser check.

## Architecture

**Backend (`backend/app/`, FastAPI and Pydantic v2)**
- `models.py` is the single source of truth for the data model: `PlanConfig` → `facilities`, `stages`, `batches`, `dark_period`, plus the result types. `frontend/src/types.ts` mirrors it by hand. When you change one, change the other.
- `engine.py` is pure scheduling logic with no FastAPI imports. `compute_schedule(plan)` runs `simulate()` once per scenario: optimistic uses each stage's `min_days`, typical uses `typical_days`, pessimistic uses `max_days`.
  - `simulate()` is a **discrete-event loop**. A heap holds `(ready_date, batch_priority, batch_idx, stage_idx)`. Popping an event places that stage and pushes the next stage's ready event at the stage's end date. Shared capacity (`SlotBook` for slot rules) is therefore allocated first come, first served by ready date. New shared resources, such as a mount/dewar pool or staff limits, should go into this loop, not into a per-batch or per-stage pass.
  - `WorkCalendar` is built per facility: working weekdays minus closures (downtime). Each stage uses its own facility's calendar.
  - `DayMode` sets the semantics. `working` counts only working days and pauses through downtime. `calendar` runs continuously, with optional `start_on_working_day` / `finish_on_working_day`. `uninterrupted` needs an unbroken block of working days, otherwise the start is delayed. Slot dates where the stage can't start, such as a closure or an overlapping shutdown, are skipped.
  - Durations come from `Batch.duration(stage, scenario)`. A per-batch override in `batch.durations[stage_id]` applies only when `stage.per_batch` is set. Overrides for unknown stage ids are ignored rather than rejected.
  - Slot capacity is measured in **dewars**: `SlotRule.max_dewars` × `pucks_per_dewar`. `share_dewars` decides whether two batches may share one dewar (`dewars_needed()`). A batch is never split across slots. A batch too big for any slot fails fast in `_check_batches_fit_slots`, before the loop, so the slot search doesn't run to the horizon.
  - Puck demand is reported, never enforced. A batch's pucks are in use from the start of its first `uses_pucks` stage to the end of its last one, including queue time. `_peak()` sweeps these intervals to find the peak. Sample mounts = pucks × `inventory.positions_per_puck`, an upper bound. An `inventory` shortfall produces warnings.
  - Every loop is bounded by `HORIZON_DAYS`. An unsatisfiable config raises `ScheduleError`, which the API returns as HTTP 422.
- `storage.py` keeps each plan as a single JSON document in SQLite (`backend/data/plans.db`, or `DPS_DB_PATH`). There are no migrations: a change to `PlanConfig` that is not backwards compatible breaks existing stored plans, so add defaults to new fields.

  The user keeps real plans in this database. When a change needs stored data upgraded, follow these steps:
  1. Back the database up.
  2. Upgrade the JSON in place.
  3. Validate the result with `PlanConfig` and run `compute_schedule`.
  4. Tell the user to hard-refresh, so an open tab doesn't autosave the old-shaped config back over the upgrade.
- `main.py` uses `create_app(db_path)` as an app factory, and tests use it with a temp DB. `/api/schedule` is stateless: it takes a `PlanConfig` and returns all three scenarios. On first start, the app seeds the default plan from `defaults.py`.

**Date conventions (backend and frontend)**
- Dates are ISO `YYYY-MM-DD` strings on the wire and in the UI.
- Segments are half-open `[start, end)`. `end` is the day after the stage finishes, which is also the next stage's `ready`. For display, use `lastDay(end)`.
- A gap between `ready` and `start` is queue time, drawn hatched on the Gantt.
- The frontend does date arithmetic only through `src/lib/dates.ts`, which uses dayjs in UTC. Don't use `new Date('YYYY-MM-DD')`.

**Frontend (`frontend/src/`, React 19, Vite 7, Mantine 8)**
- `App.tsx` owns the state. The edited plan is a `Doc {id, config, dirty}`, debounced by 400 ms. One effect POSTs `/api/schedule` (latest request wins, via a sequence ref). Another autosaves dirty docs with PUT. `id` travels with the config so that a save can't land on a different plan after the user switches plans.
- Editors receive `update(updater)` (`PlanUpdate`) and must keep the config valid on the client. For example, `StagesEditor.setDuration` clamps to min ≤ typical ≤ max, and `WeekdayPicker` never allows an empty selection. This matters because the backend rejects invalid plans.
- `components/Timeline.tsx` is a hand-built Gantt using absolutely positioned divs. There is no Gantt library.
- Mantine 8 date inputs take and return `YYYY-MM-DD` strings, not `Date` objects. Versions are pinned in `package.json`. Mantine 9, Vite 8 and TypeScript 7 exist, but the code targets the pinned majors.
