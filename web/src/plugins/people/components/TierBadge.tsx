import { Badge } from '@/components/ui/Badge';
import { useI18n } from '@/core/i18n';

import type { Tier } from '@/plugins/people/api';

/** 活跃度分层 → 徽标色调（与后端 people.py 的四层语义一致）。 */
const TONE: Record<Tier, 'success' | 'neutral' | 'warning' | 'danger'> = {
  core: 'success',
  active: 'neutral',
  occasional: 'warning',
  churned: 'danger',
};

export function TierBadge({ tier }: { tier: Tier | null }) {
  const { t } = useI18n();
  if (!tier) return null;
  return <Badge tone={TONE[tier]}>{t(`people.tier.${tier}`)}</Badge>;
}