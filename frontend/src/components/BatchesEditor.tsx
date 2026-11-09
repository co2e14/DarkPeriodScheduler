import {
  ActionIcon,
  Box,
  Button,
  Group,
  Modal,
  NumberInput,
  Paper,
  Popover,
  ScrollArea,
  SegmentedControl,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
  Tooltip,
} from '@mantine/core';
import { DatePickerInput } from '@mantine/dates';
import { useDisclosure } from '@mantine/hooks';
import {
  IconCalendarRepeat,
  IconPackageImport,
  IconPlus,
  IconRestore,
  IconSortAscending,
  IconTrash,
} from '@tabler/icons-react';
import { useState } from 'react';
import type { PlanUpdate } from '../App';
import { addDays, maxDate, todayISO, uid } from '../lib/dates';
import {
  DURATION_KEYS,
  DURATION_LABELS,
  describeRange,
  sameRange,
  setBound,
  stageRange,
  toInt,
} from '../lib/durations';
import type { Batch, DurationRange, PlanConfig, Stage } from '../types';

interface Props {
  plan: PlanConfig;
  update: PlanUpdate;
}

const DEFAULT_PUCKS = 7;

export function BatchesEditor({ plan, update }: Props) {
  const [seriesOpen, series] = useDisclosure(false);
  const perBatchStages = plan.stages.filter((s) => s.per_batch);
  const inHouse = plan.batches.filter((b) => !b.entry_stage_id);
  const deliveries = plan.batches.filter((b) => b.entry_stage_id);
  const totalPucks = inHouse.reduce((n, b) => n + b.pucks, 0);

  const setBatch = (id: string, patch: Partial<Batch>) =>
    update((p) => ({ ...p, batches: p.batches.map((b) => (b.id === id ? { ...b, ...patch } : b)) }));

  const setOverride = (b: Batch, stage: Stage, range: DurationRange | null) => {
    const durations = { ...b.durations };
    if (range === null || sameRange(range, stageRange(stage))) delete durations[stage.id];
    else durations[stage.id] = range;
    setBatch(b.id, { durations });
  };

  const addOne = () =>
    update((p) => {
      const own = p.batches.filter((b) => !b.entry_stage_id);
      const last = own.length ? maxDate(own.map((b) => b.start_date)) : null;
      const start = last ? addDays(last, 7) : p.dark_period?.start ?? todayISO();
      return {
        ...p,
        batches: [
          ...p.batches,
          {
            id: uid('batch'),
            name: `Batch ${own.length + 1}`,
            start_date: start,
            pucks: own[own.length - 1]?.pucks ?? DEFAULT_PUCKS,
            entry_stage_id: null,
            durations: {},
            notes: '',
          },
        ],
      };
    });

  const removeBatch = (id: string) =>
    update((p) => ({ ...p, batches: p.batches.filter((x) => x.id !== id) }));

  return (
    <Stack gap="sm">
      <Group justify="space-between">
        <Text size="sm" c="dimmed">
          In-house batches: {inHouse.length} · {totalPucks} pucks. Click a duration to override it for one
          batch; highlighted cells differ from the stage default.
        </Text>
        <Group gap="xs">
          <Button
            variant="default"
            size="xs"
            leftSection={<IconSortAscending size={14} />}
            onClick={() =>
              update((p) => ({
                ...p,
                batches: [...p.batches].sort((a, b) => a.start_date.localeCompare(b.start_date)),
              }))
            }
          >
            Sort by start
          </Button>
          <Button variant="light" size="xs" leftSection={<IconCalendarRepeat size={14} />} onClick={series.open}>
            Generate series
          </Button>
          <Button size="xs" leftSection={<IconPlus size={14} />} onClick={addOne}>
            Add batch
          </Button>
        </Group>
      </Group>

      <Paper withBorder radius="md">
        <ScrollArea type="auto">
          <Table verticalSpacing="xs" highlightOnHover miw={760}>
            <Table.Thead>
              <Table.Tr>
                <Table.Th miw={160}>Name</Table.Th>
                <Table.Th w={180}>Setup starts</Table.Th>
                <Table.Th w={90}>Pucks</Table.Th>
                {perBatchStages.map((s) => (
                  <Table.Th key={s.id} w={120}>
                    <Group gap={6} wrap="nowrap">
                      <Box w={10} h={10} style={{ borderRadius: 3, background: s.color, flex: 'none' }} />
                      <Text size="xs" fw={600} lh={1.2}>
                        {s.name}
                      </Text>
                    </Group>
                  </Table.Th>
                ))}
                <Table.Th miw={160}>Notes</Table.Th>
                <Table.Th w={44} />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {inHouse.map((b) => (
                <Table.Tr key={b.id}>
                  <Table.Td>
                    <TextInput
                      variant="unstyled"
                      value={b.name}
                      onChange={(e) => setBatch(b.id, { name: e.currentTarget.value })}
                    />
                  </Table.Td>
                  <Table.Td>
                    <DatePickerInput
                      variant="unstyled"
                      valueFormat="ddd D MMM YYYY"
                      value={b.start_date}
                      onChange={(v) => v && setBatch(b.id, { start_date: v })}
                    />
                  </Table.Td>
                  <Table.Td>
                    <NumberInput
                      variant="unstyled"
                      min={0}
                      max={999}
                      allowDecimal={false}
                      allowNegative={false}
                      value={b.pucks}
                      onChange={(v) => setBatch(b.id, { pucks: toInt(v, b.pucks) })}
                    />
                  </Table.Td>
                  {perBatchStages.map((s) => (
                    <Table.Td key={s.id}>
                      <DurationCell
                        stage={s}
                        override={b.durations[s.id]}
                        onChange={(r) => setOverride(b, s, r)}
                      />
                    </Table.Td>
                  ))}
                  <Table.Td>
                    <TextInput
                      variant="unstyled"
                      placeholder="Target, PI, plate type…"
                      value={b.notes}
                      onChange={(e) => setBatch(b.id, { notes: e.currentTarget.value })}
                    />
                  </Table.Td>
                  <Table.Td>
                    <ActionIcon
                      variant="subtle"
                      color="red"
                      aria-label="Delete batch"
                      onClick={() => removeBatch(b.id)}
                    >
                      <IconTrash size={16} />
                    </ActionIcon>
                  </Table.Td>
                </Table.Tr>
              ))}
              {inHouse.length === 0 && (
                <Table.Tr>
                  <Table.Td colSpan={5 + perBatchStages.length}>
                    <Text c="dimmed" ta="center" py="md">
                      No batches yet — add one or generate a regular series.
                    </Text>
                  </Table.Td>
                </Table.Tr>
              )}
            </Table.Tbody>
          </Table>
        </ScrollArea>
      </Paper>
      {perBatchStages.length === 0 && (
        <Text size="xs" c="dimmed">
          To vary a stage per batch, switch on “Duration can vary per batch” for it in the Stages tab.
        </Text>
      )}

      <DeliveriesTable plan={plan} deliveries={deliveries} setBatch={setBatch} update={update} remove={removeBatch} />

      <SeriesModal opened={seriesOpen} onClose={series.close} plan={plan} update={update} />
    </Stack>
  );
}

