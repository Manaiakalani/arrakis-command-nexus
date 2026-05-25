'use client';

import { AlertTriangle, FileText, Info, RotateCcw, Save } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import type { ConfigFile, ConfigField } from '@/lib/types';
import { cn } from '@/lib/utils';

interface ConfigEditorProps {
  files: ConfigFile[];
  onSave: (filename: string, data: Record<string, string | number | boolean>) => Promise<void> | void;
  onAcceptDrift?: (filename: string) => Promise<void> | void;
}

function fieldKey(field: ConfigField) {
  return `${field.section}.${field.key}`;
}

/** Friendly section names for INI section headers */
const SECTION_LABELS: Record<string, string> = {
  '/Script/Seabass.SBGameMode': 'Game Mode',
  '/Script/Seabass.SBGameState': 'Game State & Ports',
  '/Script/Engine.Engine': 'Engine Core',
  '/Script/OnlineSubsystemUtils.IpNetDriver': 'Network Driver',
  'Battlegroup': 'Battlegroup',
  'InstancingModes': 'Map Instancing Modes',
  'Server': 'Server Defaults',
  'Survival_1': 'Hagga Basin (Survival)',
  'DeepDesert_1': 'Deep Desert',
  'Overmap': 'Overmap (Hub)',
  'AuthenticationConfiguration': 'Authentication',
  'ServerAuthenticationSecrets': 'Auth Secrets',
  'Gateway': 'Gateway',
};

function friendlySection(raw: string): string {
  return SECTION_LABELS[raw] || raw.replace(/[/_]/g, ' ').replace(/\bScript\b/gi, '').replace(/\s+/g, ' ').trim();
}

