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
            <button
              type="button"
              className={activeView === 'about' ? 'active' : ''}
              onClick={() => setActiveView('about')}
            >
              <span>About Marble</span>
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
                <p>Find, connect, and create from every file.</p>
              </header>
              <div className="about-panel__grid">
                <article>
                  <h3>What it is</h3>
                  <p>
                    Marble is an enterprise multimodal search and generation platform that turns scattered docs,
                    sheets, decks, recordings, videos, and designs into a connected, living knowledge fabric.
                  </p>
                </article>
                <article>
                  <h3>What it does</h3>
                  <p>
                    It indexes text, audio, video, and images into a shared semantic space so you can search by meaning
                    across formats and turn results into grounded outputs—summaries, reports, playbooks, and highlight
                    reels.
                  </p>
                </article>
                <article>
                  <h3>Why it fits the enterprise</h3>
                  <p>
                    Permissions and roles enforced by default, full audit logs, compliance tagging, version history,
                    and smooth collaboration via shareable searches, annotations, collections, and integrations with
                    the tools you already use.
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
