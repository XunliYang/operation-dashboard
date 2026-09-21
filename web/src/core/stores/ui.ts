/**
 * 全局 UI 状态（Zustand）。Phase 0 只放跨页面共享的最小集合；
 * 服务端数据一律交给 react-query，不重复进 store。
 */
import { create } from 'zustand';

export interface UiState {
  /** 侧边栏折叠 */
  sidebarCollapsed: boolean;
  /** 当前选中的组织，null 表示全部 */
  activeOrg: string | null;
  toggleSidebar: () => void;
  setActiveOrg: (org: string | null) => void;
}

export const useUiStore = create<UiState>((set) => ({
  sidebarCollapsed: false,
  activeOrg: null,
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  setActiveOrg: (org) => set({ activeOrg: org }),
}));
