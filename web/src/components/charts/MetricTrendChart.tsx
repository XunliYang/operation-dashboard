import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import type { MetricPoint } from '@/core/types';

export interface MetricTrendChartProps {
  data: MetricPoint[];
  height?: number;
  color?: string;
  label?: string;
}

/** 单指标时序折线图。 */
export function MetricTrendChart({
  data,
  height = 220,
  color = '#3b82f6',
  label = '值',
}: MetricTrendChartProps) {
  return (
    <div style={{ width: '100%', height }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 8, bottom: 8, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
          <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#64748b' }} />
          <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#64748b' }} width={36} />
          <Tooltip />
          <Line type="monotone" dataKey="value" name={label} stroke={color} strokeWidth={2} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}