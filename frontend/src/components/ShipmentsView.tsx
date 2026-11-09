import { Badge, Group, Paper, Progress, Stack, Table, Text, Title } from '@mantine/core';
import { IconTruckOff } from '@tabler/icons-react';
import { fmt, WEEKDAYS } from '../lib/dates';
import type { PlanConfig, ScenarioResult, SlotRule } from '../types';

interface Props {
  plan: PlanConfig;
  result: ScenarioResult;
}

export function describeSlots(rule: SlotRule): string {
  const days = rule.weekdays.map((w) => WEEKDAYS[w]).join(', ');
  const every = rule.every_n_weeks === 1 ? 'every week' : `every ${rule.every_n_weeks} weeks`;
  const cap = rule.max_dewars
    ? `, up to ${rule.max_dewars} dewars × ${rule.pucks_per_dewar} pucks (${rule.max_dewars * rule.pucks_per_dewar})`
    : '';
  return `${days}, ${every}${cap}`;
}

export function ShipmentsView({ plan, result }: Props) {
  const slotStages = plan.stages.filter((s) => s.slots);
  const batchById = new Map(plan.batches.map((b) => [b.id, b]));

  const deliveriesNote = plan.batches.some((b) => b.entry_stage_id) ? ' · orange = external delivery' : '';

  if (slotStages.length === 0) {
    return (
      <Paper withBorder p="xl" radius="md">
        <Stack align="center" gap="xs">
          <IconTruckOff size={32} stroke={1.5} color="var(--mantine-color-dimmed)" />
          <Text c="dimmed" ta="center">
            No stage uses scheduled departures yet. In the <b>Stages</b> tab, switch on “Only starts on
            scheduled dates” for a shipping stage to model e.g. a weekly pallet.
          </Text>
        </Stack>
      </Paper>
    );
  }

  return (
    <Stack gap="md">
      {slotStages.map((stage) => {
        const deps = result.departures.filter((d) => d.stage_id === stage.id);
        return (
          <Paper key={stage.id} withBorder radius="md" p="md">
            <Group justify="space-between" mb="sm">
              <Group gap="sm">
                <div style={{ width: 12, height: 12, borderRadius: 3, background: stage.color }} />
                <Title order={5}>{stage.name}</Title>
              </Group>
              <Text size="sm" c="dimmed">
                {describeSlots(stage.slots!)} · {deps.length} departure{deps.length === 1 ? '' : 's'}
                {deliveriesNote}
              </Text>
            </Group>
            {deps.length === 0 ? (
              <Text size="sm" c="dimmed">
                No batches reach this stage.
              </Text>
            ) : (
              <Table striped highlightOnHover verticalSpacing="xs">
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th w={200}>Date</Table.Th>
                    <Table.Th>On board</Table.Th>
                    <Table.Th w={90}>Pucks</Table.Th>
                    <Table.Th w={220}>Dewars</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {deps.map((dep) => (
                    <Table.Tr key={dep.date}>
                      <Table.Td fw={500}>{fmt(dep.date)}</Table.Td>
                      <Table.Td>
                        <Group gap={6}>
                          {dep.batch_ids.map((id) => {
                            const b = batchById.get(id);
                            return (
                              <Badge
                                key={id}
                                variant="light"
                                color={b?.entry_stage_id ? 'orange' : 'gray'}
                                tt="none"
                              >
                                {b?.name ?? id} · {b?.pucks ?? '?'}
                              </Badge>
                            );
                          })}
                        </Group>
                      </Table.Td>
                      <Table.Td>{dep.pucks}</Table.Td>
                      <Table.Td>
                        {dep.max_dewars ? (
                          <Group gap="xs" wrap="nowrap">
                            <Progress
                              flex={1}
                              value={(100 * dep.dewars) / dep.max_dewars}
                              color={dep.dewars >= dep.max_dewars ? 'orange' : 'teal'}
                            />
                            <Text size="xs" w={40}>
                              {dep.dewars}/{dep.max_dewars}
                            </Text>
                          </Group>
                        ) : (
                          <Text size="sm">{dep.dewars}</Text>
                        )}
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            )}
          </Paper>
        );
      })}
    </Stack>
  );
}
