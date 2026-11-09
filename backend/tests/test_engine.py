from datetime import date, timedelta

import pytest
from pydantic import ValidationError

from app.defaults import default_plan
from app.engine import ScheduleError, WorkCalendar, compute_schedule, simulate, stage_end
from app.models import (
    SCENARIOS,
    Batch,
    CalendarConfig,
    Closure,
    DarkPeriod,
    DayMode,
    DurationRange,
    Facility,
    Inventory,
    PlanConfig,
    SlotRule,
    Stage,
)

# Reference week (November 2026)
MON, TUE, WED, THU, FRI, SAT, SUN = (date(2026, 11, d) for d in range(2, 9))
NEXT_MON, NEXT_TUE, NEXT_WED, NEXT_THU = (date(2026, 11, d) for d in range(9, 13))
ALL_WEEK = [0, 1, 2, 3, 4, 5, 6]


def test_reference_dates():
    assert MON.weekday() == 0 and FRI.weekday() == 4 and SAT.weekday() == 5


def stage(id="s", days=(1, 1, 1), mode=DayMode.working, **kw) -> Stage:
    lo, mid, hi = days
    return Stage(id=id, name=id, min_days=lo, typical_days=mid, max_days=hi, day_mode=mode, **kw)


def plan(stages, starts, calendar=None, external=None, pucks=None, **kw) -> PlanConfig:
    facilities = [Facility(id="home", name="Home", calendar=calendar or CalendarConfig())]
    if external is not None:
        facilities.append(Facility(id="ext", name="Ext", calendar=external))
    pucks = pucks or [1] * len(starts)
    batches = [
        Batch(id=f"b{i}", name=f"B{i}", start_date=d, pucks=p)
        for i, (d, p) in enumerate(zip(starts, pucks))
    ]
    return PlanConfig(facilities=facilities, stages=stages, batches=batches, **kw)


def seg(result, batch=0, stage=0):
    return result.batches[batch].segments[stage]


# ------------------------------------------------------------ calendar maths

def test_working_stage_skips_weekend():
    cal = WorkCalendar(CalendarConfig())
    # Fri, Mon, Tue -> finishes end of Tue; next stage ready Wed.
    assert stage_end(stage(days=(3, 3, 3)), cal, FRI, 3) == NEXT_WED


def test_working_stage_ready_on_saturday_starts_monday():
    r = simulate(plan([stage(days=(2, 2, 2))], [SAT]), "typical")
    s = seg(r)
    assert (s.ready, s.start, s.end, s.queue_days) == (SAT, NEXT_MON, NEXT_WED, 2)


def test_calendar_stage_runs_through_weekend():
    r = simulate(plan([stage(days=(3, 3, 3), mode=DayMode.calendar)], [FRI]), "typical")
    assert (seg(r).start, seg(r).end) == (FRI, NEXT_MON)


def test_finish_on_working_day_extends_weekend_arrival():
    st = stage(days=(3, 3, 3), mode=DayMode.calendar, finish_on_working_day=True)
    r = simulate(plan([st], [THU]), "typical")
    # Thu+Fri+Sat would arrive Saturday -> held until Monday delivery.
    assert (seg(r).start, seg(r).end) == (THU, NEXT_TUE)


def test_start_on_working_day_for_calendar_stage():
    st = stage(days=(2, 2, 2), mode=DayMode.calendar, start_on_working_day=True)
    r = simulate(plan([st], [SUN]), "typical")
    assert (seg(r).start, seg(r).end) == (NEXT_MON, NEXT_WED)


def test_closures_are_not_working_days():
    cal = CalendarConfig(closures=[Closure(start=FRI, end=FRI, label="Bank holiday")])
    r = simulate(plan([stage(days=(2, 2, 2))], [THU], calendar=cal), "typical")
    assert (seg(r).start, seg(r).end) == (THU, NEXT_TUE)  # Thu, (Fri closed), Mon


def test_custom_working_week():
    cal = CalendarConfig(working_weekdays=[0, 1, 2, 3])  # Mon-Thu
    r = simulate(plan([stage(days=(2, 2, 2))], [THU], calendar=cal), "typical")
    assert (seg(r).start, seg(r).end) == (THU, NEXT_TUE)


def test_zero_duration_stage():
    r = simulate(plan([stage(days=(0, 0, 0)), stage(id="t")], [MON]), "typical")
    assert seg(r, stage=0).end == MON and seg(r, stage=1).start == MON


# ------------------------------------------------------------ facility downtime

SHUTDOWN = Closure(start=THU, end=date(2026, 11, 30), label="Winter shutdown")


def collection(**kw) -> Stage:
    return stage(id="collect", days=(4, 4, 4), mode=DayMode.uninterrupted, facility_id="ext", **kw)


