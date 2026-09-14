'use client';

import { Coins, Heart, Package } from 'lucide-react';

import { GRANT_GROUPS, type GrantEntry, type GrantGroup } from '@/lib/grant-catalog';
import { cn } from '@/lib/utils';

interface GrantCatalogProps {
  granting: boolean;
  onGrantItem: (templateId: string, quantity: number) => void;
  onGrantBatch: (items: { templateId: string; quantity: number }[]) => void;
  onGrantSolari: (amount: number) => void;
  onSetHealth: (hp: number) => void;
}

function EntryButton({
  entry,
  granting,
  onGrantItem,
  onGrantBatch,
  onGrantSolari,
  onSetHealth,
}: {
  entry: GrantEntry;
  granting: boolean;
  onGrantItem: GrantCatalogProps['onGrantItem'];
  onGrantBatch: GrantCatalogProps['onGrantBatch'];
  onGrantSolari: GrantCatalogProps['onGrantSolari'];
  onSetHealth: GrantCatalogProps['onSetHealth'];
}) {
  const Icon = entry.kind === 'solari' ? Coins : entry.kind === 'health' ? Heart : Package;
  const onClick = () => {
    if (entry.kind === 'item') onGrantItem(entry.templateId, entry.quantity);
    else if (entry.kind === 'batch') onGrantBatch(entry.items);
    else if (entry.kind === 'solari') onGrantSolari(entry.amount);
    else onSetHealth(entry.hp);
  };
  const wide = entry.kind === 'batch';
  return (
    <button
      type="button"
      className={cn('dune-button-muted text-xs', wide && 'col-span-2 md:col-span-3')}
      disabled={granting}
      onClick={() => void onClick()}
    >
      <Icon className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> {entry.label}
    </button>
  );
}

function GroupBlock({
  group,
  showBanner,
  granting,
  onGrantItem,
  onGrantBatch,
  onGrantSolari,
  onSetHealth,
}: {
  group: GrantGroup;
  showBanner: boolean;
  granting: boolean;
  onGrantItem: GrantCatalogProps['onGrantItem'];
  onGrantBatch: GrantCatalogProps['onGrantBatch'];
  onGrantSolari: GrantCatalogProps['onGrantSolari'];
  onSetHealth: GrantCatalogProps['onSetHealth'];
}) {
  return (
    <>
      {showBanner && group.banner ? (
        <div id={`grant-cat-${group.catId}`} className="mt-6 border-b border-th-border-m/40 pb-1" style={{ scrollMarginTop: '6rem' }}>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-700/80 dark:text-amber-200/80">
            {group.bannerIcon ? <span aria-hidden="true">{group.bannerIcon} </span> : null}
            {group.banner}
          </p>
        </div>
      ) : null}
      <div className={showBanner || !group.banner ? (group.banner ? 'mt-3' : 'mt-5') : 'mt-5'} id={!group.banner ? `grant-cat-${group.catId}` : undefined} style={!group.banner ? { scrollMarginTop: '6rem' } : undefined}>
        <p className="text-sm font-semibold text-th-text">{group.title}</p>
        {group.description ? <p className="mt-1 text-xs text-th-text-m">{group.description}</p> : null}
        <div className={cn('mt-3 grid gap-2', group.columns ?? 'grid-cols-2 md:grid-cols-4')}>
          {group.entries.map((entry, index) => (
            <EntryButton
              key={`${group.title}-${index}-${entry.label}`}
              entry={entry}
              granting={granting}
              onGrantItem={onGrantItem}
              onGrantBatch={onGrantBatch}
              onGrantSolari={onGrantSolari}
              onSetHealth={onSetHealth}
            />
          ))}
        </div>
      </div>
    </>
  );
}

export function GrantCatalog(props: GrantCatalogProps) {
  return (
    <>
      {GRANT_GROUPS.map((group, index) => {
        const showBanner = Boolean(group.banner) && group.banner !== GRANT_GROUPS[index - 1]?.banner;
        return (
          <GroupBlock
            key={`${group.catId}-${group.title}-${index}`}
            group={group}
            showBanner={showBanner}
            {...props}
          />
        );
      })}
    </>
  );
}
