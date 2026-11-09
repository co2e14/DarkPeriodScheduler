import {
  ActionIcon,
  Badge,
  Button,
  ColorInput,
  Group,
  NumberInput,
  Paper,
  SegmentedControl,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  Text,
  TextInput,
  Tooltip,
} from '@mantine/core';
import { DatePickerInput } from '@mantine/dates';
import { IconArrowDown, IconArrowUp, IconCopy, IconPlus, IconTrash } from '@tabler/icons-react';
import type { PlanUpdate } from '../App';
import { STAGE_PALETTE } from '../lib/colors';
import { uid } from '../lib/dates';
import { DURATION_KEYS, DURATION_LABELS, setBound, toInt } from '../lib/durations';
import type { DayMode, PlanConfig, Stage } from '../types';
import { WeekdayPicker } from './WeekdayPicker';

interface Props {
  plan: PlanConfig;
  update: PlanUpdate;
}

const MODE_HELP: Record<DayMode, string> = {
  working:
    'Only progresses on the facility’s working days — pauses over weekends, holidays and downtime (bench work: setup, mounting, cleaning).',
  calendar:
    'Runs continuously, weekends and downtime included (crystal growth, couriers in transit).',
  uninterrupted:
    'Needs one unbroken block of facility uptime. If the block would overlap a non-working day or downtime (e.g. a shutdown), it waits for the next window that fits (beamtime).',
};

