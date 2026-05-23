'use client';

import {
  AlertTriangle,
  Coins,
  Droplets,
  Flame,
  Loader2,
  Pickaxe,
  RefreshCcw,
  Save,
  Search,
  Shield,
  Swords,
  UserCog,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { useApi } from '@/hooks/useApi';
import { apiClient } from '@/lib/api';
import type { CharacterRecord, CharacterStatField, CharacterStatsSchema } from '@/lib/types';
import { cn } from '@/lib/utils';

type SaveState = {
  tone: 'success' | 'error';
  message: string;
} | null;

type CategoryKey = 'stats' | 'economy' | 'specialization' | 'faction';

const categoryMeta: Record<CategoryKey, { label: string; icon: typeof Droplets; description: string }> = {
  stats: {
    label: 'Stats',
    icon: Droplets,
    description: 'Survival vitals and spice exposure.',
  },
  economy: {
    label: 'Economy',
    icon: Coins,
    description: 'Wallet balances and house-backed resources.',
  },
  specialization: {
    label: 'Specialization',
    icon: Pickaxe,
    description: 'Combat, crafting, scouting, and field training.',
  },
  faction: {
    label: 'Faction',
    icon: Shield,
    description: 'Standing with Arrakis power blocs.',
  },
};

const initialSchema: CharacterStatsSchema = {
  stats: [],
  summary: {
    mutationsEnabled: false,
    editableStats: 0,
    categories: ['stats', 'economy', 'specialization', 'faction'],
  },
};

function buildDraft(character: CharacterRecord | null, fields: CharacterStatField[]) {
  const keys = fields.length > 0 ? fields.map((field) => field.key) : Object.keys(character?.stats ?? {});
  return keys.reduce<Record<string, string>>((acc, key) => {
    const value = character?.stats?.[key];
    acc[key] = value === null || value === undefined ? '' : String(value);
    return acc;
  }, {});
}

function normalizeUpdates(fields: CharacterStatField[], draft: Record<string, string>) {
  return fields.reduce<Record<string, number | string | boolean>>((acc, field) => {
    const raw = draft[field.key];
    if (raw === undefined || raw.trim() === '') {
      return acc;
    }
    if (field.type === 'number') {
      const parsed = Number(raw);
      if (!Number.isNaN(parsed)) {
        acc[field.key] = parsed;
      }
      return acc;
    }
    acc[field.key] = raw;
    return acc;
  }, {});
}

export default function CharactersPage() {
  const characters = useApi(() => apiClient.getCharacters(), { refreshInterval: 30000, initialData: [] });
  const schema = useApi(() => apiClient.getCharacterStatsSchema(), { initialData: initialSchema });
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedCharacter, setSelectedCharacter] = useState<CharacterRecord | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [activeCategory, setActiveCategory] = useState<CategoryKey>('stats');
  const [loadingCharacter, setLoadingCharacter] = useState(false);
  const [characterError, setCharacterError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>(null);
  const [saving, setSaving] = useState(false);

  const filteredCharacters = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (characters.data ?? []).filter((character) => {
      if (!term) {
        return true;
      }
      return [character.name, character.id, character.metadata?.house, character.metadata?.clan]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(term));
    });
  }, [characters.data, search]);

  const availableCategories = useMemo<CategoryKey[]>(() => {
    const categories = schema.data?.summary.categories ?? initialSchema.summary.categories;
    return categories.filter((category): category is CategoryKey => category in categoryMeta);
  }, [schema.data?.summary.categories]);

  const fieldsByCategory = useMemo(() => {
    return (schema.data?.stats ?? []).reduce<Record<CategoryKey, CharacterStatField[]>>(
      (acc, field) => {
        if (field.category in acc) {
          acc[field.category as CategoryKey].push(field);
        }
        return acc;
      },
      {
        stats: [],
        economy: [],
        specialization: [],
        faction: [],
      },
    );
  }, [schema.data?.stats]);

  useEffect(() => {
    if (availableCategories.length === 0) {
      return;
    }
    if (!availableCategories.includes(activeCategory)) {
      setActiveCategory(availableCategories[0]);
    }
  }, [activeCategory, availableCategories]);

  useEffect(() => {
    if (filteredCharacters.length === 0) {
      setSelectedId(null);
      return;
    }
    if (!selectedId || !filteredCharacters.some((character) => character.id === selectedId)) {
      setSelectedId(filteredCharacters[0].id);
    }
  }, [filteredCharacters, selectedId]);

  useEffect(() => {
    if (!selectedId) {
      setSelectedCharacter(null);
      setDraft({});
      return;
    }

    let cancelled = false;
    setLoadingCharacter(true);
    setCharacterError(null);
    void apiClient
      .getCharacter(selectedId)
      .then((character) => {
        if (cancelled) {
          return;
        }
        setSelectedCharacter(character);
        setDraft(buildDraft(character, schema.data?.stats ?? []));
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }
        const fallback = (characters.data ?? []).find((character) => character.id === selectedId) ?? null;
        setSelectedCharacter(fallback);
        setDraft(buildDraft(fallback, schema.data?.stats ?? []));
        setCharacterError(error instanceof Error ? error.message : 'Unable to load character details.');
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingCharacter(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [characters.data, schema.data?.stats, selectedId]);

  const activeFields = fieldsByCategory[activeCategory] ?? [];
  const selectedSource = selectedCharacter?.source ?? 'unknown';
  const mutationsEnabled = schema.data?.summary.mutationsEnabled ?? false;
  const isEmpty = (characters.data ?? []).length === 0;

  const handleReset = async () => {
    if (!selectedId) {
      return;
    }
    setSaveState(null);
    setLoadingCharacter(true);
    try {
      const character = await apiClient.getCharacter(selectedId);
      setSelectedCharacter(character);
      setDraft(buildDraft(character, schema.data?.stats ?? []));
      setCharacterError(null);
    } catch (error) {
      setCharacterError(error instanceof Error ? error.message : 'Unable to reload character.');
    } finally {
      setLoadingCharacter(false);
    }
  };

  const handleSave = async () => {
    if (!selectedId) {
      return;
    }

    setSaving(true);
    setSaveState(null);
    try {
      const updated = await apiClient.updateCharacter(selectedId, normalizeUpdates(schema.data?.stats ?? [], draft));
      setSelectedCharacter(updated);
      setDraft(buildDraft(updated, schema.data?.stats ?? []));
      setSaveState({ tone: 'success', message: `Updated ${updated.name}.` });
      await characters.refetch();
    } catch (error) {
      setSaveState({
        tone: 'error',
        message: error instanceof Error ? error.message : 'Unable to save character changes.',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <div className="metric-card">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="section-title">Roster</p>
              <h2 className="mt-1 text-3xl font-semibold text-th-text">{characters.data?.length ?? 0}</h2>
              <p className="mt-2 text-sm text-th-text-m">Detected characters from the game DB or the safe mock fallback.</p>
            </div>
            <div className="rounded-2xl bg-amber-500/15 p-3 text-amber-300">
              <UserCog className="h-6 w-6" />
            </div>
          </div>
        </div>
        <div className="metric-card">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="section-title">Editable stats</p>
              <h2 className="mt-1 text-3xl font-semibold text-th-text">{schema.data?.summary.editableStats ?? 0}</h2>
              <p className="mt-2 text-sm text-th-text-m">Organized into {availableCategories.length} category views.</p>
            </div>
            <div className="rounded-2xl bg-amber-500/15 p-3 text-amber-300">
              <Swords className="h-6 w-6" />
            </div>
          </div>
        </div>
        <div className="metric-card">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="section-title">Mutation mode</p>
              <h2 className="mt-1 text-3xl font-semibold text-th-text">{mutationsEnabled ? 'Live' : 'Safe'}</h2>
              <p className="mt-2 text-sm text-th-text-m">Writes require DUNE_ADMIN_MUTATIONS_ENABLED=true.</p>
            </div>
            <div className={cn('rounded-2xl p-3', mutationsEnabled ? 'bg-emerald-500/15 text-emerald-300' : 'bg-amber-500/15 text-amber-300')}>
              <AlertTriangle className="h-6 w-6" />
            </div>
          </div>
        </div>
        <div className="metric-card">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="section-title">Selected source</p>
              <h2 className="mt-1 text-3xl font-semibold text-th-text capitalize">{selectedSource}</h2>
              <p className="mt-2 text-sm text-th-text-m">Showing {selectedCharacter?.table ?? 'no active character yet'}.</p>
            </div>
            <div className="rounded-2xl bg-th-surface-s/70 p-3 text-th-text-s">
              <Flame className="h-6 w-6" />
            </div>
          </div>
        </div>
      </section>

      {!mutationsEnabled ? (
        <div className="rounded-3xl border border-amber-500/30 bg-amber-500/10 px-5 py-4 text-sm text-amber-100">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-300" />
            <div>
              <p className="font-semibold text-amber-200">Character editing is in safe preview mode.</p>
              <p className="mt-1 text-amber-100/80">Fields, schema, and DB discovery are live, but saving remains disabled until DUNE_ADMIN_MUTATIONS_ENABLED is set to true.</p>
            </div>
          </div>
        </div>
      ) : null}

      <section className="grid gap-6 xl:grid-cols-[0.8fr_1.2fr]">
        <div className="glass-panel overflow-hidden">
          <div className="border-b border-th-border-m/80 p-5">
            <p className="section-title">Character roster</p>
            <h2 className="mt-1 text-xl font-semibold text-th-text">Search and Select</h2>
            <label className="relative mt-4 block">
              <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-th-text0" />
              <input
                className="dune-input pl-11"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Filter by name, clan, house, or ID"
              />
            </label>
          </div>

          {characters.error ? <p className="px-5 pt-5 text-sm text-red-300">{characters.error.message}</p> : null}

          <div className="max-h-[720px] space-y-3 overflow-y-auto p-4">
            {characters.loading && (characters.data ?? []).length === 0 ? (
              <div className="flex items-center justify-center gap-3 rounded-3xl border border-th-border-m/80 bg-th-bg/30 px-4 py-12 text-th-text-m">
                <Loader2 className="h-5 w-5 animate-spin" /> Loading characters\u2026
              </div>
            ) : null}

            {isEmpty ? (
              <div className="flex min-h-[360px] flex-col items-center justify-center gap-4 rounded-3xl border border-th-border-m/80 bg-th-bg/30 p-8 text-center">
                <UserCog className="h-10 w-10 text-amber-300" />
                <div>
                  <h3 className="text-xl font-semibold text-th-text">No Characters Discovered</h3>
                  <p className="mt-2 max-w-sm text-sm text-th-text-m">The dashboard could not read the game schema yet. Once character tables are exposed, this panel will automatically populate.</p>
                </div>
              </div>
            ) : null}

            {!isEmpty && filteredCharacters.length === 0 ? (
              <div className="rounded-3xl border border-th-border-m/80 bg-th-bg/30 px-4 py-12 text-center text-th-text-m">No characters matched your filter.</div>
            ) : null}

            {filteredCharacters.map((character) => {
              const statCount = Object.values(character.stats ?? {}).filter((value) => value !== null && value !== undefined).length;
              const active = character.id === selectedId;
              return (
                <button
                  key={character.id}
                  type="button"
                  onClick={() => {
                    setSelectedId(character.id);
                    setSaveState(null);
                  }}
                  className={cn(
                    'w-full rounded-3xl border p-4 text-left transition-[color,background-color,border-color,box-shadow] dune-focus',
                    active
                      ? 'border-amber-500/40 bg-amber-500/10 shadow-dune'
                      : 'border-th-border-m/80 bg-th-bg/30 hover:border-th-border hover:bg-th-surface-s/60',
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-base font-semibold text-th-text">{character.name}</p>
                      <p className="mt-1 text-xs uppercase tracking-[0.2em] text-th-text0">{character.id}</p>
                    </div>
                    <span className={cn('rounded-full border px-3 py-1 text-[11px] uppercase tracking-[0.2em]', character.source === 'mock' ? 'border-sky-500/20 bg-sky-500/10 text-sky-200' : 'border-emerald-500/20 bg-emerald-500/10 text-emerald-200')}>
                      {character.source}
                    </span>
                  </div>
                  <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-th-text-m">
                    <span className="rounded-full border border-th-border px-3 py-1">{statCount} mapped stats</span>
                    {character.metadata?.house ? <span className="rounded-full border border-th-border px-3 py-1">{String(character.metadata.house)}</span> : null}
                    {character.metadata?.clan ? <span className="rounded-full border border-th-border px-3 py-1">{String(character.metadata.clan)}</span> : null}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <div className="space-y-6">
          <div className="glass-panel p-5">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <p className="section-title">Character editor</p>
                <h2 className="mt-1 text-2xl font-semibold text-th-text">{selectedCharacter?.name ?? 'No character selected'}</h2>
                <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-th-text-m">
                  {selectedCharacter?.id ? <span className="rounded-full border border-th-border px-3 py-1 uppercase tracking-[0.18em]">{selectedCharacter.id}</span> : null}
                  {selectedCharacter?.table ? <span className="rounded-full border border-th-border px-3 py-1">{selectedCharacter.table}</span> : null}
                  {selectedCharacter?.lastUpdated ? <span className="rounded-full border border-th-border px-3 py-1">Updated {new Date(selectedCharacter.lastUpdated).toLocaleString()}</span> : null}
                </div>
              </div>
              <div className="flex flex-wrap gap-3">
                <button type="button" className="dune-button-muted" onClick={() => void handleReset()} disabled={!selectedId || loadingCharacter}>
                  <RefreshCcw className="mr-2 h-4 w-4" /> Reload
                </button>
                <button type="button" className="dune-button" onClick={() => void handleSave()} disabled={!selectedId || saving || !mutationsEnabled}>
                  <Save className="mr-2 h-4 w-4" /> {saving ? 'Saving\u2026' : 'Save changes'}
                </button>
              </div>
            </div>

            {characterError ? <p className="mt-4 text-sm text-red-300">{characterError}</p> : null}
            {saveState ? (
              <div className={cn('mt-4 rounded-2xl border px-4 py-3 text-sm', saveState.tone === 'success' ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200' : 'border-red-500/30 bg-red-500/10 text-red-200')}>
                {saveState.message}
              </div>
            ) : null}

            {!selectedCharacter ? (
              <div className="mt-6 flex min-h-[360px] flex-col items-center justify-center gap-4 rounded-3xl border border-dashed border-th-border/80 bg-th-bg/25 p-8 text-center text-th-text-m">
                <UserCog className="h-10 w-10 text-amber-300" />
                <div>
                  <h3 className="text-xl font-semibold text-th-text">Select a Character</h3>
                  <p className="mt-2 max-w-md text-sm text-th-text-m">Choose a roster entry to inspect the discovered stat mapping and prepare edits.</p>
                </div>
              </div>
            ) : (
              <>
                <div className="mt-6 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                  {availableCategories.map((category) => {
                    const meta = categoryMeta[category];
                    const Icon = meta.icon;
                    const isActive = category === activeCategory;
                    return (
                      <button
                        key={category}
                        type="button"
                        onClick={() => setActiveCategory(category)}
                        className={cn(
                          'rounded-3xl border px-4 py-4 text-left transition-[color,background-color,border-color] dune-focus',
                          isActive ? 'border-amber-500/40 bg-amber-500/10 text-amber-100' : 'border-th-border-m/80 bg-th-bg/30 text-th-text-s hover:border-th-border hover:bg-th-surface-s/60',
                        )}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-sm font-semibold">{meta.label}</p>
                            <p className="mt-1 text-xs text-th-text-m">{fieldsByCategory[category]?.length ?? 0} fields</p>
                          </div>
                          <Icon className="h-5 w-5" />
                        </div>
                        <p className="mt-3 text-xs text-th-text-m">{meta.description}</p>
                      </button>
                    );
                  })}
                </div>

                <div className="mt-6 rounded-3xl border border-th-border-m/80 bg-th-bg/30 p-5">
                  <div className="flex items-center gap-3">
                    {(() => {
                      const Icon = categoryMeta[activeCategory].icon;
                      return <Icon className="h-5 w-5 text-amber-300" />;
                    })()}
                    <div>
                      <h3 className="font-semibold text-th-text">{categoryMeta[activeCategory].label}</h3>
                      <p className="text-sm text-th-text-m">{categoryMeta[activeCategory].description}</p>
                    </div>
                  </div>

                  <div className="mt-5 grid gap-4 md:grid-cols-2">
                    {activeFields.map((field) => (
                      <label key={field.key} className="block rounded-2xl border border-th-border-m/80 bg-th-surface-s/60 p-4">
                        <span className="block text-sm font-medium text-th-text">{field.label}</span>
                        <span className="mt-1 block text-xs uppercase tracking-[0.18em] text-th-text0">{field.key}</span>
                        <input
                          className="dune-input mt-3"
                          type={field.type === 'number' ? 'number' : 'text'}
                          value={draft[field.key] ?? ''}
                          onChange={(event) => setDraft((current) => ({ ...current, [field.key]: event.target.value }))}
                          disabled={loadingCharacter}
                        />
                      </label>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>

          <div className="glass-panel p-5">
            <p className="section-title">Schema summary</p>
            <h2 className="mt-1 text-xl font-semibold text-th-text">Editable Stat Layout</h2>
            <div className="mt-5 grid gap-3 md:grid-cols-2">
              {availableCategories.map((category) => {
                const meta = categoryMeta[category];
                const Icon = meta.icon;
                return (
                  <div key={category} className="rounded-3xl border border-th-border-m/80 bg-th-bg/30 p-4">
                    <div className="flex items-center gap-3">
                      <div className="rounded-2xl bg-amber-500/15 p-3 text-amber-300">
                        <Icon className="h-5 w-5" />
                      </div>
                      <div>
                        <p className="font-semibold text-th-text">{meta.label}</p>
                        <p className="text-sm text-th-text-m">{fieldsByCategory[category]?.length ?? 0} available inputs</p>
                      </div>
                    </div>
                    <div className="mt-4 flex flex-wrap gap-2">
                      {(fieldsByCategory[category] ?? []).map((field) => (
                        <span key={field.key} className="rounded-full border border-th-border px-3 py-1 text-xs text-th-text-s">
                          {field.label}
                        </span>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
