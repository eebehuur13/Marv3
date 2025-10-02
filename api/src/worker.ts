import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { AppEnv } from './context';
import { authenticateRequest } from './lib/access';
import { ensureUser } from './lib/db';
import { handleWhoAmI } from './routes/whoami';
import { handleSession } from './routes/session';
import { handleUploadUrl } from './routes/upload-url';
import { handleUploadDirect } from './routes/upload-direct';
import { handleIngest } from './routes/ingest';
import { handleCreateFile, handleListFiles } from './routes/files';
import { handleDeleteFile } from './routes/delete-file';
import { handleChat } from './routes/chat';
import { handleDebugEmbed } from './routes/debug-embed';
import {
  handleDebugQuery,
  handleDebugFile,
  handleDebugProbeFile,
  handleDebugStats,
} from './routes/debug';
import { registerFolderRoutes } from './routes/folders';




const app = new Hono<AppEnv>();

const DEFAULT_ALLOWED_ORIGINS = [
  'https://strategicfork.xyz',
  'https://marv2-app.pages.dev',
  'https://marv2.eebehuur13.workers.dev',
  'http://localhost:5173',
];

// health check
app.get('/healthz', (c) => c.json({ ok: true }));

// 🔑 Add CORS middleware for all API routes
app.use(
  '/api/*',
  cors({
    origin: (requestOrigin, c) => {
      const configured = c.env.ALLOWED_ORIGIN;
      if (!configured) {
        if (requestOrigin && DEFAULT_ALLOWED_ORIGINS.includes(requestOrigin)) {
          return requestOrigin;
        }
        return DEFAULT_ALLOWED_ORIGINS[0];
      }
      const allowed = configured
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean);
      if (!allowed.length) {
        return requestOrigin || 'http://localhost:5173';
      }
      if (allowed.includes('*')) {
        return requestOrigin || '*';
      }
      if (requestOrigin && allowed.includes(requestOrigin)) {
        return requestOrigin;
      }
      return null;
    },
    allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
    maxAge: 86400,
  })
);

// --- API routes ---
const api = app.basePath('/api');

// 🔒 Authentication middleware
api.use('*', async (c, next) => {
  try {
    // If Access secrets are set → enforce Cloudflare Access
    if (c.env.CF_ACCESS_AUD && c.env.CF_ACCESS_TEAM_DOMAIN) {
      const user = await authenticateRequest(c.req.raw, c.env);
      c.set('user', user);
      await ensureUser(c.env, user);
    } else {
      // 🚨 fallback dev user (no Access configured)
      const devUser = {
        id: 'dev-user',
        email: 'dev@local',
        displayName: 'Dev User',
        avatarUrl: null,
        tenant: c.env.DEFAULT_TENANT ?? 'default',
      };
      c.set('user', devUser);
      await ensureUser(c.env, devUser);
    }
    await next();
  } catch (err) {
    console.error('Auth error:', err);
    let loginUrl: string | undefined;
    try {
      const { host, origin, pathname, search } = new URL(c.req.url);
      if (c.env.CF_ACCESS_TEAM_DOMAIN) {
        const base = `https://${c.env.CF_ACCESS_TEAM_DOMAIN}`;
        const accessUrl = new URL(`/cdn-cgi/access/login/${host}`, base);
        const redirect = `${origin}${pathname}${search}`;
        accessUrl.searchParams.set('redirect_url', redirect);
        loginUrl = accessUrl.toString();
      }
    } catch (urlErr) {
      console.warn('Failed to build login URL', urlErr);
    }
    return c.json({ error: 'Unauthorized', loginUrl }, 401);
  }
});

// Routes
api.get('/session', handleSession);
api.get('/whoami', handleWhoAmI);
api.post('/upload-url', handleUploadUrl);
api.post('/upload-direct', handleUploadDirect);
api.post('/ingest', handleIngest);
api.get('/files', handleListFiles);
api.post('/files', handleCreateFile);
api.delete('/files/:id', handleDeleteFile);
api.post('/chat', handleChat);
api.get('/debug/embed', handleDebugEmbed);
api.get('/debug/query', handleDebugQuery);
api.get('/debug/file', handleDebugFile);
api.get('/debug/probe-file', handleDebugProbeFile);
api.get('/debug/stats', handleDebugStats);

registerFolderRoutes(api);

// Log any unhandled errors and return a JSON message instead of plain 500
app.onError((err, c) => {
  console.error('UNHANDLED ERROR:', err instanceof Error ? err.stack || err.message : String(err));
  const msg = err instanceof Error ? err.message : String(err);
  return c.json({ error: msg }, 500);
});


export default app;
