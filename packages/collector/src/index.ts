import { createServer } from 'node:http';
import process from 'node:process';
import { WebSocketServer, WebSocket } from 'ws';
import { validateIR, type IR, type LiveMessage, type MetricsPatch } from '@sysopolis/core';
import { SyntheticSim } from './syntheticLive.js';
import { DockerAdapter } from './docker.js';

interface Args {
  mode: 'synthetic' | 'docker';
  port: number;
  seed: number;
  intervalMs: number;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { mode: 'synthetic', port: 4400, seed: 42, intervalMs: 1000 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--synthetic') args.mode = 'synthetic';
    else if (a === '--docker') args.mode = 'docker';
    else if (a === '--port') args.port = Number(argv[++i]);
    else if (a === '--seed') args.seed = Number(argv[++i]);
    else if (a === '--interval') args.intervalMs = Number(argv[++i]);
    else if (a === '--help' || a === '-h') {
      console.log(`sysopolis-collector
  --synthetic        serve the built-in fake enterprise (default)
  --docker           introspect the local Docker daemon
  --port <n>         HTTP/WS port (default 4400)
  --seed <n>         synthetic city seed (default 42)
  --interval <ms>    tick/poll interval (default 1000)`);
      process.exit(0);
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  let ir: IR;
  let cleanup: () => void = () => undefined;
  const clients = new Set<WebSocket>();

  const broadcast = (msg: LiveMessage) => {
    const data = JSON.stringify(msg);
    for (const ws of clients) {
      if (ws.readyState === WebSocket.OPEN) ws.send(data);
    }
  };
  const broadcastPatches = (patches: MetricsPatch[]) => {
    if (patches.length > 0) broadcast({ type: 'patch', patches });
  };

  if (args.mode === 'synthetic') {
    const sim = new SyntheticSim(args.seed);
    ir = sim.ir;
    const timer = setInterval(() => broadcastPatches(sim.tick()), args.intervalMs);
    cleanup = () => clearInterval(timer);
    console.log(`[collector] synthetic city "${ir.meta.name}" (seed ${args.seed})`);
  } else {
    const adapter = new DockerAdapter();
    try {
      await adapter.ping();
    } catch (e) {
      console.error('[collector] cannot reach the Docker daemon — is it running?');
      console.error(`  ${(e as Error).message}`);
      process.exit(1);
    }
    ir = await adapter.buildIR();
    console.log(`[collector] docker: ${ir.systems.length} containers, ${ir.districts.length} networks`);

    let rebuildTimer: NodeJS.Timeout | null = null;
    const scheduleRebuild = () => {
      if (rebuildTimer) return;
      rebuildTimer = setTimeout(async () => {
        rebuildTimer = null;
        try {
          ir = await adapter.buildIR();
          console.log(`[collector] topology changed → ${ir.systems.length} containers`);
          broadcast({ type: 'ir', ir });
        } catch (e) {
          console.error('[collector] rebuild failed:', (e as Error).message);
        }
      }, 1000);
    };
    const watcher = adapter.watch(() => ir, broadcastPatches, scheduleRebuild, Math.max(1000, args.intervalMs));
    cleanup = () => watcher.stop();
  }

  const validation = validateIR(ir);
  if (!validation.ok) {
    console.error('[collector] generated IR is INVALID — refusing to serve it:');
    for (const err of validation.errors) console.error(`  - ${err}`);
    process.exit(1);
  }

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    res.setHeader('Access-Control-Allow-Origin', '*');
    if (url.pathname === '/ir') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(ir));
    } else if (url.pathname === '/healthz') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, source: ir.meta.source, systems: ir.systems.length }));
    } else {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end(`sysopolis collector (${ir.meta.source})\n  GET /ir   — full IR\n  WS  /ws   — live patches\n`);
    }
  });

  const wss = new WebSocketServer({ server, path: '/ws' });
  wss.on('connection', (ws) => {
    clients.add(ws);
    ws.on('close', () => clients.delete(ws));
  });

  server.listen(args.port, () => {
    console.log(`[collector] http://localhost:${args.port}/ir  |  ws://localhost:${args.port}/ws`);
  });

  const shutdown = () => {
    cleanup();
    wss.close();
    server.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

void main();
