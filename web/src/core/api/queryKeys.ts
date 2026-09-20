/** react-query 查询键：集中管理，避免字符串散落各处。 */
export const queryKeys = {
  health: ['health'] as const,
  repos: (org: string | null = null) => ['repos', org] as const,
  repo: (id: string) => ['repos', 'detail', id] as const,
  people: (org: string | null = null) => ['people', org] as const,
  sentiment: (range: string) => ['sentiment', range] as const,
} as const;
