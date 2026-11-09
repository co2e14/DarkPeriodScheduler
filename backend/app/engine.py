"""Scheduling engine: pure functions over ``PlanConfig`` -> ``ScheduleResult``.

The engine is a small discrete-event simulation. Every batch flows through the
plan's stages in order. Events are ``(ready_date, batch_priority, batch, stage)``
tuples on a priority queue; popping one places that batch's stage on the
calendar and pushes a ready event for the next stage at the stage's end date.

Processing in ready-date order is what makes shared constraints correct:
slot capacity (e.g. a pallet that holds 9 dewars of 7 pucks) is handed out
first come, first served, and a batch is never split across two slots. Future shared resources (a finite pool of sample mounts that
only return after cleaning, staff capacity per stage, ...) slot into the same
loop: a stage that can't acquire its resource re-queues its event at the date
the resource frees up.

Each stage belongs to a facility (home lab, external synchrotron, ...) and is
timed against that facility's calendar (working weekdays minus downtime).

Date conventions: segments are half-open ``[start, end)``. A stage of N
working days starting on a working day ``s`` ends the day after the N-th
working day counted from ``s`` inclusive.
"""

from __future__ import annotations

import heapq
from collections import defaultdict
from collections.abc import Callable
from datetime import date, timedelta

from .models import (
    SCENARIOS,
    BatchSchedule,
    CalendarConfig,
    DayMode,
    Departure,
    PlanConfig,
    Scenario,
    ScenarioResult,
    ScenarioSummary,
    ScheduleResult,
    Segment,
    SlotRule,
    Stage,
)

ONE_DAY = timedelta(days=1)
HORIZON_DAYS = 5 * 366  # guard against configs that can never be satisfied


class ScheduleError(ValueError):
    """The plan cannot be scheduled (e.g. a slot rule that never matches)."""


class WorkCalendar:
    def __init__(self, cfg: CalendarConfig):
        self.working_weekdays = frozenset(cfg.working_weekdays)
        self.closed: set[date] = set()
        for c in cfg.closures:
            d = c.start
            while d <= c.end:
                self.closed.add(d)
                d += ONE_DAY

    def is_working(self, d: date) -> bool:
        return d.weekday() in self.working_weekdays and d not in self.closed

    def next_working(self, d: date) -> date:
        """``d`` itself if it is a working day, else the next one."""
        for _ in range(HORIZON_DAYS):
            if self.is_working(d):
                return d
            d += ONE_DAY
        raise ScheduleError(f"no working day within {HORIZON_DAYS} days of {d}")

    def add_working_days(self, start: date, n: int) -> date:
        """Exclusive end of an ``n``-working-day stage beginning on ``start``."""
        if n == 0:
            return start
        d, counted = start, 0
        for _ in range(HORIZON_DAYS + n * 7):
            if self.is_working(d):
                counted += 1
                if counted == n:
                    return d + ONE_DAY
            d += ONE_DAY
        raise ScheduleError(f"could not fit {n} working days after {start}")

    def is_unbroken(self, start: date, n: int) -> bool:
        """True if ``start`` and the following days of an ``n``-day block are all working days."""
        return all(self.is_working(start + timedelta(days=i)) for i in range(max(n, 1)))


def _week_index(d: date) -> int:
    monday = d - timedelta(days=d.weekday())
    return monday.toordinal() // 7


def _requires_working_start(stage: Stage) -> bool:
    return stage.day_mode != DayMode.calendar or stage.start_on_working_day


def _can_start(stage: Stage, cal: WorkCalendar, d: date, duration: int) -> bool:
    if stage.day_mode == DayMode.uninterrupted:
        return cal.is_unbroken(d, duration)
    return not _requires_working_start(stage) or cal.is_working(d)


