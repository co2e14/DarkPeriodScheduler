import {
  ActionIcon,
  Alert,
  AppShell,
  Badge,
  Button,
  Center,
  Group,
  Loader,
  Menu,
  Modal,
  SegmentedControl,
  Select,
  Stack,
  Tabs,
  Text,
  Title,
  Tooltip,
  useComputedColorScheme,
  useMantineColorScheme,
} from '@mantine/core';
import { useDebouncedValue, useDisclosure } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import {
  IconAlertTriangle,
  IconBuildingFactory2,
  IconCalendarStats,
  IconTimeline,
  IconCopy,
  IconDiamond,
  IconDots,
  IconFlask,
  IconMoon,
  IconPlus,
  IconSettings,
  IconStack2,
  IconSun,
  IconTrash,
  IconTruckDelivery,
} from '@tabler/icons-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api';
import { BatchesEditor } from './components/BatchesEditor';
import { FacilitiesEditor } from './components/FacilitiesEditor';
import { PlanSettings } from './components/PlanSettings';
import { ShipmentsView } from './components/ShipmentsView';
import { StagesEditor } from './components/StagesEditor';
import { SummaryStrip } from './components/SummaryStrip';
import { Timeline } from './components/Timeline';
import { WorkloadView } from './components/WorkloadView';
import type { PlanConfig, PlanSummary, Scenario, ScheduleResult } from './types';

/** The plan being edited. `id` travels with the config so a debounced save can't land on another plan. */
interface Doc {
  id: string;
  config: PlanConfig;
  dirty: boolean;
}

export type PlanUpdate = (updater: (plan: PlanConfig) => PlanConfig) => void;

const notifyError = (title: string) => (e: Error) =>
  notifications.show({ color: 'red', title, message: e.message });