export function StagesEditor({ plan, update }: Props) {
  const setStage = (id: string, fn: (s: Stage) => Stage) =>
    update((p) => ({ ...p, stages: p.stages.map((s) => (s.id === id ? fn(s) : s)) }));

  const move = (i: number, dir: -1 | 1) =>
    update((p) => {
      const stages = [...p.stages];
      [stages[i], stages[i + dir]] = [stages[i + dir], stages[i]];
      return { ...p, stages };
    });

  const remove = (id: string) =>
    update((p) => {
      const idx = p.stages.findIndex((s) => s.id === id);
      const stages = p.stages.filter((s) => s.id !== id);
      // Deliveries that joined at the deleted stage now join at the one that took its place.
      const replacement = stages[Math.min(idx, stages.length - 1)]?.id ?? null;
      const batches = p.batches.map((b) => {
        const { [id]: _dropped, ...durations } = b.durations;
        return {
          ...b,
          durations,
          entry_stage_id: b.entry_stage_id === id ? replacement : b.entry_stage_id,
        };
      });
      // The lead-time endpoints are cleared, not remapped: a neighbour would measure something else.
      const harvest_stage_id = p.harvest_stage_id === id ? null : p.harvest_stage_id;
      const data_stage_id = p.data_stage_id === id ? null : p.data_stage_id;
      return { ...p, stages, batches, harvest_stage_id, data_stage_id };
    });

  const insertAfter = (i: number, stage: Stage) =>
    update((p) => {
      const stages = [...p.stages];
      stages.splice(i + 1, 0, stage);
      return { ...p, stages };
    });

  const facilityOptions = plan.facilities.map((f) => ({ value: f.id, label: f.name }));

  return (
    <Stack gap="sm">
      <Text size="sm" c="dimmed">
        Every batch passes through these stages in order. Durations are in days; the scenario switch in
        the header picks min / typical / max for every stage.
      </Text>

      {plan.stages.map((stage, i) => (
        <Paper key={stage.id} withBorder radius="md" p="md" style={{ borderLeft: `5px solid ${stage.color}` }}>
          <Group justify="space-between" align="flex-end" wrap="nowrap" mb="sm">
            <Group align="flex-end" gap="sm" wrap="nowrap" style={{ flex: 1 }}>
              <Badge variant="light" color="gray" size="lg" circle>
                {i + 1}
              </Badge>
              <TextInput
                label="Stage"
                value={stage.name}
                onChange={(e) => {
                  const name = e.currentTarget.value;
                  setStage(stage.id, (s) => ({ ...s, name }));
                }}
                style={{ flex: 1, maxWidth: 340 }}
              />
              <Select
                label="Facility"
                data={facilityOptions}
                value={stage.facility_id}
                onChange={(v) => v && setStage(stage.id, (s) => ({ ...s, facility_id: v }))}
                allowDeselect={false}
                w={220}
              />
              <ColorInput
                label="Colour"
                value={stage.color}
                onChange={(color) => setStage(stage.id, (s) => ({ ...s, color }))}
                swatches={STAGE_PALETTE}
                format="hex"
                w={130}
              />
            </Group>
            <Group gap={4} wrap="nowrap">
              <Tooltip label="Move up">
                <ActionIcon variant="subtle" disabled={i === 0} onClick={() => move(i, -1)}>
                  <IconArrowUp size={16} />
                </ActionIcon>
              </Tooltip>
              <Tooltip label="Move down">
                <ActionIcon variant="subtle" disabled={i === plan.stages.length - 1} onClick={() => move(i, 1)}>
                  <IconArrowDown size={16} />
                </ActionIcon>
              </Tooltip>
              <Tooltip label="Duplicate">
                <ActionIcon
                  variant="subtle"
                  onClick={() => insertAfter(i, { ...stage, id: uid('stage'), name: `${stage.name} (copy)` })}
                >
                  <IconCopy size={16} />
                </ActionIcon>
              </Tooltip>
              <Tooltip label={plan.stages.length === 1 ? 'A plan needs at least one stage' : 'Delete'}>
                <ActionIcon
                  variant="subtle"
                  color="red"
                  disabled={plan.stages.length === 1}
                  onClick={() => remove(stage.id)}
                >
                  <IconTrash size={16} />
                </ActionIcon>
              </Tooltip>
            </Group>
          </Group>

          <SimpleGrid cols={{ base: 1, md: 2 }} spacing="lg">
            <Stack gap="xs">
              <Group gap="sm" grow>
                {DURATION_KEYS.map((key) => (
                  <NumberInput
                    key={key}
                    label={DURATION_LABELS[key]}
                    min={0}
                    max={365}
                    value={stage[key]}
                    onChange={(v) => setStage(stage.id, (s) => setBound(s, key, toInt(v, s[key])))}
                    allowDecimal={false}
                    allowNegative={false}
                  />
                ))}
              </Group>
              <Text size="xs" fw={500} mt={4}>
                Timing
              </Text>
              <SegmentedControl
                fullWidth
                size="xs"
                value={stage.day_mode}
                onChange={(v) => setStage(stage.id, (s) => ({ ...s, day_mode: v as DayMode }))}
                data={[
                  { value: 'working', label: 'Working days only' },
                  { value: 'calendar', label: 'Runs through weekends' },
                  { value: 'uninterrupted', label: 'Needs unbroken uptime' },
                ]}
              />
              <Text size="xs" c="dimmed">
                {MODE_HELP[stage.day_mode]}
              </Text>
              <Group gap="xl" mt={4}>
                <Switch
                  size="xs"
                  label="Duration can vary per batch"
                  description="Override it per batch in the Batches tab"
                  checked={stage.per_batch}
                  onChange={(e) => {
                    const v = e.currentTarget.checked;
                    setStage(stage.id, (s) => ({ ...s, per_batch: v }));
                  }}
                />
                <Switch
                  size="xs"
                  label="Pucks in use during this stage"
                  description="Counts towards pucks / sample mounts in use"
                  checked={stage.uses_pucks}
                  onChange={(e) => {
                    const v = e.currentTarget.checked;
                    setStage(stage.id, (s) => ({ ...s, uses_pucks: v }));
                  }}
                />
              </Group>
              {stage.day_mode === 'calendar' && (
                <Stack gap={6} mt={4}>
                  <Switch
                    size="xs"
                    label="Must start on a working day"
                    description="e.g. couriers only collect on working days"
                    checked={stage.start_on_working_day}
                    onChange={(e) => {
                      const v = e.currentTarget.checked;
                      setStage(stage.id, (s) => ({ ...s, start_on_working_day: v }));
                    }}
                  />
                  <Switch
                    size="xs"
                    label="Must finish on a working day"
                    description="e.g. no weekend deliveries — a weekend arrival is held until the next working day"
                    checked={stage.finish_on_working_day}
                    onChange={(e) => {
                      const v = e.currentTarget.checked;
                      setStage(stage.id, (s) => ({ ...s, finish_on_working_day: v }));
                    }}
                  />
                </Stack>
              )}
            </Stack>

            <Stack gap="xs">
              <Switch
                label="Only starts on scheduled dates"
                description="Batches queue until the next slot — e.g. a weekly pallet shipment or allocated beamtime."
                checked={!!stage.slots}
                onChange={(e) => {
                  const on = e.currentTarget.checked;
                  setStage(stage.id, (s) => ({
                    ...s,
                    slots: on
                      ? {
                          weekdays: [3],
                          every_n_weeks: 1,
                          anchor_date: null,
                          max_dewars: null,
                          pucks_per_dewar: 7,
                          share_dewars: true,
                        }
                      : null,
                  }));
                }}
              />
              {stage.slots && (
                <Stack gap="xs" pl="md" style={{ borderLeft: '2px solid var(--mantine-color-default-border)' }}>
                  <WeekdayPicker
                    label="Slot days"
                    value={stage.slots.weekdays}
                    onChange={(weekdays) => setStage(stage.id, (s) => ({ ...s, slots: { ...s.slots!, weekdays } }))}
                  />
                  <Group grow align="flex-start">
                    <NumberInput
                      label="Every N weeks"
                      min={1}
                      max={52}
                      value={stage.slots.every_n_weeks}
                      allowDecimal={false}
                      onChange={(v) =>
                        setStage(stage.id, (s) => ({
                          ...s,
                          slots: { ...s.slots!, every_n_weeks: Math.max(1, toInt(v, 1)) },
                        }))
                      }
                    />
                  </Group>
                  <Group grow align="flex-start">
                    <NumberInput
                      label="Max dewars per slot"
                      placeholder="Unlimited"
                      min={1}
                      value={stage.slots.max_dewars ?? ''}
                      allowDecimal={false}
                      onChange={(v) =>
                        setStage(stage.id, (s) => ({
                          ...s,
                          slots: { ...s.slots!, max_dewars: v === '' ? null : Math.max(1, toInt(v, 1)) },
                        }))
                      }
                    />
                    <NumberInput
                      label="Pucks per dewar"
                      min={1}
                      value={stage.slots.pucks_per_dewar}
                      allowDecimal={false}
                      onChange={(v) =>
                        setStage(stage.id, (s) => ({
                          ...s,
                          slots: { ...s.slots!, pucks_per_dewar: Math.max(1, toInt(v, 1)) },
                        }))
                      }
                    />
                  </Group>
                  <Text size="xs" c="dimmed">
                    {stage.slots.max_dewars
                      ? `Up to ${stage.slots.max_dewars * stage.slots.pucks_per_dewar} pucks per slot. `
                      : ''}
                    A batch is never split across slots; if it doesn’t fit, it waits for the next one.
                  </Text>
                  <Switch
                    size="xs"
                    label="Batches can share a dewar"
                    description="Off: each batch fills its own dewars (two 3-puck batches use 2 dewars, not 1)."
                    checked={stage.slots.share_dewars}
                    onChange={(e) => {
                      const v = e.currentTarget.checked;
                      setStage(stage.id, (s) => ({ ...s, slots: { ...s.slots!, share_dewars: v } }));
                    }}
                  />
                  {stage.slots.every_n_weeks > 1 && (
                    <DatePickerInput
                      label="A week with a slot"
                      description="Sets which weeks are ‘on’. Defaults to the dark period start."
                      placeholder="Dark period start"
                      clearable
                      value={stage.slots.anchor_date}
                      onChange={(v) =>
                        setStage(stage.id, (s) => ({ ...s, slots: { ...s.slots!, anchor_date: v } }))
                      }
                    />
                  )}
                </Stack>
              )}
            </Stack>
          </SimpleGrid>
        </Paper>
      ))}

      <Group>
        <Button
          variant="light"
          leftSection={<IconPlus size={16} />}
          onClick={() =>
            insertAfter(plan.stages.length - 1, {
              id: uid('stage'),
              name: 'New stage',
              color: STAGE_PALETTE[plan.stages.length % STAGE_PALETTE.length],
              min_days: 1,
              typical_days: 1,
              max_days: 1,
              per_batch: false,
              uses_pucks: false,
              facility_id: plan.facilities[0].id,
              day_mode: 'working',
              start_on_working_day: false,
              finish_on_working_day: false,
              slots: null,
            })
          }
        >
          Add stage
        </Button>
      </Group>
    </Stack>
  );
}