def test_uninterrupted_stage_that_fits_before_shutdown_runs():
    ext = CalendarConfig(working_weekdays=ALL_WEEK, closures=[SHUTDOWN])
    r = simulate(plan([collection()], [date(2026, 11, 1)], external=ext), "typical")
    assert (seg(r).start, seg(r).end) == (date(2026, 11, 1), THU)  # Sun..Wed, done before Thu


def test_uninterrupted_stage_overlapping_shutdown_waits_until_after():
    ext = CalendarConfig(working_weekdays=ALL_WEEK, closures=[SHUTDOWN])
    r = simulate(plan([collection()], [MON], external=ext), "typical")
    # Mon..Thu would hit the shutdown starting Thu -> wait for the facility to come back.
    assert (seg(r).start, seg(r).end) == (date(2026, 12, 1), date(2026, 12, 5))
    assert seg(r).queue_days == 29
    assert any("External" in w or "Ext uptime" in w for w in r.warnings)


def test_uninterrupted_stage_respects_facility_working_week():
    ext = CalendarConfig(working_weekdays=[0, 1, 2, 3, 4])  # e.g. beamline staffed Mon-Fri only
    r = simulate(plan([collection()], [WED], external=ext), "typical")
    # Wed..Sat would cross the weekend -> next unbroken 4-day window is Mon..Thu.
    assert seg(r).start == NEXT_MON


def test_working_stage_pauses_through_downtime():
    ext = CalendarConfig(working_weekdays=ALL_WEEK, closures=[Closure(start=TUE, end=WED)])
    st = stage(id="w", days=(3, 3, 3), facility_id="ext")
    r = simulate(plan([st], [MON], external=ext), "typical")
    assert (seg(r).start, seg(r).end) == (MON, SAT)  # Mon, (Tue/Wed down), Thu, Fri


def test_facilities_have_independent_calendars():
    home = CalendarConfig(closures=[Closure(start=MON, end=FRI, label="Home closed")])
    ext = CalendarConfig(working_weekdays=ALL_WEEK)
    r = simulate(plan([collection()], [MON], calendar=home, external=ext), "typical")
    assert seg(r).start == MON  # home closure is irrelevant to an external stage


def test_allocated_beamtime_slot_inside_shutdown_is_skipped():
    ext = CalendarConfig(working_weekdays=ALL_WEEK, closures=[SHUTDOWN])
    st = collection(slots=SlotRule(weekdays=[0]))  # beamtime blocks start on Mondays
    r = simulate(plan([st], [MON], external=ext), "typical")
    assert seg(r).start == date(2026, 12, 7)  # first Monday after the shutdown


# ------------------------------------------------------------ slots / pallets

def pallet(**kw) -> Stage:
    return stage(id="ship", days=(1, 1, 1), mode=DayMode.calendar,
                 slots=SlotRule(weekdays=[3], **kw))


def test_ready_day_after_pallet_waits_a_week():
    r = simulate(plan([pallet()], [FRI]), "typical")
    assert seg(r).start == NEXT_THU and seg(r).queue_days == 6


def test_ready_on_pallet_day_departs_same_day():
    r = simulate(plan([pallet()], [THU]), "typical")
    assert seg(r).start == THU and seg(r).queue_days == 0


def test_pallet_dewar_limit_overflow_rolls_to_next_slot():
    # 9 dewars x 7 pucks = 63 pucks per pallet: 28 + 28 fit (8 dewars), the next 14 don't.
    st = pallet(max_dewars=9, pucks_per_dewar=7)
    r = simulate(plan([st], [MON, MON, TUE], pucks=[28, 28, 14]), "typical")
    assert [b.segments[0].start for b in r.batches] == [THU, THU, NEXT_THU]
    assert [(d.date, d.batch_ids, d.pucks, d.dewars) for d in r.departures] == [
        (THU, ["b0", "b1"], 56, 8),
        (NEXT_THU, ["b2"], 14, 2),
    ]
    assert any("9 dewars" in w for w in r.warnings)


def test_shared_vs_unshared_dewars():
    # Two 3-puck batches: one dewar if they may share, two if not.
    for share, dewars in ((True, 1), (False, 2)):
        st = pallet(max_dewars=1, pucks_per_dewar=7, share_dewars=share)
        r = simulate(plan([st], [MON, MON], pucks=[3, 3]), "typical")
        same_pallet = seg(r, batch=0).start == seg(r, batch=1).start
        assert same_pallet is share
        assert r.departures[0].dewars == 1


