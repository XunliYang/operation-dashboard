/** 看板 B · 人员组织分类 API（对应 api/app/routers/people.py）。 */
import { request } from '@/core/api/client';

export type Tier = 'core' | 'active' | 'occasional' | 'churned';

export interface Member {
  id: string;
  login: string | null;
  email_masked: string | null;
  email: string | null;
  org_id: string | null;
  role: string | null;
  confidence: number | null;
  source: string | null;
  contributions: number;
  contribution_share: number;
  tier: Tier | null;
  days_inactive: number | null;
}

export interface OrgNode {
  id: string;
  name: string;
  kind: string;
  source: string | null;
  member_count: number;
  contribution_share: number;
  members: Member[];
  teams: OrgNode[];
}

export interface MaintainerAlert {
  id: number;
  days_inactive: number;
  login: string | null;
  org_id: string | null;
}

export interface OrgBoard {
  summary: {
    total_contributors: number;
    total_orgs: number;
    unclassified_count: number;
    tiers: Record<Tier, number>;
    alerts: MaintainerAlert[];
  };
  orgs: OrgNode[];
  unclassified: Member[];
}

export interface ContributorOrg {
  org_id: string;
  name: string;
  kind: string;
  role: string | null;
  confidence: number;
  source: string;
}

export interface ContributorProfile {
  id: string;
  login: string | null;
  display_name: string | null;
  email: string | null;
  company: string | null;
  first_seen_at: string | null;
  last_seen_at: string | null;
  orgs: ContributorOrg[];
  repos: Array<{ id: string; full_name: string }>;
  activity: { commits: number; prs: number; reviews: number };
}

/** GitHub 头像 / 主页外链：上提到 `core/api/github` 供多插件复用，此处保留 re-export。 */
export { githubAvatar, githubProfile } from '@/core/api/github';

export const peopleApi = {
  board: () => request<OrgBoard>('/dashboard/orgs'),
  contributor: (id: string) => request<ContributorProfile>(`/dashboard/contributors/${id}`),
};
