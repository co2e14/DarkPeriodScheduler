import { ActionIcon, Badge, Button, Group, Paper, Stack, Table, Text, TextInput, Title, Tooltip } from '@mantine/core';
import { DatePickerInput } from '@mantine/dates';
import { IconPlus, IconTrash } from '@tabler/icons-react';
import type { PlanUpdate } from '../App';
import { addDays, daysBetween, todayISO, uid } from '../lib/dates';
import type { Closure, Facility, PlanConfig } from '../types';
import { WeekdayPicker } from './WeekdayPicker';

interface Props {
  plan: PlanConfig;
  update: PlanUpdate;
}

export function FacilitiesEditor({ plan, update }: Props) {
  const setFacility = (id: string, fn: (f: Facility) => Facility) =>
    update((p) => ({ ...p, facilities: p.facilities.map((f) => (f.id === id ? fn(f) : f)) }));

  const setClosures = (id: string, fn: (cs: Closure[]) => Closure[]) =>
    setFacility(id, (f) => ({ ...f, calendar: { ...f.calendar, closures: fn(f.calendar.closures) } }));

  return (
    <Stack gap="md">
      <Text size="sm" c="dimmed">
        Each stage runs against its facility’s calendar. Use downtime for bank holidays and site closures at
        home, and for shutdowns or machine-development periods at the external synchrotron. Stages set to
        “needs unbroken uptime” (e.g. data collection) wait until a long-enough window is available.
      </Text>

      {plan.facilities.map((f) => {
        const usedBy = plan.stages.filter((s) => s.facility_id === f.id);
        const start = plan.dark_period?.start ?? todayISO();
        return (
          <Paper key={f.id} withBorder radius="md" p="md">
            <Group justify="space-between" align="flex-start" mb="md">
              <Stack gap={4} style={{ flex: 1 }}>
                <TextInput
                  label="Facility"
                  value={f.name}
                  maw={360}
                  onChange={(e) => {
                    const name = e.currentTarget.value;
                    setFacility(f.id, (x) => ({ ...x, name }));
                  }}
                />
                <Group gap={4}>
                  <Text size="xs" c="dimmed">
                    Used by:
                  </Text>
                  {usedBy.length ? (
                    usedBy.map((s) => (
                      <Badge key={s.id} size="xs" variant="light" color="gray">
                        {s.name}
                      </Badge>
                    ))
                  ) : (
                    <Text size="xs" c="dimmed">
                      no stages
                    </Text>
                  )}
                </Group>
              </Stack>
              <Tooltip
                label={
                  plan.facilities.length === 1
                    ? 'A plan needs at least one facility'
                    : usedBy.length
                      ? 'Move its stages to another facility first'
                      : 'Delete facility'
                }
              >
                <ActionIcon
                  variant="subtle"
                  color="red"
                  disabled={plan.facilities.length === 1 || usedBy.length > 0}
                  onClick={() => update((p) => ({ ...p, facilities: p.facilities.filter((x) => x.id !== f.id) }))}
                >
                  <IconTrash size={16} />
                </ActionIcon>
              </Tooltip>
            </Group>

            <WeekdayPicker
              label="Operating days"
              description="Days the facility is normally up / staffed."
              value={f.calendar.working_weekdays}
              onChange={(working_weekdays) =>
                setFacility(f.id, (x) => ({ ...x, calendar: { ...x.calendar, working_weekdays } }))
              }
            />

            <Group justify="space-between" mt="lg" mb="xs">
              <Title order={6}>Downtime</Title>
              <Button
                size="xs"
                variant="light"
                leftSection={<IconPlus size={14} />}
                onClick={() =>
                  setClosures(f.id, (cs) => [...cs, { start, end: addDays(start, 27), label: 'Shutdown' }])
                }
              >
                Add downtime
              </Button>
            </Group>
            {f.calendar.closures.length === 0 ? (
              <Text size="sm" c="dimmed">
                No downtime — the facility is available on every operating day.
              </Text>
            ) : (
              <Table verticalSpacing={4}>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Label</Table.Th>
                    <Table.Th w={190}>From</Table.Th>
                    <Table.Th w={190}>To (inclusive)</Table.Th>
                    <Table.Th w={70}>Days</Table.Th>
                    <Table.Th w={40} />
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {f.calendar.closures.map((c, i) => {
                    const patch = (p: Partial<Closure>) =>
                      setClosures(f.id, (cs) =>
                        cs.map((x, j) => {
                          if (j !== i) return x;
                          const next = { ...x, ...p };
                          // keep the range valid when one end moves past the other
                          if (next.end < next.start) {
                            if (p.start) next.end = next.start;
                            else next.start = next.end;
                          }
                          return next;
                        }),
                      );
                    return (
                      <Table.Tr key={`${f.id}-${i}`}>
                        <Table.Td>
                          <TextInput
                            size="xs"
                            value={c.label}
                            placeholder="e.g. Winter shutdown"
                            onChange={(e) => patch({ label: e.currentTarget.value })}
                          />
                        </Table.Td>
                        <Table.Td>
                          <DatePickerInput
                            size="xs"
                            valueFormat="ddd D MMM YYYY"
                            value={c.start}
                            onChange={(v) => v && patch({ start: v })}
                          />
                        </Table.Td>
                        <Table.Td>
                          <DatePickerInput
                            size="xs"
                            valueFormat="ddd D MMM YYYY"
                            value={c.end}
                            onChange={(v) => v && patch({ end: v })}
                          />
                        </Table.Td>
                        <Table.Td>
                          <Text size="sm">{daysBetween(c.start, c.end) + 1}</Text>
                        </Table.Td>
                        <Table.Td>
                          <ActionIcon
                            variant="subtle"
                            color="red"
                            aria-label="Remove downtime"
                            onClick={() => setClosures(f.id, (cs) => cs.filter((_, j) => j !== i))}
                          >
                            <IconTrash size={14} />
                          </ActionIcon>
                        </Table.Td>
                      </Table.Tr>
                    );
                  })}
                </Table.Tbody>
              </Table>
            )}
          </Paper>
        );
      })}

      <Group>
        <Button
          variant="light"
          leftSection={<IconPlus size={16} />}
          onClick={() =>
            update((p) => ({
              ...p,
              facilities: [
                ...p.facilities,
                {
                  id: uid('facility'),
                  name: 'New facility',
                  calendar: { working_weekdays: [0, 1, 2, 3, 4, 5, 6], closures: [] },
                },
              ],
            }))
          }
        >
          Add facility
        </Button>
      </Group>
    </Stack>
  );
}
