# Dark Period Scheduler

Plans in-house crystal work during a beam dark period. Crystals are set up, grown and mounted at home, shipped to an external synchrotron for data collection, then shipped back and the mounts cleaned for reuse. The scheduler shows when each batch is in each phase, where batches queue (for example, waiting for the weekly pallet), and how downtime at either site delays them.

## Features

- **Configurable stages**: name, min/typical/max duration, colour and facility, plus how the stage behaves on non-working days:
  - *Working days only*: pauses over weekends, holidays and downtime (bench work).
  - *Runs through weekends*: continuous (crystal growth, transit), with optional "must start/finish on a working day" (courier pickup and delivery).
  - *Needs unbroken uptime*: needs one uninterrupted block, otherwise waits for the next window (beamtime that can't straddle a shutdown).
- **Scheduled slots**: a stage can start only on set weekdays, every N weeks, with an optional capacity. Examples are a weekly pallet holding at most N batches, or allocated beamtime days. Batches that miss a slot, or find it full, queue for the next one.
- **Facilities**: each has its own operating days and downtime (bank holidays, site closures, external shutdowns).
- **Three scenarios**: optimistic, typical and pessimistic use each stage's min, typical and max durations. The timeline shows the range of finish dates.
- **Views**: Gantt timeline, shipment manifests per slot, a weekly workload heatmap, and summary stats (turnaround, queue days, peak batches in flight).
- Plans autosave to SQLite. You can create, duplicate and delete plans.

## Running

Requires [uv](https://docs.astral.sh/uv/) and Node 20+.

```bash
make install
make backend     # terminal 1: API on http://localhost:8000
make frontend    # terminal 2: UI on http://localhost:5173
```

Or run a single process with `make serve`, which builds the UI and serves everything on http://localhost:8000.

Plans are stored in `backend/data/plans.db`. Set `DPS_DB_PATH` to use a different file.