class SlotBook:
    """Tracks bookings for a slot-constrained stage (e.g. weekly pallet shipments)."""

    def __init__(self, stage: Stage, rule: SlotRule, anchor: date, cal: WorkCalendar):
        self.stage = stage
        self.rule = rule
        self.anchor_week = _week_index(rule.anchor_date or anchor)
        self.cal = cal
        self.bookings: dict[date, list[tuple[str, int]]] = defaultdict(list)  # (batch id, pucks)
        self.bumped: set[str] = set()  # batches pushed to a later slot by capacity

    def is_slot(self, d: date) -> bool:
        if d.weekday() not in self.rule.weekdays:
            return False
        return (_week_index(d) - self.anchor_week) % self.rule.every_n_weeks == 0

    def fits(self, d: date, pucks: int) -> bool:
        if self.rule.max_dewars is None:
            return True
        loads = [p for _, p in self.bookings[d]] + [pucks]
        return self.rule.dewars_needed(loads) <= self.rule.max_dewars

    def book(self, ready: date, batch_id: str, pucks: int, duration: int) -> date:
        # Slots where the stage can't run are skipped: e.g. no courier collection on a
        # bank holiday, or allocated beamtime that would overlap a facility shutdown.
        d = ready
        for _ in range(HORIZON_DAYS):
            if self.is_slot(d) and _can_start(self.stage, self.cal, d, duration):
                if self.fits(d, pucks):
                    self.bookings[d].append((batch_id, pucks))
                    return d
                self.bumped.add(batch_id)
            d += ONE_DAY
        raise ScheduleError(
            f"stage '{self.stage.name}': no available slot within {HORIZON_DAYS} days of {ready}"
        )


def stage_end(stage: Stage, cal: WorkCalendar, start: date, duration: int) -> date:
    if stage.day_mode == DayMode.working:
        return cal.add_working_days(start, duration)
    if stage.day_mode == DayMode.uninterrupted:
        return start + timedelta(days=duration)
    end = start + timedelta(days=duration)
    if stage.finish_on_working_day and duration > 0:
        last = end - ONE_DAY
        if not cal.is_working(last):
            end = cal.next_working(last) + ONE_DAY
    return end


def unconstrained_start(stage: Stage, cal: WorkCalendar, ready: date, duration: int) -> date:
    return _first(ready, lambda d: _can_start(stage, cal, d, duration),
                  f"stage '{stage.name}': no start date")


def _first(d: date, ok: Callable[[date], bool], what: str) -> date:
    for _ in range(HORIZON_DAYS):
        if ok(d):
            return d
        d += ONE_DAY
    raise ScheduleError(f"{what} within {HORIZON_DAYS} days of the ready date")


def default_anchor(plan: PlanConfig) -> date:
    if plan.dark_period:
        return plan.dark_period.start
    if plan.batches:
        return min(b.start_date for b in plan.batches)
    return date.today()


def _check_batches_fit_slots(plan: PlanConfig) -> None:
    """Fail fast if a batch can never fit a slot (it would otherwise search to the horizon)."""
    for st in plan.stages:
        rule = st.slots
        if rule is None or rule.max_dewars is None:
            continue
        for b in plan.batches:
            need = rule.dewars_needed([b.pucks])
            if need > rule.max_dewars:
                raise ScheduleError(
                    f"'{b.name}' has {b.pucks} pucks, needing {need} dewars, but '{st.name}' "
                    f"carries at most {rule.max_dewars} dewars of {rule.pucks_per_dewar} pucks "
                    f"({rule.max_dewars * rule.pucks_per_dewar} pucks). Batches aren't split "
                    f"across shipments, so split it into smaller batches."
                )


