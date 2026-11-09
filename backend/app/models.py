"""Pydantic models shared by the scheduling engine, storage layer and API.

All dates are plain calendar dates (ISO ``YYYY-MM-DD`` on the wire). Stage
segments use a half-open interval ``[start, end)``: ``end`` is the first day
*after* the stage finishes, which is also the day the next stage becomes ready.
"""

from __future__ import annotations

from datetime import date
from enum import Enum
from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator

Scenario = Literal["optimistic", "typical", "pessimistic"]
SCENARIOS: tuple[Scenario, ...] = ("optimistic", "typical", "pessimistic")


def _clean_weekdays(v: list[int]) -> list[int]:
    if not v:
        raise ValueError("at least one weekday is required")
    if any(d < 0 or d > 6 for d in v):
        raise ValueError("weekdays must be 0 (Mon) .. 6 (Sun)")
    return sorted(set(v))


class DayMode(str, Enum):
    # Only progresses on the facility's working days; pauses over weekends/downtime.
    working = "working"
    # Runs continuously, weekends and downtime included (crystal growth, couriers in transit).
    calendar = "calendar"
    # Needs one unbroken block of facility uptime (e.g. beamtime): if the block would
    # overlap a non-working day or downtime, the start waits for the next window that fits.
    uninterrupted = "uninterrupted"


