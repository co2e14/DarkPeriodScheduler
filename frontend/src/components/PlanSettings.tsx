import { Group, NumberInput, Paper, Select, Stack, Switch, Text, TextInput, Title } from '@mantine/core';
import { DatePickerInput } from '@mantine/dates';
import type { PlanUpdate } from '../App';
import { addDays, daysBetween, todayISO } from '../lib/dates';
import { toInt } from '../lib/durations';
import type { Inventory, PlanConfig } from '../types';

interface Props {
  plan: PlanConfig;
  update: PlanUpdate;
}

export function PlanSettings({ plan, update }: Props) {
  const dp = plan.dark_period;
  const inv = plan.inventory;
  const setInv = (patch: Partial<Inventory>) => update((p) => ({ ...p, inventory: { ...p.inventory, ...patch } }));
  const optional = (v: string | number) => (v === '' ? null : toInt(v, 0));
  const stageOptions = plan.stages.map((st) => ({ value: st.id, label: st.name }));
  const stageIdx = (id: string | null) => plan.stages.findIndex((st) => st.id === id);
  // A stale id (deleted stage) shows as empty rather than as a raw id.
  const known = (id: string | null) => (stageIdx(id) >= 0 ? id : null);
  const reversed =
    stageIdx(plan.harvest_stage_id) >= 0 &&
    stageIdx(plan.data_stage_id) >= 0 &&
    stageIdx(plan.data_stage_id) < stageIdx(plan.harvest_stage_id);
  return (
    <Stack maw={720}>
    <Paper withBorder radius="md" p="md">
      <Stack>
        <TextInput
          label="Plan name"
          value={plan.name}
          onChange={(e) => {
            const name = e.currentTarget.value;
            update((p) => ({ ...p, name }));
          }}
        />
        <Switch
          label="Track a dark period"
          description="Shown on the timeline; batches starting outside it, or returning after it ends, are flagged."
          checked={!!dp}
          onChange={(e) => {
            const on = e.currentTarget.checked;
            const start = todayISO();
            update((p) => ({ ...p, dark_period: on ? { start, end: addDays(start, 181) } : null }));
          }}
        />
        {dp && (
          <Group grow align="flex-start">
            <DatePickerInput
              label="Dark period starts"
              valueFormat="ddd D MMM YYYY"
              value={dp.start}
              onChange={(v) =>
                v && update((p) => ({ ...p, dark_period: { start: v, end: v > dp.end ? v : dp.end } }))
              }
            />
            <DatePickerInput
              label="Dark period ends"
              valueFormat="ddd D MMM YYYY"
              value={dp.end}
              minDate={dp.start}
              onChange={(v) => v && update((p) => ({ ...p, dark_period: { start: dp.start, end: v } }))}
            />
          </Group>
        )}
        {dp && (
          <Text size="sm" c="dimmed">
            {daysBetween(dp.start, dp.end) + 1} days (~{Math.round((daysBetween(dp.start, dp.end) + 1) / 7)} weeks)
          </Text>
        )}
      </Stack>
    </Paper>
    <Paper withBorder radius="md" p="md">
      <Stack>
        <div>
          <Title order={5}>Puck &amp; sample mount inventory</Title>
          <Text size="sm" c="dimmed">
            What you own today. The schedule reports peak demand against these (it never delays batches for
            lack of pucks), so you can see how many to buy. Pucks count as in use from the first to the last
            stage marked “Pucks in use”, including time waiting for the pallet.
          </Text>
        </div>
        <Group grow align="flex-start">
          <NumberInput
            label="Pucks owned"
            placeholder="Not set"
            min={0}
            allowDecimal={false}
            value={inv.pucks_owned ?? ''}
            onChange={(v) => setInv({ pucks_owned: optional(v) })}
          />
          <NumberInput
            label="Sample positions per puck"
            description="Unipuck = 16"
            min={1}
            allowDecimal={false}
            value={inv.positions_per_puck}
            onChange={(v) => setInv({ positions_per_puck: Math.max(1, toInt(v, 16)) })}
          />
          <NumberInput
            label="Sample mounts owned"
            placeholder="Not set"
            min={0}
            allowDecimal={false}
            value={inv.sample_mounts_owned ?? ''}
            onChange={(v) => setInv({ sample_mounts_owned: optional(v) })}
          />
        </Group>
        <Text size="xs" c="dimmed">
          Sample mounts in use are an upper bound: pucks × positions per puck, as if every puck were full.
        </Text>
      </Stack>
    </Paper>
    <Paper withBorder radius="md" p="md">
      <Stack>
        <div>
          <Title order={5}>Harvest-to-data lead time</Title>
          <Text size="sm" c="dimmed">
            Days from the start of the harvest stage to the end of the data stage, including any time spent
            waiting for a shipment or for beamtime. External deliveries that skip the harvest stage are left
            out.
          </Text>
        </div>
        <Group grow align="flex-start">
          <Select
            label="Harvest stage"
            placeholder="Not set"
            clearable
            data={stageOptions}
            value={known(plan.harvest_stage_id)}
            onChange={(v) => update((p) => ({ ...p, harvest_stage_id: v }))}
          />
          <Select
            label="Data collected after stage"
            placeholder="Not set"
            clearable
            data={stageOptions}
            value={known(plan.data_stage_id)}
            error={reversed ? 'Comes before the harvest stage' : undefined}
            onChange={(v) => update((p) => ({ ...p, data_stage_id: v }))}
          />
        </Group>
      </Stack>
    </Paper>
    </Stack>
  );
}
