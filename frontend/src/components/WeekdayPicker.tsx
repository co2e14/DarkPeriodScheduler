import { Chip, Group, Input } from '@mantine/core';
import { WEEKDAYS } from '../lib/dates';

interface Props {
  label?: string;
  description?: string;
  value: number[];
  onChange: (v: number[]) => void;
}

/** Multi-select of weekdays (0 = Mon). Never lets the selection become empty. */
export function WeekdayPicker({ label, description, value, onChange }: Props) {
  return (
    <Input.Wrapper label={label} description={description}>
      <Chip.Group
        multiple
        value={value.map(String)}
        onChange={(v) => v.length > 0 && onChange(v.map(Number).sort((a, b) => a - b))}
      >
        <Group gap={4} mt={4}>
          {WEEKDAYS.map((name, i) => (
            <Chip key={name} value={String(i)} size="xs" variant="filled">
              {name}
            </Chip>
          ))}
        </Group>
      </Chip.Group>
    </Input.Wrapper>
  );
}
