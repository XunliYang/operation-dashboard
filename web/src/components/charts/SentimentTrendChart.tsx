import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

export interface SentimentPoint {
  date: string;
  score: number;
}

export interface SentimentTrendChartProps {
  data: SentimentPoint[];
  height?: number;
}

/** 舆情情感走势折线图（占位数据）。 */
export function SentimentTrendChart({ data, height = 260 }: SentimentTrendChartProps) {
  return (
    <div style={{ width: '100%', height }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 8, bottom: 8, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
          <XAxis dataKey="date" tick={{ fontSize: 12 }} stroke="#94a3b8" />
          <YAxis domain={[-1, 1]} tick={{ fontSize: 12 }} stroke="#94a3b8" />
          <Tooltip />
          <Line type="monotone" dataKey="score" name="情感分" stroke="#10b981" strokeWidth={2} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
