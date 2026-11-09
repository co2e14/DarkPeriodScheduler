import { Paper, ScrollArea, Table, Text } from '@mantine/core';
import { useMemo } from 'react';
import { withAlpha } from '../lib/colors';
import { addDays, d, maxDate, minDate, weekdayIndex } from '../lib/dates';
import type { ISODate, PlanConfig, ScenarioResult } from '../types';

interface Props {
  plan: PlanConfig;
  result: ScenarioResult;
}

const overlaps = (aStart: ISODate, aEnd: ISODate, bStart: ISODate, bEnd: ISODate) =>
  aStart < bEnd && bStart < aEnd;

/** Batches active in each stage, per week: shows where staff and equipment load piles up. */
export function WorkloadView({ plan, result }: Props) {
  const { weeks, grid, inFlight, pucksPeak, peak } = useMemo(() => {
    if (result.batches.length === 0) return { weeks: [], grid: [], inFlight: [], pucksPeak: [], peak: 0 };
    const first = minDate(result.batches.map((b) => b.start));
    const last = maxDate(result.batches.map((b) => b.end));
    const weeks: ISODate[] = [];
    for (let w = addDays(first, -weekdayIndex(first)); w < last; w = addDays(w, 7)) weeks.push(w);

    const grid = plan.stages.map((stage) =>
      weeks.map((w) => {
        const wEnd = addDays(w, 7);
        return result.batches.filter((b) =>
          b.segments.some((s) => s.stage_id === stage.id && overlaps(s.start, s.end, w, wEnd)),
        ).length;
      }),
    );
    const inFlight = weeks.map((w) =>
      result.batches.filter((b) => overlaps(b.start, b.end, w, addDays(w, 7))).length,
    );
    // Highest daily total of pucks in use within each week (not a weekly sum).
    const pucksPeak = weeks.map((w) => {
      let best = 0;
      for (let i = 0; i < 7; i++) {
        const day = addDays(w, i);
        let n = 0;
        for (const b of result.batches)
          if (b.pucks_out && b.pucks_back && b.pucks_out <= day && day < b.pucks_back) n += b.pucks;
        best = Math.max(best, n);
      }
      return best;
    });
    const peak = Math.max(1, ...grid.flat());
    return { weeks, grid, inFlight, pucksPeak, peak };
  }, [plan.stages, result]);

  const owned = plan.inventory.pucks_owned;

  if (weeks.length === 0) {
    return <Text c="dimmed">Add some batches to see the weekly workload.</Text>;
  }

  return (
    <Paper withBorder radius="md" p="md">
      <Text size="sm" c="dimmed" mb="sm">
        Number of batches in each stage during each week (week commencing Monday).
      </Text>
      <ScrollArea type="auto" offsetScrollbars="x">
        <Table className="workload-table" withColumnBorders withTableBorder>
          <Table.Thead>
            <Table.Tr>
              <Table.Th style={{ textAlign: 'left', minWidth: 190 }}>Stage</Table.Th>
              {weeks.map((w) => (
                <Table.Th key={w} style={{ minWidth: 48 }}>
                  <Text size="xs" fw={600}>
                    {d(w).format('D MMM')}
                  </Text>
                </Table.Th>
              ))}
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {plan.stages.map((stage, i) => (
              <Table.Tr key={stage.id}>
                <Table.Td style={{ textAlign: 'left' }}>
                  <Text size="sm" fw={500}>
                    {stage.name}
                  </Text>
                </Table.Td>
                {grid[i].map((n, j) => (
                  <Table.Td
                    key={weeks[j]}
                    style={{ background: n ? withAlpha(stage.color, 0.15 + (0.75 * n) / peak) : undefined }}
                  >
                    {n || ''}
                  </Table.Td>
                ))}
              </Table.Tr>
            ))}
            <Table.Tr>
              <Table.Td style={{ textAlign: 'left' }}>
                <Text size="sm" fw={700}>
                  Batches in flight
                </Text>
              </Table.Td>
              {inFlight.map((n, j) => (
                <Table.Td key={weeks[j]} fw={700}>
                  {n || ''}
                </Table.Td>
              ))}
            </Table.Tr>
            <Table.Tr>
              <Table.Td style={{ textAlign: 'left' }}>
                <Text size="sm" fw={700}>
                  Pucks in use (peak)
                </Text>
                {owned != null && (
                  <Text size="xs" c="dimmed">
                    {owned} owned
                  </Text>
                )}
              </Table.Td>
              {pucksPeak.map((n, j) => (
                <Table.Td
                  key={weeks[j]}
                  fw={700}
                  c={owned != null && n > owned ? 'red' : undefined}
                  bg={owned != null && n > owned ? 'var(--mantine-color-red-light)' : undefined}
                >
                  {n || ''}
                </Table.Td>
              ))}
            </Table.Tr>
          </Table.Tbody>
        </Table>
      </ScrollArea>
    </Paper>
  );
}
