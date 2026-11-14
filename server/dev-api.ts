/**
 * Local development API server.
 *
 * Mounts every `api/**` serverless handler on an Express app so the online game can be
 * exercised locally (with two browser sessions) before deployment. The Vite dev server
 * proxies `/api` here (see `vite.config.ts`), so the browser client keeps calling relative
 * `/api/...` paths exactly as it does in production.
 *
 * Run with: `npm run dev:api` (powered by tsx).
 */

import 'dotenv/config';
import express from 'express';
import type { Request, Response } from 'express';

import type { ApiRequest, ApiResponse } from '../api/_lib/core.ts';

import profileSetup from '../api/profile/setup.ts';
import usernameAvailability from '../api/profile/username-availability.ts';
import roomsCreate from '../api/rooms/create.ts';
import roomsJoin from '../api/rooms/join.ts';
import roomsLeave from '../api/rooms/leave.ts';
import roomsReady from '../api/rooms/ready.ts';
import roomsPen from '../api/rooms/pen.ts';
import roomsStart from '../api/rooms/start.ts';
import matchmakingJoin from '../api/matchmaking/join.ts';
import matchmakingPoll from '../api/matchmaking/poll.ts';
import matchmakingCancel from '../api/matchmaking/cancel.ts';
import matchShot from '../api/match/shot.ts';
import matchPresence from '../api/match/presence.ts';
import matchAbandon from '../api/match/abandon.ts';
import historyList from '../api/history/list.ts';

type ApiHandler = (req: ApiRequest, res: ApiResponse) => Promise<void> | void;

interface Route {
  path: string;
  handler: ApiHandler;
}

const PORT = Number(process.env.DEV_API_PORT ?? 3001);

const ALLOWED_ORIGINS = new Set(['http://localhost:3000', 'http://127.0.0.1:3000']);

const routes: Route[] = [
  { path: '/api/profile/setup', handler: profileSetup },
  { path: '/api/profile/username-availability', handler: usernameAvailability },
  { path: '/api/rooms/create', handler: roomsCreate },
  { path: '/api/rooms/join', handler: roomsJoin },
  { path: '/api/rooms/leave', handler: roomsLeave },
  { path: '/api/rooms/ready', handler: roomsReady },
  { path: '/api/rooms/pen', handler: roomsPen },
  { path: '/api/rooms/start', handler: roomsStart },
  { path: '/api/matchmaking/join', handler: matchmakingJoin },
  { path: '/api/matchmaking/poll', handler: matchmakingPoll },
  { path: '/api/matchmaking/cancel', handler: matchmakingCancel },
  { path: '/api/match/shot', handler: matchShot },
  { path: '/api/match/presence', handler: matchPresence },
  { path: '/api/match/abandon', handler: matchAbandon },
  { path: '/api/history/list', handler: historyList },
];

const app = express();

// ── Permissive CORS for local development only ──────────────────────────────
app.use((req: Request, res: Response, next) => {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }
  next();
});

app.use(express.json({ limit: '1mb' }));

// ── Mount every serverless handler at its production URL path ───────────────
for (const route of routes) {
  app.all(route.path, async (req: Request, res: Response) => {
    try {
      await route.handler(
        {
          method: req.method,
          url: req.url,
          headers: req.headers,
          body: req.body,
          query: req.query,
        } as unknown as ApiRequest,
        res as unknown as ApiResponse
      );
    } catch {
      if (!res.headersSent) {
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ ok: false, error: 'internal', code: 'internal' }));
      }
    }
  });
}

app.listen(PORT, () => {
  console.log(`[dev-api] Local API server listening on http://localhost:${PORT}`);
  console.log('[dev-api] Mounted routes:');
  for (const route of routes) {
    console.log(`  ${route.path}`);
  }
});
