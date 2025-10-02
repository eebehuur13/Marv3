import { useEffect, useState } from 'react';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { fetchSession, getAccessLoginUrl, getAccessLogoutUrl, HttpError } from './lib/api';
import { FileManager } from './components/FileManager';
import { ChatPanel } from './components/ChatPanel';

const queryClient = new QueryClient();

type ActiveView = 'chat' | 'vault';

function Dashboard() {
  const { data, isLoading, isError, error } = useQuery({ queryKey: ['session'], queryFn: fetchSession });
  const loginUrl = getAccessLoginUrl(typeof window !== 'undefined' ? window.location.href : undefined);
  const logoutUrl = getAccessLogoutUrl(typeof window !== 'undefined' ? window.location.origin : undefined);
  const [activeView, setActiveView] = useState<ActiveView>('chat');

  useEffect(() => {
    if (!isError && typeof window !== 'undefined') {
      sessionStorage.removeItem('marble-auth-redirected');
    }
  }, [isError]);

  useEffect(() => {
    if (!isError || typeof window === 'undefined') {
      return;
    }

    const err = error as HttpError | undefined;
    const marker = 'marble-auth-redirected';
    const shouldRedirect = Boolean(err?.loginUrl) || err?.status === 401 || err?.status === 403;
    if (!shouldRedirect) {
      return;
    }

    const target = err?.loginUrl ?? loginUrl;
    if (target && sessionStorage.getItem(marker) !== 'yes') {
      sessionStorage.setItem(marker, 'yes');
      window.location.href = target;
    }
  }, [isError, error, loginUrl]);

  if (isLoading) {
    return (
      <main className="page-state">
        <span aria-hidden>⏳</span>
        <p>Checking Access…</p>
      </main>
    );
  }

  if (isError) {
    const err = error as HttpError | undefined;
    const requireAuth = Boolean(err?.loginUrl) || err?.status === 401 || err?.status === 403;
    const target = err?.loginUrl ?? (requireAuth ? loginUrl : undefined);
    const heading = requireAuth ? 'Access Required' : 'Connection Issue';
    const fallbackMessage = requireAuth ? 'Please sign in through Cloudflare Access.' : 'We could not reach the Marble API.';
    return (
      <main className="page-state error">
        <h2>{heading}</h2>
        <p>{error instanceof Error ? error.message : fallbackMessage}</p>
        {requireAuth && target && (
          <a className="button" href={target}>
            Sign in to Marble
          </a>
        )}
      </main>
    );
  }

  const user = data?.user;

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand">
          <span className="brand-mark">M</span>
          <div>
            <h1>Welcome to Marble</h1>
            <p>Your calm command center for collective knowledge.</p>
          </div>
        </div>
        {user && (
          <div className="identity" role="navigation" aria-label="Account">
            <span className="avatar" aria-hidden="true">
              {(user.displayName ?? user.email)[0]?.toUpperCase()}
            </span>
            <div className="identity__details">
              <strong>{user.displayName ?? user.email}</strong>
            </div>
            <button
              type="button"
              className="secondary identity__logout"
              onClick={() => {
                if (typeof window !== 'undefined') {
                  sessionStorage.removeItem('marble-auth-redirected');
                  window.location.href = logoutUrl;
                }
              }}
            >
              Logout
            </button>
          </div>
        )}
      </header>
      <main className="app-body">
        <aside className="primary-nav" aria-label="Workspace navigation">
          <button
            type="button"
            className={activeView === 'chat' ? 'active' : ''}
            onClick={() => setActiveView('chat')}
          >
            <span>Chat</span>
            <small>Ask Marble</small>
          </button>
          <button
            type="button"
            className={activeView === 'vault' ? 'active' : ''}
            onClick={() => setActiveView('vault')}
          >
            <span>Knowledge Vault</span>
            <small>Files & Folders</small>
          </button>
        </aside>
        <section className="app-content">
          {activeView === 'chat' ? <ChatPanel /> : user && <FileManager currentUserId={user.id} />}
        </section>
      </main>
    </div>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <Dashboard />
    </QueryClientProvider>
  );
}

export default App;
