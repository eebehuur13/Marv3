import { useState } from 'react';
import { PlaceholderView } from './PlaceholderView';

const MOCK_MEMBERS = [
  { id: '1', name: 'Harish Adithya', email: 'harish@example.com', role: 'Team owner', status: 'active' },
  { id: '2', name: 'Ravi Kumar', email: 'ravi@example.com', role: 'Editor', status: 'pending' },
  { id: '3', name: 'Jaya Rao', email: 'jaya@example.com', role: 'Viewer', status: 'active' },
];

export function TeamMembersView() {
  const [filter, setFilter] = useState('');
  const [showInvite, setShowInvite] = useState(false);

  const filteredMembers = MOCK_MEMBERS.filter((member) => {
    const normalized = filter.trim().toLowerCase();
    if (!normalized) return true;
    return (
      member.name.toLowerCase().includes(normalized) ||
      member.email.toLowerCase().includes(normalized) ||
      member.role.toLowerCase().includes(normalized)
    );
  });

  return (
    <section className="team-members-view panel-surface">
      <header className="team-members-view__header">
        <div>
          <h2>Team members</h2>
          <p>Manage invitations, roles, and collaboration for your Marble team.</p>
        </div>
        <div className="team-members-view__actions">
          <input
            type="search"
            placeholder="Search members"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
          />
          <button type="button" onClick={() => setShowInvite(true)}>
            Invite members
          </button>
        </div>
      </header>

      <div className="team-members-view__content">
        {filteredMembers.length ? (
          <table className="team-members-table">
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Email</th>
                <th scope="col">Role</th>
                <th scope="col">Status</th>
                <th scope="col" aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {filteredMembers.map((member) => (
                <tr key={member.id}>
                  <td>{member.name}</td>
                  <td>{member.email}</td>
                  <td>{member.role}</td>
                  <td>
                    <span className={`team-members-table__badge team-members-table__badge--${member.status}`}>
                      {member.status === 'pending' ? 'Pending invite' : 'Active'}
                    </span>
                  </td>
                  <td>
                    <div className="team-members-table__actions">
                      <button type="button" className="link" disabled>
                        Change role
                      </button>
                      <button type="button" className="link link--critical" disabled>
                        Remove
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <PlaceholderView
            title="No members found"
            description="Try a different search term or invite someone new to your team."
          />
        )}
      </div>

      {showInvite && (
        <div className="dialog-backdrop" role="dialog" aria-modal="true">
          <div className="dialog-card dialog-card--wide">
            <header>
              <h3>Invite teammates</h3>
            </header>
            <div className="dialog-body">
              <p className="muted">Team invitations will flow through Marble once team management is implemented.</p>
              <textarea rows={4} placeholder="Paste email addresses (one per line)" disabled />
            </div>
            <footer className="dialog-footer">
              <button type="button" className="link" onClick={() => setShowInvite(false)}>
                Close
              </button>
              <button type="button" disabled>
                Send invites
              </button>
            </footer>
          </div>
        </div>
      )}
    </section>
  );
}
