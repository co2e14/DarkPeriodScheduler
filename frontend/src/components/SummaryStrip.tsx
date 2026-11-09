import { Group, Paper, SimpleGrid, Text, ThemeIcon } from '@mantine/core';
import {
  IconClockHour4,
  IconFlagCheck,
  IconFlask,
  IconHourglassHigh,
  IconMicroscope,
  IconStack3,
  IconTruck,
} from '@tabler/icons-react';
import type { ReactNode } from 'react';
import { fmt, fmtShort, lastDay } from '../lib/dates';
import type { PlanConfig, Scenario, ScheduleResult } from '../types';

interface Props {
  plan: PlanConfig;
  schedule: ScheduleResult;
  scenario: Scenario;
}

export function SummaryStrip({ plan, schedule, scenario }: Props) {
  const { optimistic: o, pessimistic: p } = schedule.scenarios;
  const cur = schedule.scenarios[scenario];
  const s = cur.summary;
  const slotStages = new Set(plan.stages.filter((st) => st.slots).map((st) => st.id));
  const shipments = cur.departures.filter((dep) => slotStages.has(dep.stage_id)).length;
  const deliveries = plan.batches.filter((b) => b.entry_stage_id).length;
  const owned = plan.inventory.pucks_owned;
  const pucks = s.peak_pucks_in_use;
  const worstPucks = p.summary.peak_pucks_in_use;

  const range = (a: number | null | undefined, b: number | null | undefined, unit: string) =>
    a == null || b == null ? '' : a === b ? '' : `range ${a}–${b} ${unit}`;

  return (
    <SimpleGrid cols={{ base: 2, sm: 4, lg: 7 }} spacing="sm">
      <Stat
        icon={<IconFlask size={18} />}
        color="indigo"
        label="Batches"
        value={s.batch_count}
        hint={deliveries ? `incl. ${deliveries} external deliver${deliveries === 1 ? 'y' : 'ies'}` : ''}
      />
      <Stat
        icon={<IconClockHour4 size={18} />}
        color="teal"
        label="Mean turnaround"
        value={s.mean_turnaround_days == null ? '—' : `${s.mean_turnaround_days} d`}
        hint={range(o.summary.mean_turnaround_days, p.summary.mean_turnaround_days, 'd')}
      />
      <Stat
        icon={<IconMicroscope size={18} />}
        color="pink"
        label="Harvest → data"
        value={s.mean_harvest_to_data_days == null ? '—' : `${s.mean_harvest_to_data_days} d`}
        hint={
          s.mean_harvest_to_data_days == null
            ? 'set stages in Plan settings'
            : [
                `max ${s.max_harvest_to_data_days} d`,
                range(o.summary.mean_harvest_to_data_days, p.summary.mean_harvest_to_data_days, 'd'),
              ]
                .filter(Boolean)
                .join(' · ')
        }
      />
      <Stat
        icon={<IconHourglassHigh size={18} />}
        color="yellow"
        label="Days spent queueing"
        value={s.total_queue_days}
        hint={s.batch_count ? `${(s.total_queue_days / s.batch_count).toFixed(1)} d per batch` : ''}
      />
      <Stat
        icon={<IconStack3 size={18} />}
        color={owned != null && pucks > owned ? 'red' : 'grape'}
        label="Peak pucks in use"
        value={
          <>
            {pucks}
            {owned != null && (
              <Text span size="sm" c={pucks > owned ? 'red' : 'dimmed'} fw={500}>
                {' '}
                / {owned} owned
              </Text>
            )}
          </>
        }
        hint={[
          scenario !== 'pessimistic' && worstPucks !== pucks ? `worst case ${worstPucks}` : '',
          `≤ ${s.peak_sample_mounts} mounts`,
          s.peak_pucks_date ? `on ${fmtShort(s.peak_pucks_date)}` : '',
        ]
          .filter(Boolean)
          .join(' · ')}
      />
      <Stat
        icon={<IconTruck size={18} />}
        color="orange"
        label="Scheduled departures"
        value={shipments}
        hint={slotStages.size ? `${slotStages.size} slot-based stage${slotStages.size > 1 ? 's' : ''}` : 'no slot rules'}
      />
      <Stat
        icon={<IconFlagCheck size={18} />}
        color={s.batches_ending_after_dark_period ? 'red' : 'green'}
        label="Last batch complete"
        value={s.last_end ? fmt(lastDay(s.last_end)) : '—'}
        hint={
          s.batches_ending_after_dark_period
            ? `${s.batches_ending_after_dark_period} after dark period ends`
            : plan.dark_period
              ? 'all within dark period'
              : ''
        }
      />
    </SimpleGrid>
  );
}

function Stat({
  icon,
  color,
  label,
  value,
  hint,
}: {
  icon: ReactNode;
  color: string;
  label: string;
  value: ReactNode;
  hint?: string;
}) {
  return (
    <Paper withBorder radius="md" p="sm">
      <Group gap="sm" wrap="nowrap" align="flex-start">
        <ThemeIcon variant="light" color={color} size="lg" radius="md">
          {icon}
        </ThemeIcon>
        <div style={{ minWidth: 0 }}>
          <Text size="xs" c="dimmed" tt="uppercase" fw={600} truncate>
            {label}
          </Text>
          <Text fw={700} size="lg" lh={1.3}>
            {value}
          </Text>
          {hint && (
            <Text size="xs" c="dimmed" truncate>
              {hint}
            </Text>
          )}
        </div>
      </Group>
    </Paper>
  );
}
