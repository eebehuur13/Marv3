import { useState } from 'react';

interface UserProfileViewProps {
  email: string;
  displayName: string | null;
}

export function UserProfileView({ email, displayName }: UserProfileViewProps) {
  const [nameDraft, setNameDraft] = useState(displayName ?? '');
  const [usernameDraft, setUsernameDraft] = useState('');

  return (
    <section className="profile-view panel-surface">
      <header className="profile-view__header">
        <h2>User Profile</h2>
        <p>Update how teammates see you across Marble. Username support is coming soon.</p>
      </header>
      <form
        className="profile-view__form"
        onSubmit={(event) => {
          event.preventDefault();
        }}
      >
        <label className="field">
          <span>Email</span>
          <input type="email" value={email} readOnly />
        </label>
        <label className="field">
          <span>Display name</span>
          <input
            type="text"
            value={nameDraft}
            onChange={(event) => setNameDraft(event.target.value)}
            placeholder="Add your name"
          />
        </label>
        <label className="field">
          <span>Username</span>
          <input
            type="text"
            value={usernameDraft}
            onChange={(event) => setUsernameDraft(event.target.value)}
            placeholder="Choose a unique handle (coming soon)"
            disabled
          />
        </label>
        <p className="profile-view__hint">Profile editing will connect to the Marble API in an upcoming release.</p>
        <div className="profile-view__actions">
          <button type="button" className="secondary" disabled>
            Save changes
          </button>
        </div>
      </form>
    </section>
  );
}
