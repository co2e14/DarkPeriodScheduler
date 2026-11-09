"""Seed plan used for new plans and for the first run of the app."""

from __future__ import annotations

from datetime import date, timedelta

from .models import Batch, CalendarConfig, DarkPeriod, DayMode, Facility, PlanConfig, SlotRule, Stage

THURSDAY = 3
DEFAULT_PUCKS_PER_BATCH = 7  # placeholder: one full dewar
HOME = "home"
EXTERNAL = "external"


def default_facilities() -> list[Facility]:
    return [
        Facility(id=HOME, name="Home lab", calendar=CalendarConfig(working_weekdays=[0, 1, 2, 3, 4])),
        # Synchrotrons run around the clock; add shutdowns / machine days as downtime.
        Facility(id=EXTERNAL, name="External synchrotron",
                 calendar=CalendarConfig(working_weekdays=[0, 1, 2, 3, 4, 5, 6])),
    ]


def default_stages() -> list[Stage]:
    return [
        Stage(id="setup", name="Experiment setup", color="#4c6ef5", per_batch=True,
              min_days=4, typical_days=4, max_days=4, day_mode=DayMode.working),
        Stage(id="growth", name="Crystal growth", color="#12b886", per_batch=True,
              min_days=2, typical_days=7, max_days=14, day_mode=DayMode.calendar),
        Stage(id="mounting", name="Harvest & mount", color="#fab005", per_batch=True, uses_pucks=True,
              min_days=3, typical_days=3, max_days=3, day_mode=DayMode.working),
        Stage(id="ship-out", name="Ship to external synchrotron", color="#fd7e14", uses_pucks=True,
              min_days=3, typical_days=4, max_days=5, day_mode=DayMode.calendar,
              start_on_working_day=True, finish_on_working_day=True,
              slots=SlotRule(weekdays=[THURSDAY], every_n_weeks=1,
                             max_dewars=9, pucks_per_dewar=7, share_dewars=True)),
        Stage(id="collection", name="Data collection", color="#e64980", facility_id=EXTERNAL,
              uses_pucks=True,
              min_days=4, typical_days=4, max_days=4, day_mode=DayMode.uninterrupted),
        Stage(id="ship-back", name="Ship back home", color="#be4bdb", uses_pucks=True,
              min_days=3, typical_days=4, max_days=5, day_mode=DayMode.calendar,
              start_on_working_day=True, finish_on_working_day=True),
        Stage(id="cleaning", name="Clean & recycle mounts", color="#15aabf",
              per_batch=True, uses_pucks=True, min_days=2, typical_days=2, max_days=2, day_mode=DayMode.working),
    ]


def default_plan(today: date | None = None, batch_count: int = 8) -> PlanConfig:
    today = today or date.today()
    next_monday = today + timedelta(days=(7 - today.weekday()) % 7 or 7)
    return PlanConfig(
        name="Dark period plan",
        dark_period=DarkPeriod(start=next_monday, end=next_monday + timedelta(weeks=26) - timedelta(days=1)),
        facilities=default_facilities(),
        stages=default_stages(),
        batches=[
            Batch(id=f"batch-{i + 1}", name=f"Batch {i + 1}",
                  start_date=next_monday + timedelta(weeks=i), pucks=DEFAULT_PUCKS_PER_BATCH)
            for i in range(batch_count)
        ],
    )
