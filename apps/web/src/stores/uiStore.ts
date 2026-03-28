import { create } from "zustand";

type UiState = {
  /** Мобильный выезжающий сайдбар */
  sidebarOpen: boolean;
  /** Десктоп: узкий режим только иконок (md+) */
  sidebarCollapsed: boolean;
  selectedConversationId: string | null;
  setSidebarOpen: (open: boolean) => void;
  toggleSidebar: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  toggleSidebarCollapsed: () => void;
  setSelectedConversationId: (id: string | null) => void;
};

export const useUiStore = create<UiState>((set) => ({
  sidebarOpen: false,
  sidebarCollapsed: false,
  selectedConversationId: null,
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),
  toggleSidebarCollapsed: () =>
    set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  setSelectedConversationId: (id) => set({ selectedConversationId: id }),
}));
