import type { IR, LiveMessage } from '@sysopolis/core';
import { COLLECTOR_URL, useStore } from './store';

/**
 * Live protocol client: fetch the full IR once, then apply WebSocket deltas.
 * The renderer never re-fetches — patches mutate the model in place.
 */
export function connectLive(): () => void {
  let ws: WebSocket | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;

  const wsUrl = COLLECTOR_URL.replace(/^http/, 'ws') + '/ws';

  const openSocket = () => {
    if (disposed) return;
    ws = new WebSocket(wsUrl);
    ws.onopen = () => useStore.getState().setConnection('live');
    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data as string) as LiveMessage;
        if (msg.type === 'patch') useStore.getState().applyPatches(msg.patches);
        else if (msg.type === 'ir') useStore.getState().setIR(msg.ir);
      } catch {
        /* ignore malformed frames */
      }
    };
    ws.onclose = () => {
      useStore.getState().setConnection('offline');
      if (!disposed) retryTimer = setTimeout(boot, 2000);
    };
    ws.onerror = () => ws?.close();
  };

  const boot = async () => {
    if (disposed) return;
    useStore.getState().setConnection('connecting');
    try {
      const res = await fetch(`${COLLECTOR_URL}/ir`);
      if (!res.ok) throw new Error(`GET /ir → ${res.status}`);
      const ir = (await res.json()) as IR;
      if (disposed) return;
      useStore.getState().setIR(ir);
      openSocket();
    } catch {
      useStore.getState().setConnection('offline');
      retryTimer = setTimeout(boot, 2000);
    }
  };

  void boot();

  return () => {
    disposed = true;
    if (retryTimer) clearTimeout(retryTimer);
    ws?.close();
  };
}
