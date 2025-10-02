import type { AppContext } from '../context';

export function handleSession(c: AppContext) {
  const user = c.get('user');
  const next = c.req.query('next');
  if (next) {
    try {
      const allowed = c.env.ALLOWED_ORIGIN;
      const target = new URL(next);
      if (!allowed || target.origin === allowed) {
        c.header('Cache-Control', 'no-store');
        return c.redirect(target.toString(), 302);
      }
    } catch (err) {
      console.warn('Invalid next url', next, err);
    }
  }
  c.header('Cache-Control', 'private, no-store');
  return c.json({
    user: {
      id: user.id,
      email: user.email,
      displayName: user.displayName ?? null,
      avatarUrl: user.avatarUrl ?? null,
    },
    tenant: user.tenant,
  });
}
