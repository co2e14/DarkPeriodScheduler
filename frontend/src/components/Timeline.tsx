import { Box, Group, Paper, ScrollArea, Slider, Stack, Switch, Text, Tooltip } from '@mantine/core';
import { IconPackageImport } from '@tabler/icons-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  addDays,
  closureDays,
  d,
  daysBetween,
  fmt,
  fmtRange,
  lastDay,
  maxDate,
  minDate,
  todayISO,
  weekdayIndex,
} from '../lib/dates';
import { readableText, withAlpha } from '../lib/colors';
import type { ISODate, PlanConfig, Scenario, ScheduleResult, Segment, Stage } from '../types';

const ROW_H = 34;
const LANE_H = 24;
const LABEL_W = 190;
const H_DARK = 16;
const H_MONTH = 20;
const H_DAY = 20;
const HEADER_H = H_DARK + H_MONTH + H_DAY;

interface Props {
  plan: PlanConfig;
  schedule: ScheduleResult;
  scenario: Scenario;
}

const MODE_UNIT: Record<Stage['day_mode'], string> = {
  working: 'working days',
  calendar: 'days',
  uninterrupted: 'days of unbroken uptime',
};

export function Timeline({ plan, schedule, scenario }: Props) {
  const [dayW, setDayW] = useState(16);
  const [showRange, setShowRange] = useState(true);
  const viewport = useRef<HTMLDivElement>(null);
  const result = schedule.scenarios[scenario];

  const stageById = useMemo(() => new Map(plan.stages.map((s) => [s.id, s])), [plan.stages]);
  const facilityName = useMemo(
    () => new Map(plan.facilities.map((f) => [f.id, f.name])),
    [plan.facilities],
  );
  const batchById = useMemo(() => new Map(plan.batches.map((b) => [b.id, b])), [plan.batches]);
  const rows = result.batches.filter((b) => batchById.has(b.batch_id));
  const finishRange = useMemo(() => {
    const m = new Map<string, { lo: ISODate; mid: ISODate; hi: ISODate }>();
    const { optimistic, typical, pessimistic } = schedule.scenarios;
    optimistic.batches.forEach((b, i) =>
      m.set(b.batch_id, { lo: b.end, mid: typical.batches[i]?.end, hi: pessimistic.batches[i]?.end }),
    );
    return m;
  }, [schedule]);

  // Visible window: everything in any scenario, plus the dark period.
  const { start, days } = useMemo(() => {
    const dates: ISODate[] = [];
    for (const r of Object.values(schedule.scenarios))
      for (const b of r.batches) dates.push(b.start, b.end);
    if (plan.dark_period) dates.push(plan.dark_period.start, addDays(plan.dark_period.end, 1));
    if (dates.length === 0) dates.push(todayISO(), addDays(todayISO(), 28));
    const s = addDays(minDate(dates), -3);
    const e = addDays(maxDate(dates), 4);
    return { start: s, days: daysBetween(s, e) };
  }, [schedule, plan.dark_period]);

  const x = (s: ISODate) => daysBetween(start, s) * dayW;
  const width = days * dayW;
  const allDays = useMemo(() => Array.from({ length: days }, (_, i) => addDays(start, i)), [start, days]);

  // Shade the home (first) facility's non-working days in the background.
  const home = plan.facilities[0];
  const homeOff = useMemo(() => {
    const closed = closureDays(home?.calendar.closures ?? []);
    const working = new Set(home?.calendar.working_weekdays ?? [0, 1, 2, 3, 4]);
    return allDays.filter((day) => !working.has(weekdayIndex(day)) || closed.has(day));
  }, [allDays, home]);

  const months = useMemo(() => {
    const out: { label: string; from: ISODate; to: ISODate }[] = [];
    for (const day of allDays) {
      const label = d(day).format('MMM YYYY');
      const last = out[out.length - 1];
      if (last?.label === label) last.to = day;
      else out.push({ label, from: day, to: day });
    }
    return out;
  }, [allDays]);

  // Scroll the dark period start (or today) into view on first render.
  useEffect(() => {
    const target = plan.dark_period?.start ?? todayISO();
    if (viewport.current) viewport.current.scrollLeft = Math.max(0, x(target) - 4 * dayW);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const today = todayISO();
  const bodyH = plan.facilities.length * LANE_H + rows.length * ROW_H;

  return (
    <Paper withBorder radius="md" p="md">
      <Group justify="space-between" mb="sm" wrap="wrap" gap="md">
        <Legend plan={plan} />
        <Group gap="lg">
          <Switch
            size="xs"
            label="Show finish range"
            checked={showRange}
            onChange={(e) => setShowRange(e.currentTarget.checked)}
          />
          <Group gap={6}>
            <Text size="xs" c="dimmed">
              Zoom
            </Text>
            <Slider w={120} min={5} max={40} value={dayW} onChange={setDayW} label={null} size="sm" />
          </Group>
        </Group>
      </Group>

      <Box style={{ display: 'flex', border: '1px solid var(--mantine-color-default-border)', borderRadius: 8 }}>
        {/* Left labels */}
        <Box style={{ width: LABEL_W, flex: 'none', borderRight: '1px solid var(--mantine-color-default-border)' }}>
          <Box h={HEADER_H} style={{ borderBottom: '1px solid var(--mantine-color-default-border)' }} />
          {plan.facilities.map((f) => (
            <Group key={f.id} h={LANE_H} px="xs" gap={4} wrap="nowrap" bg="var(--mantine-color-default-hover)">
              <Text size="xs" c="dimmed" truncate>
                {f.name} downtime
              </Text>
            </Group>
          ))}
          {rows.map((b) => {
            const batch = batchById.get(b.batch_id)!;
            return (
              <Group key={b.batch_id} h={ROW_H} px="xs" justify="space-between" wrap="nowrap" className="gantt-row">
                <Group gap={6} wrap="nowrap" style={{ minWidth: 0 }}>
                  {batch.entry_stage_id && (
                    <Tooltip label="External delivery">
                      <IconPackageImport size={14} color="var(--mantine-color-orange-6)" style={{ flex: 'none' }} />
                    </Tooltip>
                  )}
                  <Text size="sm" fw={500} truncate>
                    {batch.name}
                  </Text>
                </Group>
                <Tooltip
                  label={[
                    `${b.pucks} pucks`,
                    `${b.turnaround_days} days start to finish`,
                    b.harvest_to_data_days != null ? `${b.harvest_to_data_days} days harvest to data` : '',
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                >
                  <Text size="xs" c="dimmed" style={{ flex: 'none' }}>
                    {b.pucks}p · {b.turnaround_days}d
                  </Text>
                </Tooltip>
              </Group>
            );
          })}
        </Box>

        {/* Scrollable chart */}
        <ScrollArea viewportRef={viewport} type="auto" style={{ flex: 1 }} offsetScrollbars="x">
          <Box style={{ width, position: 'relative' }}>
            {/* Header */}
            <Box h={HEADER_H} style={{ position: 'relative', borderBottom: '1px solid var(--mantine-color-default-border)' }}>
              {plan.dark_period && (
                <Tooltip label={`Dark period: ${fmt(plan.dark_period.start)} → ${fmt(plan.dark_period.end)}`}>
                  <Box
                    style={{
                      position: 'absolute',
                      top: 2,
                      height: H_DARK - 4,
                      left: x(plan.dark_period.start),
                      width: x(addDays(plan.dark_period.end, 1)) - x(plan.dark_period.start),
                      background: 'var(--mantine-color-dark-6)',
                      color: 'white',
                      borderRadius: 4,
                      fontSize: 10,
                      fontWeight: 600,
                      paddingLeft: 6,
                      lineHeight: `${H_DARK - 4}px`,
                      overflow: 'hidden',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    DARK PERIOD
                  </Box>
                </Tooltip>
              )}
              {months.map((m) => (
                <Text
                  key={m.from}
                  size="xs"
                  fw={600}
                  style={{
                    position: 'absolute',
                    top: H_DARK,
                    left: x(m.from),
                    width: x(addDays(m.to, 1)) - x(m.from),
                    height: H_MONTH,
                    lineHeight: `${H_MONTH}px`,
                    paddingLeft: 4,
                    borderLeft: '1px solid var(--mantine-color-default-border)',
                    overflow: 'hidden',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {m.label}
                </Text>
              ))}
              {allDays.map((day) => {
                const isMon = weekdayIndex(day) === 0;
                const label = dayW >= 16 ? d(day).format('D') : isMon && dayW * 7 >= 34 ? d(day).format('D/M') : '';
                if (!label) return null;
                return (
                  <Text
                    key={day}
                    c={isMon ? undefined : 'dimmed'}
                    style={{
                      position: 'absolute',
                      top: H_DARK + H_MONTH,
                      left: x(day),
                      width: dayW >= 16 ? dayW : dayW * 7,
                      height: H_DAY,
                      lineHeight: `${H_DAY}px`,
                      fontSize: 10,
                      textAlign: dayW >= 16 ? 'center' : 'left',
                      fontWeight: isMon ? 600 : 400,
                    }}
                  >
                    {label}
                  </Text>
                );
              })}
            </Box>

            {/* Body */}
            <Box style={{ position: 'relative', height: bodyH }}>
              {/* Background: home non-working days, week lines, today */}
              {homeOff.map((day) => (
                <Box
                  key={day}
                  style={{
                    position: 'absolute',
                    top: 0,
                    bottom: 0,
                    left: x(day),
                    width: dayW,
                    background: 'var(--mantine-color-gray-light)',
                  }}
                />
              ))}
              {allDays
                .filter((day) => weekdayIndex(day) === 0)
                .map((day) => (
                  <Box
                    key={`w${day}`}
                    style={{
                      position: 'absolute',
                      top: 0,
                      bottom: 0,
                      left: x(day),
                      borderLeft: '1px dashed var(--mantine-color-default-border)',
                    }}
                  />
                ))}
              {today >= start && today < addDays(start, days) && (
                <Box
                  style={{
                    position: 'absolute',
                    top: 0,
                    bottom: 0,
                    left: x(today) + dayW / 2,
                    borderLeft: '2px solid var(--mantine-color-red-6)',
                    zIndex: 2,
                  }}
                />
              )}

              {/* Facility downtime lanes */}
              {plan.facilities.map((f, i) => (
                <Box
                  key={f.id}
                  style={{ position: 'absolute', top: i * LANE_H, height: LANE_H, left: 0, right: 0 }}
                  bg="var(--mantine-color-default-hover)"
                >
                  {f.calendar.closures.map((c, j) => (
                    <Tooltip
                      key={j}
                      withArrow
                      label={`${f.name}: ${c.label || 'downtime'} (${fmtRange(c.start, addDays(c.end, 1))})`}
                    >
                      <Box
                        className="gantt-bar"
                        style={{
                          top: 4,
                          height: LANE_H - 8,
                          left: x(c.start),
                          width: Math.max(x(addDays(c.end, 1)) - x(c.start), 3),
                          background:
                            'repeating-linear-gradient(135deg, var(--mantine-color-red-light) 0 5px, transparent 5px 10px)',
                          border: '1px solid var(--mantine-color-red-5)',
                          color: 'var(--mantine-color-red-7)',
                          boxShadow: 'none',
                          fontSize: 10,
                        }}
                      >
                        {c.label}
                      </Box>
                    </Tooltip>
                  ))}
                </Box>
              ))}

              {/* Batch rows */}
              {rows.map((b, i) => {
                const top = plan.facilities.length * LANE_H + i * ROW_H;
                const range = finishRange.get(b.batch_id);
                return (
                  <Box key={b.batch_id} className="gantt-row" style={{ position: 'absolute', top, height: ROW_H, left: 0, right: 0 }}>
                    {b.segments.map((s) => {
                      const st = stageById.get(s.stage_id);
                      return st ? (
                        <SegmentBar key={s.stage_id} seg={s} stage={st} x={x} facility={facilityName.get(st.facility_id) ?? ''} />
                      ) : null;
                    })}
                    {showRange && range && range.lo !== range.hi && (
                      <Tooltip
                        withArrow
                        label={`Finishes between ${fmt(lastDay(range.lo))} and ${fmt(lastDay(range.hi))} (typical ${fmt(lastDay(range.mid))})`}
                      >
                        <Box
                          style={{
                            position: 'absolute',
                            top: ROW_H - 7,
                            height: 5,
                            left: x(range.lo),
                            width: Math.max(x(range.hi) - x(range.lo), 2),
                            borderLeft: '2px solid var(--mantine-color-dimmed)',
                            borderRight: '2px solid var(--mantine-color-dimmed)',
                            background:
                              'linear-gradient(var(--mantine-color-dimmed), var(--mantine-color-dimmed)) center / 100% 1px no-repeat',
                          }}
                        />
                      </Tooltip>
                    )}
                  </Box>
                );
              })}
            </Box>
          </Box>
        </ScrollArea>
      </Box>
    </Paper>
  );
}

function SegmentBar({
  seg,
  stage,
  x,
  facility,
}: {
  seg: Segment;
  stage: Stage;
  x: (s: ISODate) => number;
  facility: string;
}) {
  const left = x(seg.start);
  const width = Math.max(x(seg.end) - left, 3);
  const top = 5;
  const height = ROW_H - 14;
  const tip = (
    <Stack gap={2}>
      <Text size="sm" fw={600}>
        {stage.name}
      </Text>
      <Text size="xs">{fmtRange(seg.start, seg.end)}</Text>
      <Text size="xs">
        {seg.duration_days} {MODE_UNIT[stage.day_mode]} · {facility}
      </Text>
      {seg.queue_days > 0 && (
        <Text size="xs" c="yellow.3">
          Ready {fmt(seg.ready)} — waited {seg.queue_days} day{seg.queue_days === 1 ? '' : 's'}
          {stage.slots ? ' for the next scheduled slot' : stage.day_mode === 'uninterrupted' ? ' for uptime' : ''}
        </Text>
      )}
    </Stack>
  );
  return (
    <>
      {seg.queue_days > 0 && (
        <Box
          style={{
            position: 'absolute',
            top: top + 3,
            height: height - 6,
            left: x(seg.ready),
            width: left - x(seg.ready),
            background: `repeating-linear-gradient(135deg, ${withAlpha(stage.color, 0.35)} 0 4px, transparent 4px 8px)`,
            borderTop: `1px dashed ${stage.color}`,
            borderBottom: `1px dashed ${stage.color}`,
          }}
        />
      )}
      <Tooltip label={tip} withArrow multiline openDelay={80}>
        <Box
          className="gantt-bar"
          style={{ top, height, left, width, background: stage.color, color: readableText(stage.color) }}
        >
          {width > 48 ? stage.name : ''}
        </Box>
      </Tooltip>
    </>
  );
}

function Legend({ plan }: { plan: PlanConfig }) {
  const swatch = (bg: string, border?: string) => (
    <Box w={14} h={10} style={{ background: bg, borderRadius: 3, border: border ?? 'none' }} />
  );
  return (
    <Group gap="md" wrap="wrap">
      {plan.stages.map((s) => (
        <Group key={s.id} gap={6} wrap="nowrap">
          {swatch(s.color)}
          <Text size="xs">{s.name}</Text>
        </Group>
      ))}
      <Group gap={6} wrap="nowrap">
        {swatch('repeating-linear-gradient(135deg, var(--mantine-color-gray-5) 0 3px, transparent 3px 6px)', '1px dashed var(--mantine-color-gray-5)')}
        <Text size="xs">Queued</Text>
      </Group>
      <Group gap={6} wrap="nowrap">
        {swatch('var(--mantine-color-gray-light)')}
        <Text size="xs">Home non-working day</Text>
      </Group>
    </Group>
  );
}