function DeliveriesTable({
  plan,
  deliveries,
  setBatch,
  update,
  remove,
}: {
  plan: PlanConfig;
  deliveries: Batch[];
  setBatch: (id: string, patch: Partial<Batch>) => void;
  update: PlanUpdate;
  remove: (id: string) => void;
}) {
  // Joining at the first stage would make it an ordinary in-house batch.
  const stageOptions = plan.stages.slice(1).map((s) => ({ value: s.id, label: s.name }));
  const defaultEntry = (plan.stages.find((s) => s.slots) ?? plan.stages[1] ?? plan.stages[0]).id;
  const total = deliveries.reduce((n, b) => n + b.pucks, 0);

  const add = () =>
    update((p) => ({
      ...p,
      batches: [
        ...p.batches,
        {
          id: uid('delivery'),
          name: `Delivery ${deliveries.length + 1}`,
          start_date: p.dark_period?.start ?? todayISO(),
          pucks: DEFAULT_PUCKS,
          entry_stage_id: defaultEntry,
          durations: {},
          notes: '',
        },
      ],
    }));

  return (
    <Stack gap="xs" mt="md">
      <Group justify="space-between">
        <div>
          <Text fw={600}>External puck deliveries</Text>
          <Text size="sm" c="dimmed">
            Pucks prepared elsewhere. They skip every stage before the one they join, then share pallets and
            count towards pucks in use like any batch. {deliveries.length} deliver
            {deliveries.length === 1 ? 'y' : 'ies'} · {total} pucks.
          </Text>
        </div>
        <Button
          size="xs"
          variant="light"
          leftSection={<IconPackageImport size={14} />}
          onClick={add}
          disabled={plan.stages.length < 2}
        >
          Add delivery
        </Button>
      </Group>
      {deliveries.length > 0 && (
        <Paper withBorder radius="md">
          <ScrollArea type="auto">
            <Table verticalSpacing="xs" highlightOnHover miw={760}>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th miw={160}>Name</Table.Th>
                  <Table.Th w={180}>Arrives / ready</Table.Th>
                  <Table.Th w={90}>Pucks</Table.Th>
                  <Table.Th w={240}>Joins at stage</Table.Th>
                  <Table.Th miw={160}>Notes</Table.Th>
                  <Table.Th w={44} />
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {deliveries.map((b) => (
                  <Table.Tr key={b.id}>
                    <Table.Td>
                      <TextInput
                        variant="unstyled"
                        value={b.name}
                        onChange={(e) => setBatch(b.id, { name: e.currentTarget.value })}
                      />
                    </Table.Td>
                    <Table.Td>
                      <DatePickerInput
                        variant="unstyled"
                        valueFormat="ddd D MMM YYYY"
                        value={b.start_date}
                        onChange={(v) => v && setBatch(b.id, { start_date: v })}
                      />
                    </Table.Td>
                    <Table.Td>
                      <NumberInput
                        variant="unstyled"
                        min={0}
                        max={999}
                        allowDecimal={false}
                        allowNegative={false}
                        value={b.pucks}
                        onChange={(v) => setBatch(b.id, { pucks: toInt(v, b.pucks) })}
                      />
                    </Table.Td>
                    <Table.Td>
                      <Select
                        variant="unstyled"
                        data={stageOptions}
                        value={b.entry_stage_id}
                        allowDeselect={false}
                        onChange={(v) => v && setBatch(b.id, { entry_stage_id: v })}
                      />
                    </Table.Td>
                    <Table.Td>
                      <TextInput
                        variant="unstyled"
                        placeholder="Source, collaborator…"
                        value={b.notes}
                        onChange={(e) => setBatch(b.id, { notes: e.currentTarget.value })}
                      />
                    </Table.Td>
                    <Table.Td>
                      <ActionIcon variant="subtle" color="red" aria-label="Delete delivery" onClick={() => remove(b.id)}>
                        <IconTrash size={16} />
                      </ActionIcon>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </ScrollArea>
        </Paper>
      )}
    </Stack>
  );
}

function DurationCell({
  stage,
  override,
  onChange,
}: {
  stage: Stage;
  override: DurationRange | undefined;
  onChange: (r: DurationRange | null) => void;
}) {
  const effective = override ?? stageRange(stage);
  return (
    <Popover width={260} position="bottom" withArrow shadow="md" trapFocus>
      <Popover.Target>
        <Tooltip label={override ? 'Overridden for this batch' : 'Stage default'} openDelay={400}>
          <Button
            size="compact-sm"
            variant={override ? 'light' : 'subtle'}
            color={override ? 'indigo' : 'gray'}
            fw={override ? 700 : 400}
          >
            {describeRange(effective)}
          </Button>
        </Tooltip>
      </Popover.Target>
      <Popover.Dropdown>
        <Stack gap="xs">
          <Text size="sm" fw={600}>
            {stage.name}
          </Text>
          <Group grow gap="xs">
            {DURATION_KEYS.map((key) => (
              <NumberInput
                key={key}
                size="xs"
                label={DURATION_LABELS[key].replace(' days', '')}
                min={0}
                max={365}
                allowDecimal={false}
                allowNegative={false}
                value={effective[key]}
                onChange={(v) => onChange(setBound(effective, key, toInt(v, effective[key])))}
              />
            ))}
          </Group>
          <Button
            size="xs"
            variant="default"
            leftSection={<IconRestore size={14} />}
            disabled={!override}
            onClick={() => onChange(null)}
          >
            Reset to stage default ({describeRange(stageRange(stage))})
          </Button>
        </Stack>
      </Popover.Dropdown>
    </Popover>
  );
}

function SeriesModal({
  opened,
  onClose,
  plan,
  update,
}: {
  opened: boolean;
  onClose: () => void;
  plan: PlanConfig;
  update: PlanUpdate;
}) {
  const [first, setFirst] = useState<string | null>(plan.dark_period?.start ?? todayISO());
  const [count, setCount] = useState<number>(8);
  const [gapDays, setGapDays] = useState<number>(7);
  const [pucks, setPucks] = useState<number>(DEFAULT_PUCKS);
  const [prefix, setPrefix] = useState('Batch');
  const [mode, setMode] = useState<'append' | 'replace'>('replace');

  const apply = () => {
    if (!first) return;
    update((p) => {
      const offset = mode === 'append' ? p.batches.filter((b) => !b.entry_stage_id).length : 0;
      const created: Batch[] = Array.from({ length: count }, (_, i) => ({
        id: uid('batch'),
        name: `${prefix} ${offset + i + 1}`,
        start_date: addDays(first, i * gapDays),
        pucks,
        entry_stage_id: null,
        durations: {},
        notes: '',
      }));
      // Series only ever replaces in-house batches; external deliveries are kept.
      const deliveries = p.batches.filter((b) => b.entry_stage_id);
      const own = p.batches.filter((b) => !b.entry_stage_id);
      return { ...p, batches: mode === 'append' ? [...own, ...created, ...deliveries] : [...created, ...deliveries] };
    });
    onClose();
  };

  return (
    <Modal opened={opened} onClose={onClose} title="Generate a series of batches" centered>
      <Stack>
        <DatePickerInput label="First setup date" value={first} onChange={setFirst} valueFormat="ddd D MMM YYYY" />
        <Group grow>
          <NumberInput label="Number of batches" min={1} max={200} value={count} onChange={(v) => setCount(toInt(v, 1) || 1)} />
          <NumberInput
            label="Days between starts"
            min={1}
            max={365}
            value={gapDays}
            onChange={(v) => setGapDays(toInt(v, 1) || 1)}
          />
          <NumberInput label="Pucks per batch" min={0} max={999} value={pucks} onChange={(v) => setPucks(toInt(v, 0))} />
        </Group>
        <TextInput label="Name prefix" value={prefix} onChange={(e) => setPrefix(e.currentTarget.value)} />
        <SegmentedControl
          value={mode}
          onChange={(v) => setMode(v as 'append' | 'replace')}
          data={[
            { value: 'replace', label: `Replace in-house batches (${plan.batches.filter((b) => !b.entry_stage_id).length})` },
            { value: 'append', label: 'Append' },
          ]}
        />
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={apply} disabled={!first}>
            Generate
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
