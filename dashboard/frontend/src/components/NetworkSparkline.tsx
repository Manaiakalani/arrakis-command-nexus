'use client';

import { useId, useMemo } from 'react';
import { Area, AreaChart, ResponsiveContainer } from 'recharts';

import type { MetricsPoint } from '@/lib/types';

interface NetworkSparklineProps {
  history: MetricsPoint[];
  height?: number;
}

export function NetworkSparkline({ history, height = 64 }: NetworkSparklineProps) {
  const gradientPrefix = useId().replace(/:/g, '');
  const data = useMemo(
    () =>
      history.map((point) => ({
        inbound: point.networkInMbps,
        outbound: point.networkOutMbps,
      })),
    [history],
  );

  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 4, right: 0, bottom: 4, left: 0 }}>
          <defs>
            <linearGradient id={`${gradientPrefix}-in`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.45} />
              <stop offset="95%" stopColor="#f59e0b" stopOpacity={0.02} />
            </linearGradient>
            <linearGradient id={`${gradientPrefix}-out`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#fdba74" stopOpacity={0.42} />
              <stop offset="95%" stopColor="#fdba74" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <Area type="monotone" dataKey="inbound" stroke="#f59e0b" fill={`url(#${gradientPrefix}-in)`} strokeWidth={2} dot={false} />
          <Area type="monotone" dataKey="outbound" stroke="#fdba74" fill={`url(#${gradientPrefix}-out)`} strokeWidth={2} dot={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