def simulate(plan: PlanConfig, scenario: Scenario) -> ScenarioResult:
    _check_batches_fit_slots(plan)
    cals = {f.id: WorkCalendar(f.calendar) for f in plan.facilities}
    anchor = default_anchor(plan)
    stages = plan.stages
    books: dict[int, SlotBook] = {
        i: SlotBook(s, s.slots, anchor, cals[s.facility_id])
        for i, s in enumerate(stages)
        if s.slots
    }
    # Per stage: (batches, total days) waiting for an uninterrupted uptime window.
    uptime_waits: dict[int, list[int]] = defaultdict(lambda: [0, 0])

    # Earlier-starting batches win ties for shared capacity; input order breaks remaining ties.
    order = sorted(range(len(plan.batches)), key=lambda i: (plan.batches[i].start_date, i))
    priority = {b: rank for rank, b in enumerate(order)}
    stage_index = {st.id: i for i, st in enumerate(stages)}
    # External deliveries enter part-way through the pipeline.
    events: list[tuple[date, int, int, int]] = [
        (plan.batches[b].start_date, priority[b], b, stage_index.get(plan.batches[b].entry_stage_id, 0))
        for b in order
    ]
    heapq.heapify(events)
    segments: list[list[Segment]] = [[] for _ in plan.batches]

    while events:
        ready, prio, b, si = heapq.heappop(events)
        stage = stages[si]
        cal = cals[stage.facility_id]
        batch = plan.batches[b]
        duration = batch.duration(stage, scenario)
        if si in books:
            start = books[si].book(ready, batch.id, batch.pucks, duration)
        else:
            start = unconstrained_start(stage, cal, ready, duration)
            if stage.day_mode == DayMode.uninterrupted and start > ready:
                uptime_waits[si][0] += 1
                uptime_waits[si][1] += (start - ready).days
        end = stage_end(stage, cal, start, duration)
        segments[b].append(
            Segment(
                stage_id=stage.id,
                ready=ready,
                start=start,
                end=end,
                duration_days=duration,
                queue_days=(start - ready).days,
            )
        )
        if si + 1 < len(stages):
            heapq.heappush(events, (end, prio, b, si + 1))

    puck_stage_ids = {st.id for st in stages if st.uses_pucks}
    batches = []
    for batch, segs in zip(plan.batches, segments):
        puck_segs = [s for s in segs if s.stage_id in puck_stage_ids]
        by_stage = {s.stage_id: s for s in segs}
        harvest, data = by_stage.get(plan.harvest_stage_id), by_stage.get(plan.data_stage_id)
        harvest_to_data = (
            (data.end - harvest.start).days if harvest and data and data.end > harvest.start else None
        )
        batches.append(
            BatchSchedule(
                batch_id=batch.id,
                start=batch.start_date,
                end=segs[-1].end,
                turnaround_days=(segs[-1].end - batch.start_date).days,
                harvest_to_data_days=harvest_to_data,
                pucks=batch.pucks,
                pucks_out=puck_segs[0].start if puck_segs else None,
                pucks_back=puck_segs[-1].end if puck_segs else None,
                segments=segs,
            )
        )

    departures = [
        Departure(
            stage_id=book.stage.id,
            date=d,
            batch_ids=[bid for bid, _ in loads],
            pucks=sum(p for _, p in loads),
            dewars=book.rule.dewars_needed([p for _, p in loads]),
            max_dewars=book.rule.max_dewars,
        )
        for book in books.values()
        for d, loads in sorted(book.bookings.items())
        if loads
    ]

    summary = _summarise(plan, batches)
    return ScenarioResult(
        batches=batches,
        departures=departures,
        summary=summary,
        warnings=_warnings(plan, books, uptime_waits) + _inventory_warnings(plan, summary),
    )