def test_dewar_capacity_is_first_come_first_served_by_ready_date():
    # b0 starts later but is listed first; b1 is ready earlier and should get the space.
    st = pallet(max_dewars=1, pucks_per_dewar=7)
    r = simulate(plan([st], [WED, MON], pucks=[7, 7]), "typical")
    assert seg(r, batch=1).start == THU and seg(r, batch=0).start == NEXT_THU


def test_batch_larger_than_a_shipment_is_rejected_clearly():
    st = pallet(max_dewars=9, pucks_per_dewar=7)
    with pytest.raises(ScheduleError, match="64 pucks, needing 10 dewars"):
        simulate(plan([st], [MON], pucks=[64]), "typical")


def test_fortnightly_slots_follow_anchor():
    r = simulate(plan([pallet(every_n_weeks=2, anchor_date=NEXT_THU)], [MON]), "typical")
    assert seg(r).start == NEXT_THU
    r = simulate(plan([pallet(every_n_weeks=2, anchor_date=THU)], [FRI]), "typical")
    assert seg(r).start == NEXT_THU + timedelta(weeks=1)


def test_slot_on_closure_skipped_for_working_start_stage():
    st = stage(id="ship", mode=DayMode.calendar, start_on_working_day=True, slots=SlotRule(weekdays=[3]))
    cal = CalendarConfig(closures=[Closure(start=THU, end=THU)])
    r = simulate(plan([st], [MON], calendar=cal), "typical")
    assert seg(r).start == NEXT_THU


# ------------------------------------------------------------ per-batch durations

def test_per_batch_override_only_affects_that_batch():
    growth = stage(id="growth", days=(2, 7, 14), mode=DayMode.calendar, per_batch=True)
    p = plan([growth], [MON, MON])
    p.batches[0].durations["growth"] = DurationRange(min_days=1, typical_days=3, max_days=5)
    res = compute_schedule(p)
    assert res.scenarios["typical"].batches[0].end == THU  # 3 days
    assert res.scenarios["pessimistic"].batches[0].end == SAT  # 5 days
    assert res.scenarios["typical"].batches[1].end == NEXT_MON  # stage default, 7 days


def test_override_ignored_when_stage_not_per_batch_or_unknown():
    growth = stage(id="growth", days=(7, 7, 7), mode=DayMode.calendar, per_batch=False)
    p = plan([growth], [MON])
    p.batches[0].durations["growth"] = DurationRange(min_days=1, typical_days=1, max_days=1)
    p.batches[0].durations["deleted-stage"] = DurationRange(min_days=1, typical_days=1, max_days=1)
    assert simulate(p, "typical").batches[0].end == NEXT_MON


# ------------------------------------------------------------ puck demand

def puck_plan(starts, pucks, **kw):
    return plan(
        [
            stage(id="setup", days=(2, 2, 2), mode=DayMode.calendar),
            stage(id="mount", days=(1, 1, 1), mode=DayMode.calendar, uses_pucks=True),
            stage(id="ship", days=(1, 1, 1), mode=DayMode.calendar, uses_pucks=True,
                  slots=SlotRule(weekdays=[3])),
            stage(id="clean", days=(1, 1, 1), mode=DayMode.calendar, uses_pucks=True),
        ],
        starts,
        pucks=pucks,
        **kw,
    )


def test_puck_window_spans_first_to_last_puck_stage_including_queue():
    r = simulate(puck_plan([MON], [5]), "typical")
    b = r.batches[0]
    # setup Mon-Tue, mount Wed, wait for Thu pallet... ship Thu, clean Fri.
    assert (b.pucks_out, b.pucks_back) == (WED, SAT)
    # Mount on a Friday -> ready Sat, queued until next Thu: pucks stay out the whole time.
    r = simulate(puck_plan([WED], [5]), "typical")
    assert (r.batches[0].pucks_out, r.batches[0].pucks_back) == (FRI, date(2026, 11, 14))


def test_peak_pucks_sums_overlapping_and_maxes_disjoint_batches():
    overlapping = simulate(puck_plan([MON, MON], [5, 9]), "typical").summary
    assert (overlapping.peak_pucks_in_use, overlapping.peak_pucks_date) == (14, WED)
    assert overlapping.peak_sample_mounts == 14 * 16
    disjoint = simulate(puck_plan([MON, NEXT_MON], [5, 9]), "typical").summary
    assert disjoint.peak_pucks_in_use == 9


def test_inventory_shortfall_warnings():
    inv = Inventory(pucks_owned=10, positions_per_puck=16, sample_mounts_owned=100)
    r = simulate(puck_plan([MON, MON], [5, 9], inventory=inv), "typical")
    assert any("4 more needed" in w for w in r.warnings)  # 14 pucks vs 10
    assert any("124 more" in w for w in r.warnings)  # 224 mounts vs 100


