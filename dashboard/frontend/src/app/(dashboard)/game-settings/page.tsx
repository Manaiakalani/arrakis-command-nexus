'use client';

import {
  AlertTriangle,
  Bug,
  CheckCircle2,
  ChevronDown,
  Home,
  Loader2,
  Pickaxe,
  RotateCcw,
  Save,
  SlidersHorizontal,
  Swords,
  TrendingUp,
  Wifi,
  Wind,
  Worm,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { Skeleton } from '@/components/Skeleton';
import { useToast } from '@/components/ToastProvider';
import { useApi } from '@/hooks/useApi';
import { apiClient } from '@/lib/api';
import type { ConfigField } from '@/lib/types';
import { cn } from '@/lib/utils';

type SectionId = 'combat' | 'crafting' | 'progression' | 'storms' | 'survival' | 'connectivity';
type DraftValue = string | number | boolean;

type SettingSection = {
  id: SectionId;
  title: string;
  description: string;
  icon: typeof Swords;
  keys: string[];
};

const GAME_CONFIG = 'UserGame.ini';

function fieldKey(field: ConfigField) {
  return `${field.section}.${field.key}`;
}

function normalizeValue(value: DraftValue) {
  return String(value);
}

function areConfigValuesEqual(first: DraftValue | string, second: DraftValue | string) {
  const firstValue = String(first).trim();
  const secondValue = String(second).trim();
  if (firstValue === secondValue) return true;
  if (['true', 'false'].includes(firstValue.toLowerCase()) || ['true', 'false'].includes(secondValue.toLowerCase())) {
    return firstValue.toLowerCase() === secondValue.toLowerCase();
  }
  if (firstValue !== '' && secondValue !== '') {
    const firstNumber = Number(firstValue);
    const secondNumber = Number(secondValue);
    if (!Number.isNaN(firstNumber) && !Number.isNaN(secondNumber)) return firstNumber === secondNumber;
  }
  return false;
}

function coerceFieldValue(field: ConfigField, value: string): DraftValue {
  if (field.type === 'boolean') {
    return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
  }
  if (field.type === 'number') {
    const numericValue = Number(value);
    return Number.isNaN(numericValue) ? value : numericValue;
  }
  return value;
}

function hasDefaultValue(field: ConfigField) {
  return field.defaultValue != null;
}

function isDefaultValue(field: ConfigField, value: DraftValue) {
  if (!hasDefaultValue(field)) return false;
  return areConfigValuesEqual(coerceFieldValue(field, field.defaultValue ?? ''), value);
}

function validateNumericField(field: ConfigField, value: DraftValue) {
  if (field.type !== 'number') return null;
  const numericValue = Number(value);
  if (Number.isNaN(numericValue)) return `${field.label} must be a number.`;
  if (field.minValue != null && numericValue < Number(field.minValue)) return `${field.label} must be at least ${field.minValue}.`;
  if (field.maxValue != null && numericValue > Number(field.maxValue)) return `${field.label} must be at most ${field.maxValue}.`;
  return null;
}

function useActiveSection(ids: SectionId[]) {
  const [activeSection, setActiveSection] = useState<SectionId>(ids[0]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const headerOffset = 132;
    const elements = ids
      .map((id) => ({ id, el: document.getElementById(id) }))
      .filter((entry): entry is { id: SectionId; el: HTMLElement } => entry.el !== null);

    if (elements.length === 0) return;

    const onScroll = () => {
      const y = window.scrollY + headerOffset;
      let current = elements[0].id;
      for (const { id, el } of elements) {
        if (el.offsetTop <= y) current = id;
      }
      setActiveSection((prev) => (prev === current ? prev : current));
    };

    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [ids]);

  return [activeSection, setActiveSection] as const;
}

export default function GameSettingsPage() {
  const { toast } = useToast();
  const config = useApi(() => apiClient.getConfig(GAME_CONFIG), { initialData: null });
  const [drafts, setDrafts] = useState<Record<string, DraftValue>>({});
  const [openSections, setOpenSections] = useState<Record<SectionId, boolean>>({
    combat: true,
    crafting: true,
    progression: true,
    storms: true,
    survival: true,
    connectivity: true,
  });
  const [savingSection, setSavingSection] = useState<SectionId | null>(null);

  const sections = useMemo<SettingSection[]>(() => ([
    {
      id: 'combat',
      title: 'Combat & PvP',
      description: 'Tune PvP rules, safety zones, and global combat pacing.',
      icon: Swords,
      keys: [
        'm_bShouldForceEnablePvpOnAllPartitions',
        'm_bAreSecurityZonesEnabled',
        'm_bShouldPlayersDropLootOnDeath',
        'm_bShouldPlayersLoseItemsOnDeath',
        'm_bShouldNpcDropLootOnDeath',
        'm_ThreatDecayPerSecond',
        'm_MaxReinforcementSize',
      ],
    },
    {
      id: 'crafting',
      title: 'Harvesting & Crafting',
      description: 'Adjust verified resource, repair, recycling, exchange, and augmentation knobs.',
      icon: Pickaxe,
      keys: [
        '+Dune.GlobalMiningOutputMultiplier',
        '+Dune.GlobalVehicleMiningOutputMultiplier',
        'm_RepairCostWeight',
        'm_RecyclerOutputWeight',
        '+SecurityZones.PvpResourceMultiplier',
        'SellOrderPricePercentageFee',
        'm_MinimumAugmentableItemQuality',
      ],
    },
    {
      id: 'progression',
      title: 'Guilds & Access',
      description: 'Shape guild caps, creation cost, and actor permission limits.',
      icon: TrendingUp,
      keys: [
        'm_MaxGuildMembersAllowed',
        'm_MaxGuildsAllowed',
        'm_GuildCreationCost',
        'm_MaxPermissionsPerActor',
      ],
    },
    {
      id: 'storms',
      title: 'Storms & Sandworms',
      description: 'Control Coriolis cadence, sandstorm damage mitigation, and Shai-Hulud pressure.',
      icon: Wind,
      keys: [
        'm_bCoriolisAutoSpawnEnabled',
        'm_bAutoSpawnEnabled',
        '+Sandstorm.Enabled',
        '+Sandstorm.Treasure.Enabled',
        'm_bMitigateAllSandstormDamage',
        'm_bGiantWormSystemEnabled',
        'm_EnableSandwormSystem',
        '+sandworm.dune.Enabled',
        '+Vehicle.SandwormCollisionInteraction',
        '+Sandworm.SandwormDangerZonesEnabled',
        'm_GiantWormMinimumPlayersOnSpiceField',
        'm_GiantWormSpawningCooldown',
        'm_MinDistanceBetweenSandworms',
      ],
    },
    {
      id: 'survival',
      title: 'Survival & Bases',
      description: 'Balance hydration, day length, inventory starts, base limits, backups, and vehicle hazards.',
      icon: Home,
      keys: [
        'm_bHydrationEnabled',
        'm_DayLengthMinutes',
        'PlayerInventoryStartingSize',
        'PlayerInventoryStartingVolumeCapacity',
        'UpdateRateInSeconds',
        'm_BuildingBlueprintMaxExtensions',
        'm_MaxNumLandclaimSegments',
        'm_BaseBackupMaxExtensions',
        'm_BaseBackupToolTimeRestrictionInSeconds',
        'm_bBuildingRestrictionLimitsEnabled',
        'm_VehicleQuicksandDamage',
        '+dw.VehicleDurabilityDamageMultiplier',
        'm_bIsDbWipeEnabled',
      ],
    },
    {
      id: 'connectivity',
      title: 'Connectivity & Travel Recovery',
      description: 'Control how long disconnected players persist before their slot is released, per map type.',
      icon: Wifi,
      keys: [
        'm_DefaultReconnectGracePeriodSeconds',
        'm_OvermapReturnGracePeriodSeconds',
        'm_InstancedMapReconnectGracePeriodSeconds',
      ],
    },
  ]), []);

  const sectionIds = useMemo(() => sections.map((section) => section.id), [sections]);
  const [activeSection, setActiveSection] = useActiveSection(sectionIds);

  useEffect(() => {
    if (!config.data) return;

    setDrafts(config.data.fields.reduce<Record<string, DraftValue>>((acc, field) => {
      acc[fieldKey(field)] = field.value;
      return acc;
    }, {}));
  }, [config.data]);

  const fieldsByKey = useMemo(() => {
    return (config.data?.fields ?? []).reduce<Record<string, ConfigField>>((acc, field) => {
      acc[field.key] = field;
      return acc;
    }, {});
  }, [config.data?.fields]);

  const groupedSections = useMemo(() => sections.map((section) => ({
    ...section,
    fields: section.keys.map((key) => fieldsByKey[key]).filter((field): field is ConfigField => Boolean(field)),
  })), [fieldsByKey, sections]);

  const dirtyBySection = useMemo(() => groupedSections.reduce<Record<SectionId, number>>((acc, section) => {
    acc[section.id] = section.fields.filter((field) => {
      const key = fieldKey(field);
      return drafts[key] !== undefined && !areConfigValuesEqual(drafts[key], field.value);
    }).length;
    return acc;
  }, {} as Record<SectionId, number>), [drafts, groupedSections]);

  const totalDirtyCount = useMemo(() => Object.values(dirtyBySection).reduce((sum, n) => sum + n, 0), [dirtyBySection]);

  useEffect(() => {
    if (totalDirtyCount > 0) {
      const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); };
      window.addEventListener('beforeunload', handler);
      return () => window.removeEventListener('beforeunload', handler);
    }
  }, [totalDirtyCount]);

  const jumpToSection = useCallback((id: SectionId) => {
    const element = document.getElementById(id);
    if (!element) return;

    const prefersReducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    element.scrollIntoView({ behavior: prefersReducedMotion ? 'auto' : 'smooth', block: 'start' });
    setActiveSection(id);
    setOpenSections((current) => ({ ...current, [id]: true }));
  }, [setActiveSection]);

  const updateField = useCallback((field: ConfigField, value: DraftValue) => {
    setDrafts((current) => ({ ...current, [fieldKey(field)]: value }));
  }, []);

  const saveSection = useCallback(async (section: SettingSection & { fields: ConfigField[] }) => {
    const payload = section.fields.reduce<Record<string, DraftValue>>((acc, field) => {
      const key = fieldKey(field);
      const draftValue = drafts[key] ?? field.value;
      if (!areConfigValuesEqual(draftValue, field.value)) {
        acc[key] = draftValue;
      }
      return acc;
    }, {});

    if (Object.keys(payload).length === 0) {
      toast(`${section.title} has no unsaved changes.`, 'info');
      return;
    }

    const validationError = section.fields
      .map((field) => validateNumericField(field, drafts[fieldKey(field)] ?? field.value))
      .find((error): error is string => error != null);
    if (validationError) {
      toast(validationError, 'error');
      return;
    }

    setSavingSection(section.id);
    try {
      await apiClient.updateConfig(GAME_CONFIG, payload);
      await config.refetch();
      toast(`${section.title} saved. Restart the service for changes to take effect.`, 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to save section.';
      toast(`Failed to save ${section.title}: ${message}`, 'error');
    } finally {
      setSavingSection(null);
    }
  }, [config, drafts, toast]);

  if (config.loading && !config.data) {
    return <GameSettingsSkeleton />;
  }

  if (config.error) {
    return (
      <div className="glass-panel p-6">
        <div className="flex items-start gap-3 text-red-700 dark:text-red-300">
          <AlertTriangle aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0" />
          <div>
            <p className="font-semibold">Unable to load game settings</p>
            <p className="mt-1 text-sm text-th-text-m">{config.error.message}</p>
          </div>
        </div>
      </div>
    );
  }

  const visibleFieldCount = groupedSections.reduce((sum, section) => sum + section.fields.length, 0);

  return (
    <div className="space-y-6">
      <header className="glass-panel p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="section-title">Curated gameplay controls</p>
            <h1 className="mt-1 text-2xl font-semibold text-th-text">Game Settings</h1>
            <p className="mt-2 max-w-3xl text-sm text-th-text-m">
              Fast access to the highest-impact Arrakis gameplay knobs. Every setting here has been verified against the shipped server binary and is applied on save. The raw .ini editor remains available under Configuration for power users; see <code className="rounded bg-th-surface-s/60 px-1.5 py-0.5 text-xs">docs/CONFIG_KEYS.md</code> for the full cross-source audit covering claimed-but-unverified keys.
            </p>
          </div>
          <div className="flex flex-wrap gap-2 text-xs font-medium text-th-text-m">
            <span className="inline-flex items-center gap-2 rounded-full border border-th-border bg-th-surface-s/60 px-3 py-1.5">
              <SlidersHorizontal aria-hidden="true" className="h-3.5 w-3.5" />
              {visibleFieldCount} available settings
            </span>
            <span className="inline-flex items-center gap-2 rounded-full border border-th-border bg-th-surface-s/60 px-3 py-1.5">
              <CheckCircle2 aria-hidden="true" className="h-3.5 w-3.5 text-emerald-500" />
              Saves to {GAME_CONFIG}
            </span>
          </div>
        </div>
      </header>

      <nav
        aria-label="Game settings sections"
        role="tablist"
        className="sticky top-4 z-20 -mx-1 flex gap-2 overflow-x-auto rounded-2xl border border-th-border/70 bg-th-bg/90 p-2 shadow-lg shadow-black/5 backdrop-blur-xl dark:shadow-black/30"
      >
        {groupedSections.map((section) => {
          const Icon = section.icon;
          const dirtyCount = dirtyBySection[section.id] ?? 0;
          const selected = activeSection === section.id;
          return (
            <button
              key={section.id}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={section.id}
              onClick={() => jumpToSection(section.id)}
              className={cn(
                'inline-flex shrink-0 items-center gap-2 rounded-xl border px-3 py-2 text-sm font-medium transition-colors dune-focus',
                selected
                  ? 'border-amber-500/40 bg-amber-500/15 text-amber-700 dark:text-amber-200'
                  : 'border-transparent text-th-text-m hover:border-th-border hover:bg-th-surface-s/70 hover:text-th-text',
              )}
            >
              <Icon className="h-4 w-4" />
              <span>{section.title}</span>
              {dirtyCount > 0 ? (
                <span className="rounded-full border border-amber-500/30 bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold text-amber-700 dark:text-amber-200">
                  Unsaved changes
                </span>
              ) : null}
            </button>
          );
        })}
      </nav>

      <div className="space-y-5">
        {groupedSections.map((section) => (
          <SettingsSection
            key={section.id}
            section={section}
            dirtyCount={dirtyBySection[section.id] ?? 0}
            drafts={drafts}
            isOpen={openSections[section.id]}
            isSaving={savingSection === section.id}
            onToggle={() => setOpenSections((current) => ({ ...current, [section.id]: !current[section.id] }))}
            onChange={updateField}
            onSave={() => saveSection(section)}
          />
        ))}
      </div>

      <div className="sr-only" aria-live="polite" />
    </div>
  );
}