def _summarise(plan: PlanConfig, batches: list[BatchSchedule]) -> ScenarioSummary:
    if not batches:
        return ScenarioSummary(
            batch_count=0,
            first_start=None,
            last_end=None,
            mean_turnaround_days=None,
            max_turnaround_days=None,
            total_queue_days=0,
            peak_in_progress=0,
            peak_pucks_in_use=0,
            peak_pucks_date=None,
            peak_sample_mounts=0,
            batches_ending_after_dark_period=0,
        )
    turnarounds = [b.turnaround_days for b in batches]
    lead_times = [b.harvest_to_data_days for b in batches if b.harvest_to_data_days is not None]

    # Peak number of batches in progress at once (setup start -> last stage end).
    peak, _ = _peak([(b.start, b.end, 1) for b in batches])
    # Peak pucks in use (first to last uses_pucks stage): drives puck/mount purchasing.
    peak_pucks, peak_pucks_date = _peak(
        [(b.pucks_out, b.pucks_back, b.pucks) for b in batches if b.pucks_out and b.pucks]
    )

    late = 0
    if plan.dark_period:
        late = sum(1 for b in batches if b.end - ONE_DAY > plan.dark_period.end)

    return ScenarioSummary(
        batch_count=len(batches),
        first_start=min(b.start for b in batches),
        last_end=max(b.end for b in batches),
        mean_turnaround_days=round(sum(turnarounds) / len(turnarounds), 1),
        max_turnaround_days=max(turnarounds),
        mean_harvest_to_data_days=round(sum(lead_times) / len(lead_times), 1) if lead_times else None,
        max_harvest_to_data_days=max(lead_times, default=None),
        total_queue_days=sum(s.queue_days for b in batches for s in b.segments),
        peak_in_progress=peak,
        peak_pucks_in_use=peak_pucks,
        peak_pucks_date=peak_pucks_date,
        peak_sample_mounts=peak_pucks * plan.inventory.positions_per_puck,
        batches_ending_after_dark_period=late,
    )


def _peak(intervals: list[tuple[date, date, int]]) -> tuple[int, date | None]:
    """Max total weight of overlapping half-open [start, end) intervals, and when it first occurs."""
    events: list[tuple[date, int]] = []
    for start, end, weight in intervals:
        if end > start:
            events += [(start, weight), (end, -weight)]
    events.sort(key=lambda e: (e[0], e[1]))  # releases before acquisitions on the same day
    live = peak = 0
    when: date | None = None
    for d, delta in events:
        live += delta
        if live > peak:
            peak, when = live, d
    return peak, when


def _inventory_warnings(plan: PlanConfig, summary: ScenarioSummary) -> list[str]:
    inv, out = plan.inventory, []
    when = f" (first on {summary.peak_pucks_date:%a %d %b %Y})" if summary.peak_pucks_date else ""
    if inv.pucks_owned is not None and summary.peak_pucks_in_use > inv.pucks_owned:
        short = summary.peak_pucks_in_use - inv.pucks_owned
        out.append(
            f"Peak puck demand is {summary.peak_pucks_in_use}{when}, but only {inv.pucks_owned} "
            f"are owned: {short} more needed."
        )
    if inv.sample_mounts_owned is not None and summary.peak_sample_mounts > inv.sample_mounts_owned:
        short = summary.peak_sample_mounts - inv.sample_mounts_owned
        out.append(
            f"Up to {summary.peak_sample_mounts} sample mounts may be in use{when} (full pucks), "
            f"but only {inv.sample_mounts_owned} are owned: up to {short} more needed."
        )
    return out


def _warnings(
    plan: PlanConfig, books: dict[int, SlotBook], uptime_waits: dict[int, list[int]]
) -> list[str]:
    out: list[str] = []
    facility_names = {f.id: f.name for f in plan.facilities}
    for si, (count, days) in uptime_waits.items():
        st = plan.stages[si]
        out.append(
            f"{count} batch(es) waited {days} day(s) in total for an unbroken window of "
            f"{facility_names[st.facility_id]} uptime before '{st.name}'."
        )
    for book in books.values():
        if book.bumped:
            out.append(
                f"{len(book.bumped)} batch(es) missed their first '{book.stage.name}' slot "
                f"because it was full ({book.rule.max_dewars} dewars)."
            )
    if plan.dark_period:
        dp = plan.dark_period
        outside = [b.name for b in plan.batches if not dp.start <= b.start_date <= dp.end]
        if outside:
            out.append(f"{len(outside)} batch(es) start outside the dark period: {', '.join(outside)}.")
    return out


def compute_schedule(plan: PlanConfig) -> ScheduleResult:
    return ScheduleResult(scenarios={s: simulate(plan, s) for s in SCENARIOS})