export default function App() {
  const [plans, setPlans] = useState<PlanSummary[]>([]);
  const [doc, setDoc] = useState<Doc | null>(null);
  const [schedule, setSchedule] = useState<ScheduleResult | null>(null);
  const [scheduleError, setScheduleError] = useState<string | null>(null);
  const [scenario, setScenario] = useState<Scenario>('typical');
  const [saving, setSaving] = useState<'idle' | 'saving' | 'error'>('idle');
  const [tab, setTab] = useState<string | null>('timeline');
  const [confirmDelete, deleteModal] = useDisclosure(false);
  const [debounced] = useDebouncedValue(doc, 400);
  const scheduleSeq = useRef(0);
  const docRef = useRef<Doc | null>(null);
  docRef.current = doc;

  const openPlan = useCallback((id: string) => {
    // Flush edits still inside the debounce window so switching plans never drops them.
    const cur = docRef.current;
    if (cur?.dirty) {
      api
        .updatePlan(cur.id, cur.config)
        .then((r) => setPlans((ps) => ps.map((p) => (p.id === r.id ? { id: r.id, name: r.name, updated_at: r.updated_at } : p))))
        .catch(notifyError('Autosave failed'));
    }
    setSchedule(null); // the old plan's schedule must not render against the new plan
    api
      .getPlan(id)
      .then((r) => setDoc({ id: r.id, config: r.config, dirty: false }))
      .catch(notifyError('Could not load plan'));
  }, []);

  useEffect(() => {
    api
      .listPlans()
      .then((ps) => {
        setPlans(ps);
        if (ps[0]) openPlan(ps[0].id);
      })
      .catch(notifyError('Could not reach the backend'));
  }, [openPlan]);

  // Recompute the schedule whenever the (debounced) plan changes. Latest request wins.
  const debouncedConfig = debounced?.config;
  useEffect(() => {
    if (!debouncedConfig) return;
    const seq = ++scheduleSeq.current;
    api
      .schedule(debouncedConfig)
      .then((r) => {
        if (seq !== scheduleSeq.current) return;
        setSchedule(r);
        setScheduleError(null);
      })
      .catch((e: Error) => seq === scheduleSeq.current && setScheduleError(e.message));
  }, [debouncedConfig]);

  // Autosave.
  useEffect(() => {
    if (!debounced?.dirty) return;
    const { id, config } = debounced;
    setSaving('saving');
    api
      .updatePlan(id, config)
      .then((r) => {
        setSaving('idle');
        setPlans((ps) => ps.map((p) => (p.id === id ? { id, name: r.name, updated_at: r.updated_at } : p)));
        setDoc((cur) => (cur && cur.id === id && cur.config === config ? { ...cur, dirty: false } : cur));
      })
      .catch((e: Error) => {
        setSaving('error');
        notifyError('Autosave failed')(e);
      });
  }, [debounced]);

  const update: PlanUpdate = useCallback(
    (updater) => setDoc((cur) => (cur ? { ...cur, config: updater(cur.config), dirty: true } : cur)),
    [],
  );

  const addPlan = (config?: PlanConfig) =>
    api
      .createPlan(config)
      .then((r) => {
        setPlans((ps) => [{ id: r.id, name: r.name, updated_at: r.updated_at }, ...ps]);
        setDoc({ id: r.id, config: r.config, dirty: false });
      })
      .catch(notifyError('Could not create plan'));

  const removePlan = () => {
    if (!doc) return;
    deleteModal.close();
    api
      .deletePlan(doc.id)
      .then(() => {
        const rest = plans.filter((p) => p.id !== doc.id);
        setPlans(rest);
        docRef.current = null; // deleted: nothing to flush
        setDoc(null);
        setSchedule(null);
        if (rest[0]) openPlan(rest[0].id);
      })
      .catch(notifyError('Could not delete plan'));
  };

  const plan = doc?.config;
  const saveLabel =
    saving === 'error' ? 'Save failed' : doc?.dirty || saving === 'saving' ? 'Saving…' : 'All changes saved';

  return (
    <AppShell header={{ height: 64 }} padding="md">
      <AppShell.Header px="md">
        <Group h="100%" justify="space-between" wrap="nowrap">
          <Group gap="sm" wrap="nowrap">
            <IconDiamond size={28} stroke={1.6} color="var(--mantine-color-indigo-6)" />
            <Title order={3} visibleFrom="sm">
              Dark Period Scheduler
            </Title>
            <Select
              ml="md"
              w={240}
              placeholder="Select plan"
              data={plans.map((p) => ({ value: p.id, label: p.name }))}
              value={doc?.id ?? null}
              onChange={(id) => id && openPlan(id)}
              allowDeselect={false}
              comboboxProps={{ withinPortal: true }}
            />
            <Menu position="bottom-start" shadow="md">
              <Menu.Target>
                <ActionIcon variant="default" size="lg" aria-label="Plan actions">
                  <IconDots size={18} />
                </ActionIcon>
              </Menu.Target>
              <Menu.Dropdown>
                <Menu.Item leftSection={<IconPlus size={16} />} onClick={() => addPlan()}>
                  New plan from defaults
                </Menu.Item>
                <Menu.Item
                  leftSection={<IconCopy size={16} />}
                  disabled={!plan}
                  onClick={() => plan && addPlan({ ...plan, name: `${plan.name} (copy)` })}
                >
                  Duplicate plan
                </Menu.Item>
                <Menu.Divider />
                <Menu.Item
                  color="red"
                  leftSection={<IconTrash size={16} />}
                  disabled={!plan}
                  onClick={deleteModal.open}
                >
                  Delete plan
                </Menu.Item>
              </Menu.Dropdown>
            </Menu>
            {doc && (
              <Badge
                variant="light"
                color={saving === 'error' ? 'red' : doc.dirty || saving === 'saving' ? 'yellow' : 'teal'}
                visibleFrom="md"
              >
                {saveLabel}
              </Badge>
            )}
          </Group>
          <Group gap="sm" wrap="nowrap">
            <Tooltip label="Which duration to use for each stage: min / typical / max" withArrow>
              <SegmentedControl
                value={scenario}
                onChange={(v) => setScenario(v as Scenario)}
                data={[
                  { value: 'optimistic', label: 'Optimistic' },
                  { value: 'typical', label: 'Typical' },
                  { value: 'pessimistic', label: 'Pessimistic' },
                ]}
              />
            </Tooltip>
            <ColorSchemeToggle />
          </Group>
        </Group>
      </AppShell.Header>

      <AppShell.Main>
        {!plan ? (
          <Center h="60vh">
            {plans.length === 0 ? (
              <Stack align="center">
                <Text c="dimmed">No plans yet.</Text>
                <Button leftSection={<IconPlus size={16} />} onClick={() => addPlan()}>
                  Create a plan
                </Button>
              </Stack>
            ) : (
              <Loader />
            )}
          </Center>
        ) : (
          <Stack gap="md">
            {scheduleError && (
              <Alert color="red" icon={<IconAlertTriangle />} title="This plan can't be scheduled">
                {scheduleError}
              </Alert>
            )}
            {schedule && <SummaryStrip plan={plan} schedule={schedule} scenario={scenario} />}
            {schedule && schedule.scenarios[scenario].warnings.length > 0 && (
              <Alert color="yellow" variant="light" icon={<IconAlertTriangle />} p="sm">
                <Stack gap={2}>
                  {schedule.scenarios[scenario].warnings.map((w) => (
                    <Text size="sm" key={w}>
                      {w}
                    </Text>
                  ))}
                </Stack>
              </Alert>
            )}

            <Tabs value={tab} onChange={setTab} keepMounted={false}>
              <Tabs.List>
                <Tabs.Tab value="timeline" leftSection={<IconTimeline size={16} />}>
                  Timeline
                </Tabs.Tab>
                <Tabs.Tab value="shipments" leftSection={<IconTruckDelivery size={16} />}>
                  Shipments
                </Tabs.Tab>
                <Tabs.Tab value="workload" leftSection={<IconCalendarStats size={16} />}>
                  Workload
                </Tabs.Tab>
                <Tabs.Tab value="stages" leftSection={<IconStack2 size={16} />} ml="auto">
                  Stages
                </Tabs.Tab>
                <Tabs.Tab value="batches" leftSection={<IconFlask size={16} />}>
                  Batches
                </Tabs.Tab>
                <Tabs.Tab value="facilities" leftSection={<IconBuildingFactory2 size={16} />}>
                  Facilities & downtime
                </Tabs.Tab>
                <Tabs.Tab value="plan" leftSection={<IconSettings size={16} />}>
                  Plan
                </Tabs.Tab>
              </Tabs.List>

              <Tabs.Panel value="timeline" pt="md">
                {schedule ? <Timeline plan={plan} schedule={schedule} scenario={scenario} /> : <Loader />}
              </Tabs.Panel>
              <Tabs.Panel value="shipments" pt="md">
                {schedule && <ShipmentsView plan={plan} result={schedule.scenarios[scenario]} />}
              </Tabs.Panel>
              <Tabs.Panel value="workload" pt="md">
                {schedule && <WorkloadView plan={plan} result={schedule.scenarios[scenario]} />}
              </Tabs.Panel>
              <Tabs.Panel value="stages" pt="md">
                <StagesEditor plan={plan} update={update} />
              </Tabs.Panel>
              <Tabs.Panel value="batches" pt="md">
                <BatchesEditor plan={plan} update={update} />
              </Tabs.Panel>
              <Tabs.Panel value="facilities" pt="md">
                <FacilitiesEditor plan={plan} update={update} />
              </Tabs.Panel>
              <Tabs.Panel value="plan" pt="md">
                <PlanSettings plan={plan} update={update} />
              </Tabs.Panel>
            </Tabs>
          </Stack>
        )}
      </AppShell.Main>

      <Modal opened={confirmDelete} onClose={deleteModal.close} title="Delete plan?" centered>
        <Text size="sm">
          “{plan?.name}” will be permanently deleted. This can’t be undone.
        </Text>
        <Group justify="flex-end" mt="lg">
          <Button variant="default" onClick={deleteModal.close}>
            Cancel
          </Button>
          <Button color="red" onClick={removePlan}>
            Delete
          </Button>
        </Group>
      </Modal>
    </AppShell>
  );
}

function ColorSchemeToggle() {
  const { setColorScheme } = useMantineColorScheme();
  const computed = useComputedColorScheme('light');
  return (
    <ActionIcon
      variant="default"
      size="lg"
      aria-label="Toggle colour scheme"
      onClick={() => setColorScheme(computed === 'light' ? 'dark' : 'light')}
    >
      {computed === 'light' ? <IconMoon size={18} /> : <IconSun size={18} />}
    </ActionIcon>
  );
}
