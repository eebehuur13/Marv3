import { useEffect, useState } from 'react';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { fetchSession, getAccessLoginUrl, getAccessLogoutUrl, HttpError } from './lib/api';
import { HomeView } from './views/HomeView';
import { ChatView } from './views/ChatView';
import { PersonalFilesView } from './views/PersonalFilesView';
import { DocumentWorkspaceView } from './views/DocumentWorkspaceView';
import { CommunicationsView } from './views/CommunicationsView';
import { UserProfileView } from './views/UserProfileView';
import { FollowingView } from './views/FollowingView';
import { AnalyticsView } from './views/AnalyticsView';
import { AboutView } from './views/AboutView';
import { PlaceholderView } from './views/PlaceholderView';

const queryClient = new QueryClient();

type ActiveView =
  | 'home'
  | 'chat'
  | 'personal-files'
  | 'documents'
  | 'communications'
  | 'profile'
  | 'following'
  | 'analytics'
  | 'about';

function Dashboard() {
  const { data, isLoading, isError, error } = useQuery({ queryKey: ['session'], queryFn: fetchSession });
  const loginUrl = getAccessLoginUrl(typeof window !== 'undefined' ? window.location.href : undefined);
  const logoutUrl = getAccessLogoutUrl(typeof window !== 'undefined' ? window.location.origin : undefined);
  const [activeView, setActiveView] = useState<ActiveView>('home');

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
  const navItems: Array<{ id: ActiveView; label: string }> = [
    { id: 'home', label: 'Home' },
    { id: 'chat', label: 'Chat' },
    { id: 'personal-files', label: 'Personal Files' },
    { id: 'documents', label: 'Library' },
    { id: 'communications', label: 'Inbox' },
    { id: 'profile', label: 'User Profile' },
    { id: 'following', label: 'Following' },
    { id: 'analytics', label: 'Analytics' },
    { id: 'about', label: 'About Marble' },
  ];

  const renderView = () => {
    if (!user) {
      return (
        <PlaceholderView
          title="Loading workspace"
          description="We couldn't load your session details. Try refreshing the page."
        />
      );
    }

    switch (activeView) {
      case 'home':
        return <HomeView currentUserName={user.displayName ?? ''} currentUserEmail={user.email} />;
      case 'chat':
        return <ChatView />;
      case 'personal-files':
        return <PersonalFilesView currentUserId={user.id} />;
      case 'documents':
        return <DocumentWorkspaceView currentUserId={user.id} />;
      case 'communications':
        return <CommunicationsView />;
      case 'profile':
        return <UserProfileView email={user.email} displayName={user.displayName} />;
      case 'following':
        return <FollowingView />;
      case 'analytics':
        return <AnalyticsView />;
      case 'about':
        return <AboutView />;
      default:
        return null;
    }
  };

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
      </header>
      <main className="app-body">
        <aside className="primary-nav" aria-label="Workspace navigation">
          <nav className="primary-nav__list">
            {navItems.map((item) => (
              <button
                key={item.id}
                type="button"
                className={activeView === item.id ? 'active' : ''}
                aria-current={activeView === item.id ? 'page' : undefined}
                onClick={() => setActiveView(item.id)}
              >
                <span>{item.label}</span>
              </button>
            ))}
          </nav>
        </aside>
        <section className="app-content">{renderView()}</section>
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