function SettingsSection({
  section,
  dirtyCount,
  drafts,
  isOpen,
  isSaving,
  onToggle,
  onChange,
  onSave,
}: {
  section: SettingSection & { fields: ConfigField[] };
  dirtyCount: number;
  drafts: Record<string, DraftValue>;
  isOpen: boolean;
  isSaving: boolean;
  onToggle: () => void;
  onChange: (field: ConfigField, value: DraftValue) => void;
  onSave: () => void;
}) {
  const Icon = section.icon;
  const SectionAccent = section.id === 'storms' ? Worm ?? Bug : Icon;

  return (
    <section id={section.id} role="tabpanel" className="scroll-mt-32 glass-panel overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isOpen}
        className="flex w-full items-start justify-between gap-4 p-5 text-left transition-colors hover:bg-th-surface-s/50 dune-focus"
      >
        <div className="flex items-start gap-4">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-amber-500/20 bg-amber-500/10 text-amber-600 dark:text-amber-300">
            <SectionAccent className="h-5 w-5" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-semibold text-th-text">{section.title}</h2>
              {dirtyCount > 0 ? (
                <span className="rounded-full border border-amber-500/30 bg-amber-500/15 px-2.5 py-1 text-xs font-semibold text-amber-700 dark:text-amber-200">
                  Unsaved changes
                </span>
              ) : null}
            </div>
            <p className="mt-1 text-sm text-th-text-m">{section.description}</p>
          </div>
        </div>
        <ChevronDown aria-hidden="true" className={cn('mt-2 h-5 w-5 shrink-0 text-th-text-m transition-transform', isOpen && 'rotate-180')} />
      </button>

      {isOpen ? (
        <div className="border-t border-th-border-m/70 p-4 sm:p-5">
          {section.fields.length === 0 ? (
            <p className="rounded-2xl border border-th-border/70 bg-th-surface-s/50 px-4 py-3 text-sm text-th-text-m">
              No matching settings are present in {GAME_CONFIG}; unknown or unavailable keys are skipped.
            </p>
          ) : (
            <div className="divide-y divide-th-border-m/70 overflow-hidden rounded-2xl border border-th-border-m/70 bg-th-surface-s/40">
              {section.fields.map((field) => (
                <SettingRow key={fieldKey(field)} field={field} value={drafts[fieldKey(field)] ?? field.value} onChange={onChange} />
              ))}
            </div>
          )}

          <div className="mt-4 flex justify-end">
            <button type="button" onClick={onSave} disabled={isSaving || section.fields.length === 0} className="dune-button disabled:cursor-not-allowed disabled:opacity-60">
              {isSaving ? <Loader2 aria-hidden="true" className="mr-2 h-4 w-4 animate-spin" /> : <Save aria-hidden="true" className="mr-2 h-4 w-4" />}
              Save section
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function SettingRow({ field, value, onChange }: { field: ConfigField; value: DraftValue; onChange: (field: ConfigField, value: DraftValue) => void }) {
  const hasOptions = (field.options?.length ?? 0) > 0;
  const currentValue = normalizeValue(value);
  const options = field.options ?? [];
  const selectOptions = hasOptions && field.defaultValue != null && !options.some((option) => option.value === field.defaultValue)
    ? [{ value: field.defaultValue, label: `${field.defaultValue} (default)` }, ...options]
    : options;
  const selectedOption = selectOptions.find((option) => areConfigValuesEqual(option.value, currentValue));
  const hasSupportedCurrentValue = !hasOptions || selectedOption != null;
  const showResetToDefault = field.defaultValue != null && !isDefaultValue(field, value);
  const modified = !areConfigValuesEqual(value, field.value);

  return (
    <div className={cn('grid gap-3 px-4 py-4 transition-colors lg:grid-cols-[minmax(0,1fr)_minmax(13rem,18rem)] lg:items-center', modified && 'bg-amber-500/5')}>
      <div className="flex min-w-0 items-start gap-3">
        <div className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-th-border bg-th-bg/70 text-th-text-m">
          <SlidersHorizontal aria-hidden="true" className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <label htmlFor={fieldKey(field)} className="font-medium text-th-text">
            {field.label}
          </label>
          {field.description ? <p className="mt-1 text-sm text-th-text-m">{field.description}</p> : null}
        </div>
      </div>

      <div className="flex flex-col items-end gap-1.5">
        {field.type === 'boolean' ? (
          <button
            id={fieldKey(field)}
            type="button"
            role="switch"
            aria-checked={Boolean(value)}
            onClick={() => onChange(field, !Boolean(value))}
            className={cn(
              'relative inline-flex h-7 w-12 shrink-0 items-center rounded-full border border-transparent transition-colors dune-focus',
              Boolean(value) ? 'bg-amber-500' : 'bg-stone-400/70 dark:bg-slate-500/70',
            )}
          >
            <span className={cn('inline-block h-6 w-6 transform rounded-full bg-white shadow transition-transform', Boolean(value) ? 'translate-x-5' : 'translate-x-0.5')} />
          </button>
        ) : hasOptions ? (
          <select id={fieldKey(field)} className="dune-input w-full max-w-[18rem]" value={selectedOption?.value ?? ''} onChange={(event) => onChange(field, event.target.value)}>
            {!hasSupportedCurrentValue ? <option value="" disabled>Select a supported value</option> : null}
            {selectOptions.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        ) : (
          <input
            id={fieldKey(field)}
            className="dune-input w-full max-w-[18rem]"
            type={field.type === 'number' ? 'number' : 'text'}
            step={field.type === 'number' ? 'any' : undefined}
            min={field.type === 'number' ? field.minValue ?? undefined : undefined}
            max={field.type === 'number' ? field.maxValue ?? undefined : undefined}
            value={currentValue}
            onChange={(event) => onChange(field, event.target.value)}
          />
        )}
        {field.defaultValue != null ? (
          <div className="mt-1.5 flex flex-wrap items-center justify-end gap-x-2 gap-y-1 text-xs text-th-text-m">
            <span>Default: {field.defaultValue}</span>
            {showResetToDefault ? (
              <button
                type="button"
                onClick={() => onChange(field, coerceFieldValue(field, field.defaultValue ?? ''))}
                aria-label="Reset to default value"
                className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-medium text-amber-600 hover:bg-amber-500/10 dune-focus dark:text-amber-300"
              >
                <RotateCcw aria-hidden="true" className="h-3 w-3" /> Reset to default
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function GameSettingsSkeleton() {
  return (
    <div className="space-y-6">
      <div className="glass-panel p-5 space-y-3">
        <Skeleton className="h-3 w-44" />
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-4 w-full max-w-3xl" />
      </div>
      <div className="sticky top-4 z-20 flex gap-2 rounded-2xl border border-th-border/70 bg-th-bg/90 p-2">
        {Array.from({ length: 5 }).map((_, index) => <Skeleton key={index} className="h-10 w-36 rounded-xl" />)}
      </div>
      {Array.from({ length: 3 }).map((_, index) => (
        <div key={index} className="glass-panel p-5 space-y-4">
          <Skeleton className="h-8 w-56" />
          <Skeleton className="h-20 w-full rounded-2xl" />
        </div>
      ))}
    </div>
  );
}
