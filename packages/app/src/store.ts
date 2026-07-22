import { create } from 'zustand';
import { computeLayout, type CityLayout, type IR, type MetricsPatch } from '@sysopolis/core';

export type ConnectionState = 'connecting' | 'live' | 'offline';

interface AppState {
  ir: IR | null;
  layout: CityLayout | null;
  /** Bumped when any system's status changes → cheap re-render trigger. */
  statusVersion: number;
  selectedId: string | null;
  connection: ConnectionState;
  setIR: (ir: IR) => void;
  applyPatches: (patches: MetricsPatch[]) => void;
  select: (id: string | null) => void;
  setConnection: (c: ConnectionState) => void;
}

export const useStore = create<AppState>((set, get) => ({
  ir: null,
  layout: null,
  statusVersion: 0,
  selectedId: null,
  connection: 'connecting',

  setIR: (ir) => set({ ir, layout: computeLayout(ir), statusVersion: get().statusVersion + 1 }),

  // Hot path: metrics are mutated in place (the scene reads them per-frame);
  // only a status change triggers a React re-render.
  applyPatches: (patches) => {
    const { ir } = get();
    if (!ir) return;
    let statusChanged = false;
    for (const { id, status, ...metrics } of patches) {
      ir.metrics[id] = { ...ir.metrics[id], ...metrics, ...(status ? { status } : {}) };
      if (status) {
        const system = ir.systems.find((s) => s.id === id);
        if (system && system.status !== status) {
          system.status = status;
          statusChanged = true;
        }
      }
    }
    if (statusChanged) set({ statusVersion: get().statusVersion + 1 });
  },

  select: (selectedId) => set({ selectedId }),
  setConnection: (connection) => set({ connection }),
}));

export const COLLECTOR_URL: string =
  (import.meta.env.VITE_COLLECTOR_URL as string | undefined) ?? 'http://localhost:4400';
