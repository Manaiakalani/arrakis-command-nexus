'use client';

import { AlertTriangle, Save } from 'lucide-react';
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

export function ConfigEditor({ files, onSave, onAcceptDrift }: ConfigEditorProps) {
  const [selected, setSelected] = useState(files[0]?.filename ?? '');
  const [drafts, setDrafts] = useState<Record<string, Record<string, string | number | boolean>>>({});

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

  const renderField = (field: ConfigField) => {
    if (!activeFile) {
      return null;
    }

    const value = drafts[activeFile.filename]?.[fieldKey(field)] ?? field.value;

    if (field.type === 'boolean') {
      return (
        <label className="flex items-center justify-between rounded-2xl border border-th-border/70 bg-th-surface-s/60 px-4 py-3">
          <div>
            <p className="font-medium text-th-text">{field.label}</p>
            {field.description ? <p className="mt-1 text-sm text-th-text-m">{field.description}</p> : null}
          </div>
          <input
            type="checkbox"
            checked={Boolean(value)}
            onChange={(event) => updateField(field, event.target.checked)}
            className="h-5 w-5 rounded accent-amber-400"
          />
        </label>
      );
    }

    if (field.type === 'select') {
      return (
        <div>
          <label className="mb-2 block text-sm font-medium text-th-text" title={field.description}>{field.label}</label>
          <select className="dune-input" value={String(value)} onChange={(event) => updateField(field, event.target.value)}>
            {(field.options ?? []).map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
          {field.description ? <p className="mt-2 text-sm text-th-text-m">{field.description}</p> : null}
        </div>
      );
    }

    if (field.type === 'textarea') {
      return (
        <div>
          <label className="mb-2 block text-sm font-medium text-th-text" title={field.description}>{field.label}</label>
          <textarea
            className="dune-input min-h-[140px]"
            value={String(value)}
            placeholder={field.placeholder}
            onChange={(event) => updateField(field, event.target.value)}
          />
          {field.description ? <p className="mt-2 text-sm text-th-text-m">{field.description}</p> : null}
        </div>
      );
    }

    return (
      <div>
        <label className="mb-2 block text-sm font-medium text-th-text" title={field.description}>{field.label}</label>
        <input
          className="dune-input"
          type={field.type === 'number' ? 'number' : 'text'}
          value={String(value)}
          placeholder={field.placeholder}
          onChange={(event) => updateField(field, field.type === 'number' ? Number(event.target.value) : event.target.value)}
        />
        {field.description ? <p className="mt-2 text-sm text-th-text-m">{field.description}</p> : null}
      </div>
    );
  };

  const handleSave = async () => {
    if (!activeFile) {
      return;
    }

    if (!window.confirm(`Save changes to ${activeFile.filename}?`)) {
      return;
    }

    await onSave(activeFile.filename, drafts[activeFile.filename] ?? {});
  };

  const handleAcceptDrift = async () => {
    if (!activeFile || !onAcceptDrift) {
      return;
    }

    await onAcceptDrift(activeFile.filename);
  };

  return (
    <div className="glass-panel overflow-hidden">
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
                  'inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium transition-[color,background-color,border-color]',
                  selected === file.filename
                    ? 'border-amber-500/40 bg-amber-500/15 text-amber-200'
                    : 'border-th-border bg-th-surface-s/70 text-th-text-m hover:text-th-text-s',
                  drifted && 'border-amber-500/50 bg-amber-500/10 text-amber-100',
                )}
              >
                <span>{file.filename}</span>
                {drifted ? (
                  <span className="rounded-full border border-amber-400/40 bg-amber-500/15 px-2 py-0.5 text-xs font-semibold text-amber-200">
                    Drifted
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
        <div className="mt-4 rounded-2xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
          Changes will be applied after restart. Save carefully before rotating the active shards.
        </div>
        {activeFile?.drift?.drifted ? (
          <div className="mt-4 flex flex-col gap-3 rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
              <div>
                <p className="font-medium text-amber-100">Config has changed since last baseline</p>
                <p className="mt-1 text-amber-100/80">
                  Baseline {activeFile.drift.baselineHash || 'none'} · Current {activeFile.drift.currentHash || 'missing'}
                </p>
              </div>
            </div>
            {onAcceptDrift ? (
              <button
                type="button"
                onClick={() => void handleAcceptDrift()}
                className="rounded-full border border-amber-400/40 bg-amber-500/15 px-4 py-2 text-sm font-semibold text-amber-100 transition hover:bg-amber-500/20"
              >
                Accept Changes
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
      <div className="space-y-6 p-4 sm:p-5">
        {sections.map(([section, fields]) => (
          <div key={section} className="rounded-3xl border border-th-border-m/80 bg-th-bg-s/40 p-5">
            <div className="mb-5 flex items-center justify-between gap-3">
              <div>
                <p className="section-title">Section</p>
                <h3 className="mt-1 text-lg font-semibold text-th-text">{section}</h3>
              </div>
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
      <div className="border-t border-th-border-m/80 p-4 sm:p-5">
        <button type="button" onClick={() => void handleSave()} className="dune-button">
          <Save className="mr-2 h-4 w-4" /> Save configuration
        </button>
      </div>
    </div>
  );
}
