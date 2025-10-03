import { useEffect, useState } from 'react';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { fetchSession, getAccessLoginUrl, getAccessLogoutUrl, HttpError } from './lib/api';
import { FileManager } from './components/FileManager';
import { ChatPanel } from './components/ChatPanel';

const queryClient = new QueryClient();

type ActiveView = 'chat' | 'vault' | 'about';

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
            <p>Your workspace for connected thinking.</p>
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
          <div className="primary-nav__list">
            <button
              type="button"
              className={activeView === 'chat' ? 'active' : ''}
              onClick={() => setActiveView('chat')}
            >
              <span>Ask Marble</span>
            </button>
            <button
              type="button"
              className={activeView === 'vault' ? 'active' : ''}
              onClick={() => setActiveView('vault')}
            >
              <span>Files &amp; Folders</span>
            </button>
          </div>
          <div className="primary-nav__about-card">
            <h3>About Marble</h3>
            <p>
              Marble keeps your team’s knowledge connected. Upload documents, organise them into shared or private
              spaces, and ask Marble for grounded answers whenever you need context.
            </p>
            <button type="button" onClick={() => setActiveView('about')}>
              Learn more
            </button>
          </div>
        </aside>
        <section className="app-content">
          <div
            className={`app-pane${activeView === 'chat' ? ' is-active' : ''}`}
            hidden={activeView !== 'chat'}
            aria-hidden={activeView !== 'chat'}
          >
            <ChatPanel />
          </div>
          <div
            className={`app-pane${activeView === 'vault' ? ' is-active' : ''}`}
            hidden={activeView !== 'vault'}
            aria-hidden={activeView !== 'vault'}
          >
            {user ? <FileManager currentUserId={user.id} /> : null}
          </div>
          <div
            className={`app-pane${activeView === 'about' ? ' is-active' : ''}`}
            hidden={activeView !== 'about'}
            aria-hidden={activeView !== 'about'}
          >
            <section className="about-panel">
              <header className="about-panel__header">
                <h2>Meet Marble</h2>
                <p>Bring documents, context, and answers together in a workspace built for connected thinking.</p>
              </header>
              <div className="about-panel__grid">
                <article>
                  <h3>Organise what matters</h3>
                  <p>
                    Keep private research and shared reference material in the same vault. Folders stay under your
                    control while the rest of the org can discover approved docs.
                  </p>
                </article>
                <article>
                  <h3>Search meets conversation</h3>
                  <p>
                    Ask Marble for fast summaries, citations, and supporting quotes pulled directly from the files you
                    choose to publish.
                  </p>
                </article>
                <article>
                  <h3>Publish with confidence</h3>
                  <p>
                    Toggle files or entire folders between private and shared visibility. Ownership stays with you, so
                    only the author can update or remove content.
                  </p>
                </article>
              </div>
              <footer className="about-panel__footer">
                <p className="about-panel__signature">Designed &amp; Built by Harish Adithya.</p>
                <button type="button" className="secondary" onClick={() => setActiveView('chat')}>
                  Back to Ask Marble
                </button>
              </footer>
            </section>
          </div>
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
