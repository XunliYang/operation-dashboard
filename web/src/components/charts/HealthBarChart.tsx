import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

export interface HealthBarDatum {
  name: string;
  score: number;
}

export interface HealthBarChartProps {
  data: HealthBarDatum[];
  height?: number;
}

/** 仓库健康分柱状图。Phase 0 用静态占位数据渲染，验证 Recharts 链路通。 */
export function HealthBarChart({ data, height = 260 }: HealthBarChartProps) {
  return (
    <div className="min-w-0 overflow-hidden" style={{ width: '100%', height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 8, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
          <XAxis dataKey="name" tick={{ fontSize: 12 }} stroke="#94a3b8" />
          <YAxis domain={[0, 100]} tick={{ fontSize: 12 }} stroke="#94a3b8" />
          <Tooltip />
          <Bar dataKey="score" name="健康分" fill="#3b82f6" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
