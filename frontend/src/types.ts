// Mirrors backend/app/models.py. Dates are ISO 'YYYY-MM-DD' strings throughout.
// Segment/batch `end` is EXCLUSIVE: the first day after the stage finishes.

export type ISODate = string;
export type Scenario = 'optimistic' | 'typical' | 'pessimistic';
export const SCENARIOS: Scenario[] = ['optimistic', 'typical', 'pessimistic'];

export type DayMode = 'working' | 'calendar' | 'uninterrupted';

export interface SlotRule {
  weekdays: number[]; // 0 = Mon .. 6 = Sun
  every_n_weeks: number;
  anchor_date: ISODate | null;
  max_dewars: number | null; // null = unlimited
  pucks_per_dewar: number;
  share_dewars: boolean; // pucks from different batches may share a dewar
}

export interface DurationRange {
  min_days: number;
  typical_days: number;
  max_days: number;
}

export interface Stage {
  id: string;
  name: string;
  color: string;
  min_days: number;
  typical_days: number;
  max_days: number;
  per_batch: boolean; // batches may override this stage's durations
  uses_pucks: boolean; // the batch's pucks are tied up during this stage
  facility_id: string;
  day_mode: DayMode;
  start_on_working_day: boolean;
  finish_on_working_day: boolean;
  slots: SlotRule | null;
}

export interface Batch {
  id: string;
  name: string;
  start_date: ISODate;
  pucks: number;
  entry_stage_id: string | null; // set = external delivery that joins the pipeline at this stage
  durations: Record<string, DurationRange>; // per-stage overrides (only for per_batch stages)
  notes: string;
}

export interface Closure {
  start: ISODate;
  end: ISODate; // inclusive
  label: string;
}

export interface CalendarConfig {
  working_weekdays: number[];
  closures: Closure[];
}

export interface Facility {
  id: string;
  name: string;
  calendar: CalendarConfig;
}

export interface DarkPeriod {
  start: ISODate;
  end: ISODate;
}

export interface Inventory {
  pucks_owned: number | null;
  positions_per_puck: number;
  sample_mounts_owned: number | null;
}

export interface PlanConfig {
  name: string;
  dark_period: DarkPeriod | null;
  inventory: Inventory;
  facilities: Facility[];
  stages: Stage[];
  batches: Batch[];
  // Harvest-to-data lead time: start of the first stage to end of the second.
  harvest_stage_id: string | null;
  data_stage_id: string | null;
}

export interface PlanSummary {
  id: string;
  name: string;
  updated_at: string;
}

export interface PlanRecord extends PlanSummary {
  config: PlanConfig;
}

export interface Segment {
  stage_id: string;
  ready: ISODate;
  start: ISODate;
  end: ISODate;
  duration_days: number;
  queue_days: number;
}

export interface BatchSchedule {
  batch_id: string;
  start: ISODate;
  end: ISODate;
  turnaround_days: number;
  harvest_to_data_days: number | null; // null for external deliveries
  pucks: number;
  pucks_out: ISODate | null;
  pucks_back: ISODate | null; // exclusive
  segments: Segment[];
}

export interface Departure {
  stage_id: string;
  date: ISODate;
  batch_ids: string[];
  pucks: number;
  dewars: number;
  max_dewars: number | null;
}

export interface ScenarioSummary {
  batch_count: number;
  first_start: ISODate | null;
  last_end: ISODate | null;
  mean_turnaround_days: number | null;
  max_turnaround_days: number | null;
  mean_harvest_to_data_days: number | null;
  max_harvest_to_data_days: number | null;
  total_queue_days: number;
  peak_in_progress: number;
  peak_pucks_in_use: number;
  peak_pucks_date: ISODate | null;
  peak_sample_mounts: number;
  batches_ending_after_dark_period: number;
}

export interface ScenarioResult {
  batches: BatchSchedule[];
  departures: Departure[];
  summary: ScenarioSummary;
  warnings: string[];
}

export interface ScheduleResult {
  scenarios: Record<Scenario, ScenarioResult>;
}
