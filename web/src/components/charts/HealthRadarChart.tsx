import {
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip,
} from 'recharts';

export interface HealthRadarDatum {
  dimension: string;
  score: number;
}

export interface HealthRadarChartProps {
  data: HealthRadarDatum[];
  height?: number;
}

/** 五维度健康度雷达图（0–100）。 */
export function HealthRadarChart({ data, height = 300 }: HealthRadarChartProps) {
  return (
    <div style={{ width: '100%', height }} role="img" aria-label="健康度雷达图">
      <ResponsiveContainer width="100%" height="100%">
        <RadarChart data={data} outerRadius="70%">
          <PolarGrid stroke="#e2e8f0" />
          <PolarAngleAxis dataKey="dimension" tick={{ fontSize: 12, fill: '#475569' }} />
          <PolarRadiusAxis domain={[0, 100]} tick={{ fontSize: 10, fill: '#94a3b8' }} />
          <Radar name="健康分" dataKey="score" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.4} />
          <Tooltip />
        </RadarChart>
      </ResponsiveContainer>
    </div>
  );
}