export function ConfigEditor({ files, onSave, onAcceptDrift }: ConfigEditorProps) {
  const [selected, setSelected] = useState(files[0]?.filename ?? '');
  const [drafts, setDrafts] = useState<Record<string, Record<string, string | number | boolean>>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (files.length > 0 && !selected) {
      setSelected(files[0].filename);
    }
  }, [files, selected]);

  useEffect(() => {
    const nextDrafts = files.reduce<Record<string, Record<string, string | number | boolean>>>((accumulator, file) => {
      accumulator[file.filename] = file.fields.reduce<Record<string, string | number | boolean>>((fieldAccumulator, field) => {
        fieldAccumulator[fieldKey(field)] = field.value;
        return fieldAccumulator;
      }, {});
      return accumulator;
    }, {});

    setDrafts(nextDrafts);
  }, [files]);

  const activeFile = useMemo(() => files.find((file) => file.filename === selected) ?? files[0], [files, selected]);

  const sections = useMemo(() => {
    if (!activeFile) {
      return [] as Array<[string, ConfigField[]]>;
    }

    return Object.entries(
      activeFile.fields.reduce<Record<string, ConfigField[]>>((accumulator, field) => {
        if (!accumulator[field.section]) {
          accumulator[field.section] = [];
        }
        accumulator[field.section].push(field);
        return accumulator;
      }, {}),
    );
  }, [activeFile]);

  const dirtyCount = useMemo(() => {
    if (!activeFile) return 0;
    const original = activeFile.fields.reduce<Record<string, string | number | boolean>>((acc, f) => {
      acc[fieldKey(f)] = f.value;
      return acc;
    }, {});
    const draft = drafts[activeFile.filename] ?? {};
    return Object.keys(draft).filter((k) => String(draft[k]) !== String(original[k])).length;
  }, [activeFile, drafts]);

  const updateField = (field: ConfigField, value: string | number | boolean) => {
    if (!activeFile) {
      return;
    }

    setDrafts((current) => ({
      ...current,
      [activeFile.filename]: {
        ...current[activeFile.filename],
        [fieldKey(field)]: value,
      },
    }));
  };

  const isFieldModified = (field: ConfigField): boolean => {
    if (!activeFile) return false;
    const draft = drafts[activeFile.filename]?.[fieldKey(field)];
    return draft !== undefined && String(draft) !== String(field.value);
  };

  const renderField = (field: ConfigField) => {
    if (!activeFile) {
      return null;
    }

    const value = drafts[activeFile.filename]?.[fieldKey(field)] ?? field.value;
    const modified = isFieldModified(field);
    const defaultHint = field.defaultValue != null ? `Default: ${field.defaultValue}` : undefined;

    if (field.type === 'boolean') {
      return (
        <div className={cn(
          'rounded-2xl border bg-th-surface-s/60 px-4 py-3 transition-colors',
          modified ? 'border-amber-500/40 bg-amber-500/5' : 'border-th-border/70',
        )}>
          <label className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <p className="font-medium text-th-text">
                {field.label}
                {modified ? <span className="ml-2 text-xs text-amber-600 dark:text-amber-300">modified</span> : null}
              </p>
              {field.description ? <p className="mt-1 text-sm text-th-text-m">{field.description}</p> : null}
              {defaultHint ? <p className="mt-1 text-xs text-th-text-m/60">{defaultHint}</p> : null}
            </div>
            <div className="relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border-2 border-transparent transition-colors cursor-pointer"
              style={{ backgroundColor: Boolean(value) ? 'rgb(245, 158, 11)' : 'rgb(107, 114, 128)' }}
            >
              <input
                type="checkbox"
                checked={Boolean(value)}
                onChange={(event) => updateField(field, event.target.checked)}
                className="sr-only"
              />
              <span className={cn(
                'pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition-transform',
                Boolean(value) ? 'translate-x-5' : 'translate-x-0',
              )} />
            </div>
          </label>
        </div>
      );
    }

    if (field.type === 'select') {
      const options = field.options ?? [];
      const currentStr = String(value);
      const hasCurrentValue = options.some((o) => o.value === currentStr);
      return (
        <div className={cn(
          'rounded-2xl border bg-th-surface-s/60 px-4 py-3 transition-colors',
          modified ? 'border-amber-500/40 bg-amber-500/5' : 'border-th-border/70',
        )}>
          <label className="mb-2 block text-sm font-medium text-th-text">
            {field.label}
            {modified ? <span className="ml-2 text-xs text-amber-600 dark:text-amber-300">modified</span> : null}
          </label>
          <select className="dune-input" value={currentStr} onChange={(event) => updateField(field, event.target.value)}>
            {!hasCurrentValue ? (
              <option value={currentStr}>{currentStr} (custom)</option>
            ) : null}
            {options.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
          {field.description ? <p className="mt-2 text-sm text-th-text-m">{field.description}</p> : null}
          {defaultHint ? <p className="mt-1 text-xs text-th-text-m/60">{defaultHint}</p> : null}
        </div>
      );
    }

    return (
      <div className={cn(
        'rounded-2xl border bg-th-surface-s/60 px-4 py-3 transition-colors',
        modified ? 'border-amber-500/40 bg-amber-500/5' : 'border-th-border/70',
      )}>
        <label className="mb-2 block text-sm font-medium text-th-text">
          {field.label}
          {modified ? <span className="ml-2 text-xs text-amber-600 dark:text-amber-300">modified</span> : null}
        </label>
        <input
          className="dune-input"
          type={field.type === 'number' ? 'number' : 'text'}
          value={String(value)}
          placeholder={field.placeholder}
          onChange={(event) => updateField(field, field.type === 'number' ? Number(event.target.value) : event.target.value)}
        />
        {field.description ? <p className="mt-2 text-sm text-th-text-m">{field.description}</p> : null}
        {defaultHint ? <p className="mt-1 text-xs text-th-text-m/60">{defaultHint}</p> : null}
      </div>
    );
  };

  const handleSave = async () => {
    if (!activeFile) {
      return;
    }

    if (!window.confirm(`Save changes to ${activeFile.filename}? A service restart is needed for changes to take effect.`)) {
      return;
    }

    setSaving(true);
    try {
      await onSave(activeFile.filename, drafts[activeFile.filename] ?? {});
    } finally {
      setSaving(false);
    }
  };

  const handleAcceptDrift = async () => {
    if (!activeFile || !onAcceptDrift) {
      return;
    }

    await onAcceptDrift(activeFile.filename);
  };

  return (
    <div className="glass-panel overflow-hidden">
      {/* File tabs */}
      <div className="border-b border-th-border-m/80 p-4 sm:p-5">
        <div className="flex flex-wrap gap-2">
          {files.map((file) => {
            const drifted = file.drift?.drifted;
            return (
              <button
                key={file.filename}
                type="button"
                onClick={() => setSelected(file.filename)}
                className={cn(
                  'inline-flex flex-col items-start gap-0.5 rounded-2xl border px-4 py-2.5 text-left transition-[color,background-color,border-color]',
                  selected === file.filename
                    ? 'border-amber-500/40 bg-amber-500/15 text-amber-700 dark:text-amber-200'
                    : 'border-th-border bg-th-surface-s/70 text-th-text-m hover:text-th-text-s',
                  drifted && selected !== file.filename && 'border-amber-500/30 bg-amber-500/5',
                )}
              >
                <span className="flex items-center gap-2 text-sm font-medium">
                  <FileText className="h-3.5 w-3.5" />
                  {file.title || file.filename}
                  {drifted ? (
                    <span className="rounded-full border border-amber-400/40 bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold text-amber-700 dark:text-amber-200">
                      Drifted
                    </span>
                  ) : null}
                </span>
                {file.subtitle ? (
                  <span className="text-[11px] text-th-text-m">{file.subtitle}</span>
                ) : null}
              </button>
            );
          })}
        </div>

        {/* File description */}
        {activeFile?.description ? (
          <div className="mt-4 flex items-start gap-3 rounded-2xl border border-th-border/60 bg-th-surface-s/40 px-4 py-3 text-sm text-th-text-m">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-th-text-m/60" />
            <span>{activeFile.description}</span>
          </div>
        ) : null}

        {/* Drift warning */}
        {activeFile?.drift?.drifted ? (
          <div className="mt-4 flex flex-col gap-3 rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-800 dark:text-amber-100 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-300" />
              <div>
                <p className="font-medium text-amber-800 dark:text-amber-100">This file has been modified since the last accepted baseline</p>
                <p className="mt-1 text-xs text-amber-800/70 dark:text-amber-100/70">
                  Baseline: {activeFile.drift.baselineHash || 'none'} &rarr; Current: {activeFile.drift.currentHash || 'unknown'}
                </p>
              </div>
            </div>
            {onAcceptDrift ? (
              <button
                type="button"
                onClick={() => void handleAcceptDrift()}
                className="inline-flex items-center gap-2 rounded-full border border-amber-400/40 bg-amber-500/15 px-4 py-2 text-sm font-semibold text-amber-800 dark:text-amber-100 transition hover:bg-amber-500/20"
              >
                <RotateCcw className="h-3.5 w-3.5" /> Accept as new baseline
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      {/* Settings */}
      <div className="space-y-6 p-4 sm:p-5">
        {sections.map(([section, fields]) => (
          <div key={section} className="rounded-3xl border border-th-border-m/80 bg-th-bg-s/40 p-5">
            <div className="mb-5">
              <p className="section-title">Section</p>
              <h3 className="mt-1 text-lg font-semibold text-th-text">{friendlySection(section)}</h3>
              <p className="mt-1 text-xs font-mono text-th-text-m/50">[{section}]</p>
            </div>
            <div className="grid gap-4 lg:grid-cols-2">
              {fields.map((field) => (
                <div key={fieldKey(field)} className={cn(field.type === 'textarea' && 'lg:col-span-2')}>
                  {renderField(field)}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Save bar */}
      <div className="border-t border-th-border-m/80 p-4 sm:p-5 flex items-center gap-4">
        <button type="button" onClick={() => void handleSave()} disabled={saving} className="dune-button">
          <Save className="mr-2 h-4 w-4" /> {saving ? 'Saving...' : 'Save configuration'}
        </button>
        {dirtyCount > 0 ? (
          <span className="text-sm text-amber-600 dark:text-amber-300">
            {dirtyCount} unsaved change{dirtyCount === 1 ? '' : 's'}
          </span>
        ) : null}
      </div>
    </div>
  );
}
