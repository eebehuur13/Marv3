import { PlaceholderView } from './PlaceholderView';

interface HomeViewProps {
  currentUserName: string;
  currentUserEmail: string;
}

export function HomeView({ currentUserName, currentUserEmail }: HomeViewProps) {
  const friendlyName = currentUserName || currentUserEmail;
  return (
    <section className="home-view panel-surface">
      <header className="home-view__hero">
        <div>
          <h2>Hello, {friendlyName.split(' ')[0] || friendlyName} 👋</h2>
          <p>Your Marble HQ will soon highlight teams, projects, and the people you collaborate with most.</p>
        </div>
      </header>
      <div className="home-view__content">
        <PlaceholderView
          title="Team roster"
          description="Invite teammates to Marble and manage their roles. Once teams are active, they will appear here."
          hint="Team management lives inside the app—no external email flows required."
        />
      </div>
    </section>
  );
}