class SlotRule(BaseModel):
    """Restricts a stage to start only on scheduled dates (e.g. a weekly pallet).

    Capacity is measured in dewars: each slot carries at most ``max_dewars`` dewars
    of ``pucks_per_dewar`` pucks. A batch is never split across two slots.
    """

    weekdays: list[int] = Field(default_factory=lambda: [3], description="0=Mon .. 6=Sun")
    every_n_weeks: int = Field(1, ge=1, le=52)
    anchor_date: date | None = Field(
        None, description="A week in which a slot occurs; only matters when every_n_weeks > 1"
    )
    max_dewars: int | None = Field(None, ge=1, description="Dewars per slot; None = unlimited")
    pucks_per_dewar: int = Field(7, ge=1)
    share_dewars: bool = Field(
        True, description="Pucks from different batches may travel in the same dewar"
    )

    def dewars_needed(self, pucks: list[int]) -> int:
        if self.share_dewars:
            return -(-sum(pucks) // self.pucks_per_dewar)
        return sum(-(-p // self.pucks_per_dewar) for p in pucks)

    @field_validator("weekdays")
    @classmethod
    def _v_weekdays(cls, v: list[int]) -> list[int]:
        return _clean_weekdays(v)


class DurationRange(BaseModel):
    min_days: int = Field(ge=0)
    typical_days: int = Field(ge=0)
    max_days: int = Field(ge=0)

    @model_validator(mode="after")
    def _check_order(self) -> DurationRange:
        if not (self.min_days <= self.typical_days <= self.max_days):
            raise ValueError("durations must satisfy min <= typical <= max")
        return self

    def pick(self, scenario: Scenario) -> int:
        return {
            "optimistic": self.min_days,
            "typical": self.typical_days,
            "pessimistic": self.max_days,
        }[scenario]


class Stage(BaseModel):
    id: str = Field(min_length=1)
    name: str
    color: str = "#228be6"
    min_days: int = Field(ge=0)
    typical_days: int = Field(ge=0)
    max_days: int = Field(ge=0)
    per_batch: bool = False  # batches may override this stage's duration range
    uses_pucks: bool = False  # the batch's pucks are tied up during this stage
    facility_id: str = "home"
    day_mode: DayMode = DayMode.working
    start_on_working_day: bool = False  # calendar mode only (working mode implies it)
    finish_on_working_day: bool = False  # calendar mode only, e.g. couriers don't deliver at weekends
    slots: SlotRule | None = None

    @model_validator(mode="after")
    def _check_durations(self) -> Stage:
        if not (self.min_days <= self.typical_days <= self.max_days):
            raise ValueError(
                f"stage '{self.name}': durations must satisfy min <= typical <= max"
            )
        return self

    @property
    def default_range(self) -> DurationRange:
        return DurationRange(
            min_days=self.min_days, typical_days=self.typical_days, max_days=self.max_days
        )


class Batch(BaseModel):
    """A set of pucks flowing through the stages.

    In-house batches start at the first stage on ``start_date``. External deliveries
    (pucks prepared elsewhere) set ``entry_stage_id``: they skip every earlier stage and
    are ready for that stage on ``start_date``.
    """

    id: str = Field(min_length=1)
    name: str
    start_date: date
    pucks: int = Field(7, ge=0)
    entry_stage_id: str | None = None
    # Per-batch duration overrides keyed by stage id. Only honoured for stages with
    # per_batch=True; ids of deleted stages are ignored rather than rejected.
    durations: dict[str, DurationRange] = Field(default_factory=dict)
    notes: str = ""

    def duration(self, stage: Stage, scenario: Scenario) -> int:
        override = self.durations.get(stage.id) if stage.per_batch else None
        return (override or stage.default_range).pick(scenario)


class Closure(BaseModel):
    """Facility downtime: bank holidays, shutdowns, machine development. Inclusive range."""

    start: date
    end: date
    label: str = ""

    @model_validator(mode="after")
    def _check_range(self) -> Closure:
        if self.end < self.start:
            raise ValueError("closure end must be on or after start")
        return self


class CalendarConfig(BaseModel):
    """When a facility is up: its working weekdays minus any downtime periods."""

    working_weekdays: list[int] = Field(default_factory=lambda: [0, 1, 2, 3, 4])
    closures: list[Closure] = Field(default_factory=list)

    @field_validator("working_weekdays")
    @classmethod
    def _v_weekdays(cls, v: list[int]) -> list[int]:
        return _clean_weekdays(v)


class Facility(BaseModel):
    """A site with its own calendar: the home lab, an external synchrotron, ..."""

    id: str = Field(min_length=1)
    name: str
    calendar: CalendarConfig = Field(default_factory=CalendarConfig)


class DarkPeriod(BaseModel):
    start: date
    end: date

    @model_validator(mode="after")
    def _check_range(self) -> DarkPeriod:
        if self.end < self.start:
            raise ValueError("dark period end must be on or after start")
        return self


class Inventory(BaseModel):
    """Equipment owned, used to flag shortfalls. Demand is reported, never enforced."""

    pucks_owned: int | None = Field(None, ge=0)
    positions_per_puck: int = Field(16, ge=1)  # Unipuck = 16 sample positions
    sample_mounts_owned: int | None = Field(None, ge=0)


class PlanConfig(BaseModel):
    name: str = "Untitled plan"
    dark_period: DarkPeriod | None = None
    inventory: Inventory = Field(default_factory=Inventory)
    facilities: list[Facility] = Field(min_length=1)
    stages: list[Stage] = Field(min_length=1)
    batches: list[Batch] = Field(default_factory=list)
    # Endpoints of the harvest-to-data lead time: start of the first stage to end of the
    # second. Unknown ids (e.g. a deleted stage) disable the metric rather than fail.
    harvest_stage_id: str | None = "mounting"
    data_stage_id: str | None = "collection"

    @model_validator(mode="after")
    def _unique_ids(self) -> PlanConfig:
        for label, items in (
            ("facility", self.facilities),
            ("stage", self.stages),
            ("batch", self.batches),
        ):
            ids = [i.id for i in items]
            if len(ids) != len(set(ids)):
                raise ValueError(f"{label} ids must be unique")
        known = {f.id for f in self.facilities}
        for st in self.stages:
            if st.facility_id not in known:
                raise ValueError(f"stage '{st.name}' refers to unknown facility '{st.facility_id}'")
        stage_ids = {st.id for st in self.stages}
        for b in self.batches:
            if b.entry_stage_id is not None and b.entry_stage_id not in stage_ids:
                raise ValueError(f"'{b.name}' joins at unknown stage '{b.entry_stage_id}'")
        return self


# ---------------------------------------------------------------- results


class Segment(BaseModel):
    stage_id: str
    ready: date  # when the batch became eligible for this stage
    start: date  # >= ready; the gap is time queued (e.g. waiting for the pallet)
    end: date  # exclusive
    duration_days: int  # configured duration (working or calendar days per day_mode)
    queue_days: int


class BatchSchedule(BaseModel):
    batch_id: str
    start: date
    end: date  # exclusive
    turnaround_days: int
    # Start of the harvest stage to end of the data stage, queueing included. None when
    # the batch skips the harvest stage (external delivery) or the stages aren't set.
    harvest_to_data_days: int | None = None
    pucks: int
    # Window in which the batch's pucks are in use: start of the first uses_pucks
    # stage to the end of the last one, including any queueing in between.
    pucks_out: date | None
    pucks_back: date | None  # exclusive
    segments: list[Segment]


class Departure(BaseModel):
    """One occupied slot of a slot-constrained stage (e.g. one pallet shipment)."""

    stage_id: str
    date: date
    batch_ids: list[str]
    pucks: int
    dewars: int
    max_dewars: int | None


class ScenarioSummary(BaseModel):
    batch_count: int
    first_start: date | None
    last_end: date | None
    mean_turnaround_days: float | None
    max_turnaround_days: int | None
    mean_harvest_to_data_days: float | None = None
    max_harvest_to_data_days: int | None = None
    total_queue_days: int
    peak_in_progress: int
    peak_pucks_in_use: int
    peak_pucks_date: date | None
    peak_sample_mounts: int  # upper bound: assumes every puck is full
    batches_ending_after_dark_period: int


class ScenarioResult(BaseModel):
    batches: list[BatchSchedule]
    departures: list[Departure]
    summary: ScenarioSummary
    warnings: list[str]


class ScheduleResult(BaseModel):
    scenarios: dict[Scenario, ScenarioResult]


class PlanSummary(BaseModel):
    id: str
    name: str
    updated_at: str


class PlanRecord(PlanSummary):
    config: PlanConfig