def test_external_delivery_skips_earlier_stages_and_shares_the_pallet():
    p = puck_plan([MON, TUE], [5, 3])
    p.batches[1].entry_stage_id = "ship"  # 3 pucks arrive Tue, already mounted
    r = simulate(p, "typical")
    delivery = r.batches[1]
    assert [s.stage_id for s in delivery.segments] == ["ship", "clean"]
    assert delivery.segments[0].ready == TUE and delivery.segments[0].start == THU
    assert (delivery.pucks_out, delivery.pucks_back) == (THU, SAT)
    assert [(d.date, d.batch_ids, d.pucks) for d in r.departures] == [(THU, ["b1", "b0"], 8)]  # delivery was ready first
    assert r.summary.peak_pucks_in_use == 8


def test_harvest_to_data_spans_harvest_start_to_data_end_and_skips_deliveries():
    p = puck_plan([MON, TUE], [5, 3], harvest_stage_id="mount", data_stage_id="ship")
    p.batches[1].entry_stage_id = "ship"  # never harvested in-house
    r = simulate(p, "typical")
    # b0: mount Wed, ship Thu (ends Fri, exclusive) -> 2 days.
    assert r.batches[0].harvest_to_data_days == (FRI - WED).days == 2
    assert r.batches[1].harvest_to_data_days is None
    assert (r.summary.mean_harvest_to_data_days, r.summary.max_harvest_to_data_days) == (2.0, 2)


def test_harvest_to_data_includes_queueing():
    # Mount Fri, wait for next Thu's pallet, ship Thu -> Fri 6th..Fri 13th.
    r = simulate(puck_plan([WED], [5], harvest_stage_id="mount", data_stage_id="ship"), "typical")
    assert r.batches[0].harvest_to_data_days == 7


def test_harvest_to_data_is_none_for_unknown_or_reversed_stages():
    for ids in [("nope", "ship"), ("ship", "mount"), (None, None)]:
        p = puck_plan([MON], [5], harvest_stage_id=ids[0], data_stage_id=ids[1])
        r = simulate(p, "typical")
        assert r.batches[0].harvest_to_data_days is None
        assert r.summary.mean_harvest_to_data_days is None


def test_rejects_unknown_entry_stage():
    with pytest.raises(ValidationError):
        PlanConfig(
            facilities=[Facility(id="home", name="Home")],
            stages=[stage()],
            batches=[Batch(id="x", name="X", start_date=MON, entry_stage_id="nope")],
        )


# ------------------------------------------------------------ scenarios & full plan

def test_scenarios_use_min_typical_max():
    growth = stage(id="growth", days=(2, 7, 14), mode=DayMode.calendar)
    res = compute_schedule(plan([growth], [MON]))
    ends = {s: res.scenarios[s].batches[0].end for s in SCENARIOS}
    assert ends == {"optimistic": WED, "typical": NEXT_MON, "pessimistic": MON + timedelta(days=14)}


def test_stages_chain_and_default_plan_is_monotonic():
    res = compute_schedule(default_plan(today=MON))
    for scenario in SCENARIOS:
        for b in res.scenarios[scenario].batches:
            for prev, nxt in zip(b.segments, b.segments[1:]):
                assert nxt.ready == prev.end and nxt.start >= nxt.ready
    for o, t, p in zip(*(res.scenarios[s].batches for s in SCENARIOS)):
        assert o.end <= t.end <= p.end
    # Default ship-out uses Thursday pallets.
    ship_starts = {s.start.weekday() for b in res.scenarios["typical"].batches
                   for s in b.segments if s.stage_id == "ship-out"}
    assert ship_starts == {3}


def test_summary_peak_and_dark_period():
    dp = DarkPeriod(start=MON, end=FRI)
    r = simulate(plan([stage(days=(5, 5, 5))], [MON, MON, NEXT_MON], dark_period=dp), "typical")
    assert r.summary.peak_in_progress == 2  # first two finish before the third starts
    assert r.summary.batches_ending_after_dark_period == 1
    assert any("outside the dark period" in w for w in r.warnings)


# ------------------------------------------------------------ validation

def test_rejects_min_greater_than_max():
    with pytest.raises(ValidationError):
        stage(days=(5, 3, 2))


def test_rejects_empty_working_week():
    with pytest.raises(ValidationError):
        CalendarConfig(working_weekdays=[])


def test_rejects_duplicate_stage_ids():
    with pytest.raises(ValidationError):
        plan([stage(id="a"), stage(id="a")], [MON])


def test_rejects_unknown_facility():
    with pytest.raises(ValidationError):
        plan([stage(facility_id="nowhere")], [MON])
