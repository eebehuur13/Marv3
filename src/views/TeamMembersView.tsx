import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  acceptTeamInvite,
  createTeam,
  fetchTeams,
  fetchRoster,
  inviteTeamMembers,
  removeTeamMember,
  updateTeamMemberRole,
  type SessionResponse,
  type TeamSummary,
  type TeamMemberSummary,
} from '../lib/api';
import { PlaceholderView } from './PlaceholderView';

type AlertState = { type: 'info' | 'error'; message: string } | null;

type RoleOption = TeamMemberSummary['role'];

function getMemberLabel(member: TeamMemberSummary): string {
  return member.display_name ?? member.email;
}

function getStatusLabel(status: TeamMemberSummary['status']): string {
  switch (status) {
    case 'active':
      return 'Active';
    case 'pending':
      return 'Pending invite';
    default:
      return 'Removed';
  }
}

function isManageableRole(role: RoleOption): boolean {
  return role === 'owner' || role === 'manager';
}

export function TeamMembersView() {
  const queryClient = useQueryClient();
  const session = queryClient.getQueryData<SessionResponse>(['session']);
  const currentUserId = session?.user.id ?? null;
  const organisationRole = session?.user.organizationRole ?? 'member';

  const teamsQuery = useQuery({ queryKey: ['teams'], queryFn: fetchTeams });
  const rosterQuery = useQuery({ queryKey: ['organization', 'roster'], queryFn: fetchRoster });

  const teams = teamsQuery.data?.teams ?? [];
  const roster = rosterQuery.data?.roster ?? [];
  const isOrgAdmin = organisationRole === 'owner' || organisationRole === 'admin';

  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [showInvite, setShowInvite] = useState(false);
  const [selectedInvitees, setSelectedInvitees] = useState<Set<string>>(() => new Set<string>());
  const [showCreateTeam, setShowCreateTeam] = useState(false);
  const [teamNameDraft, setTeamNameDraft] = useState('');
  const [teamDescriptionDraft, setTeamDescriptionDraft] = useState('');
  const [alert, setAlert] = useState<AlertState>(null);

  const selectedTeam: TeamSummary | null = useMemo(() => {
    if (!teams.length) return null;
    if (selectedTeamId) {
      const match = teams.find((team) => team.id === selectedTeamId);
      if (match) return match;
    }
    return teams[0];
  }, [teams, selectedTeamId]);

  const memberLookup = useMemo(() => {
    return new Map((selectedTeam?.members ?? []).map((member) => [member.user_id, member]));
  }, [selectedTeam]);

  const activeTeamMembers: TeamMemberSummary[] = useMemo(() => {
    if (!selectedTeam) return [];
    return selectedTeam.members.filter((member) => member.status !== 'removed');
  }, [selectedTeam]);

  const filteredMembers = useMemo(() => {
    const normalized = filter.trim().toLowerCase();
    if (!normalized) return activeTeamMembers;
    return activeTeamMembers.filter((member) => {
      const target = `${member.display_name ?? ''} ${member.email} ${member.username ?? ''}`.toLowerCase();
      return target.includes(normalized);
    });
  }, [activeTeamMembers, filter]);

  const currentMembership = currentUserId ? memberLookup.get(currentUserId) ?? null : null;
  const canManageSelectedTeam = Boolean(
    selectedTeam && (
      organisationRole === 'owner' ||
      organisationRole === 'admin' ||
      (currentMembership && isManageableRole(currentMembership.role))
    ),
  );

  const inviteableMembers = useMemo(() => {
    if (!selectedTeam) return [];
    const existingIds = new Set(activeTeamMembers.map((member) => member.user_id));
    return roster
      .filter((entry) => entry.status === 'active' && entry.user_id && !existingIds.has(entry.user_id))
      .sort((a, b) => (a.display_name ?? a.email).localeCompare(b.display_name ?? b.email));
  }, [activeTeamMembers, roster, selectedTeam]);

  const pendingInvites = useMemo(() => {
    if (!currentUserId) return [] as TeamSummary[];
    return teams.filter((team) =>
      team.members.some((member) => member.user_id === currentUserId && member.status === 'pending'),
    );
  }, [teams, currentUserId]);

  const activeMemberships = useMemo(() => {
    if (!currentUserId) return [] as TeamSummary[];
    return teams.filter((team) =>
      team.members.some((member) => member.user_id === currentUserId && member.status === 'active'),
    );
  }, [teams, currentUserId]);

  useEffect(() => {
    if (selectedTeamId || !teams.length) {
      return;
    }
    if (activeMemberships.length) {
      setSelectedTeamId(activeMemberships[0].id);
      return;
    }
    setSelectedTeamId(teams[0].id);
  }, [teams, activeMemberships, selectedTeamId]);

  const toggleInvitee = (userId: string) => {
    setSelectedInvitees((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) {
        next.delete(userId);
      } else {
        next.add(userId);
      }
      return next;
    });
  };

  const invalidateTeams = async () => {
    await queryClient.invalidateQueries({ queryKey: ['teams'] });
  };

  const canCreateTeam = isOrgAdmin || activeMemberships.length === 0;

  const inviteMutation = useMutation({
    mutationFn: ({ teamId, userIds }: { teamId: string; userIds: string[] }) => inviteTeamMembers(teamId, userIds),
    onSuccess: async () => {
      await invalidateTeams();
      setAlert({ type: 'info', message: 'Invitations sent.' });
      setShowInvite(false);
      setSelectedInvitees(new Set<string>());
    },
    onError: (error: unknown) => {
      const message = error instanceof Error ? error.message : 'Failed to invite members.';
      setAlert({ type: 'error', message });
    },
  });

  const createTeamMutation = useMutation({
    mutationFn: ({ name, description }: { name: string; description?: string }) =>
      createTeam({ name, description: description?.trim() ? description : null }),
    onSuccess: async (result) => {
      await invalidateTeams();
      setTeamNameDraft('');
      setTeamDescriptionDraft('');
      setShowCreateTeam(false);
      setAlert({ type: 'info', message: `Created team “${result.team.name}”.` });
      setSelectedTeamId(result.team.id);
    },
    onError: (error: unknown) => {
      const message = error instanceof Error ? error.message : 'Unable to create team.';
      setAlert({ type: 'error', message });
    },
  });

  const updateRoleMutation = useMutation({
    mutationFn: ({ teamId, userId, role }: { teamId: string; userId: string; role: RoleOption }) =>
      updateTeamMemberRole(teamId, userId, role),
    onSuccess: async () => {
      await invalidateTeams();
      setAlert({ type: 'info', message: 'Role updated.' });
    },
    onError: (error: unknown) => {
      const message = error instanceof Error ? error.message : 'Unable to change role.';
      setAlert({ type: 'error', message });
    },
  });

  const removeMutation = useMutation({
    mutationFn: ({ teamId, userId }: { teamId: string; userId: string }) => removeTeamMember(teamId, userId),
    onSuccess: async () => {
      await invalidateTeams();
      setAlert({ type: 'info', message: 'Member removed.' });
    },
    onError: (error: unknown) => {
      const message = error instanceof Error ? error.message : 'Unable to remove member.';
      setAlert({ type: 'error', message });
    },
  });

  const acceptInviteMutation = useMutation({
    mutationFn: (teamId: string) => acceptTeamInvite(teamId),
    onSuccess: async (_, teamId) => {
      await invalidateTeams();
      setAlert({ type: 'info', message: 'Welcome to your new team!' });
      setSelectedTeamId(teamId);
    },
    onError: (error: unknown) => {
      const message = error instanceof Error ? error.message : 'Unable to accept invitation.';
      setAlert({ type: 'error', message });
    },
  });

  const handleCreateTeam = () => {
    const trimmed = teamNameDraft.trim();
    if (!trimmed) {
      setAlert({ type: 'error', message: 'Team name is required.' });
      return;
    }
    createTeamMutation.mutate({ name: trimmed, description: teamDescriptionDraft.trim() });
  };

  return (
    <section className="team-members-view panel-surface">
      <header className="team-members-view__header">
        <div>
          <h2>Team members</h2>
          <p>Manage invitations, roles, and collaboration for your Marble teams.</p>
        </div>
        <div className="team-members-view__actions">
          <input
            type="search"
            placeholder="Search members"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            disabled={!selectedTeam}
          />
          <button
            type="button"
            onClick={() => setShowCreateTeam(true)}
            disabled={!canCreateTeam}
            title={!canCreateTeam ? 'You must leave your current team before creating a new one.' : undefined}
          >
            New team
          </button>
          <button
            type="button"
            onClick={() => setShowInvite(true)}
            disabled={!selectedTeam || !canManageSelectedTeam || !inviteableMembers.length}
          >
            Invite members
          </button>
        </div>
      </header>

      {alert && (
        <div className={`team-members-view__alert team-members-view__alert--${alert.type}`}>
          <span>{alert.message}</span>
          <button type="button" onClick={() => setAlert(null)} aria-label="Dismiss message">
            ×
          </button>
        </div>
      )}

      {!canCreateTeam && !isOrgAdmin && activeMemberships.length > 0 && (
        <p className="muted" role="note">
          You’re currently part of “{activeMemberships[0].name}”. Leave that team to start a new one.
        </p>
      )}

      {pendingInvites.length > 0 && (
        <section className="team-members-view__invites">
          <h3>Pending team invitations</h3>
          <ul>
            {pendingInvites.map((team) => (
              <li key={team.id}>
                <div>
                  <strong>{team.name}</strong>
                  {team.description && <span className="muted"> — {team.description}</span>}
                </div>
                <button
                  type="button"
                  onClick={() => acceptInviteMutation.mutate(team.id)}
                  disabled={acceptInviteMutation.isPending}
                >
                  {acceptInviteMutation.isPending ? 'Accepting…' : 'Accept invite'}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="team-members-view__content">
        {teamsQuery.isLoading ? (
          <div className="team-members-view__loading">Loading teams…</div>
        ) : !teams.length ? (
          <PlaceholderView
            title="No teams created yet"
            description="Teams keep project collaborators aligned. Create one and invite your colleagues from the roster."
            hint="Each person can belong to a single team, so choose collaborators wisely."
          />
        ) : (
          <div className="team-members-view__panel">
            <div className="team-members-view__selector">
              <label>
                <span>Team</span>
                <select
                  value={selectedTeam?.id ?? ''}
                  onChange={(event) => setSelectedTeamId(event.target.value || null)}
                >
                  {teams.map((team) => (
                    <option key={team.id} value={team.id}>
                      {team.name}
                    </option>
                  ))}
                </select>
              </label>
              {selectedTeam?.description && <p className="muted">{selectedTeam.description}</p>}
              {selectedTeam && (
                <div className="team-members-view__stats">
                  <span>
                    {activeTeamMembers.length} active {activeTeamMembers.length === 1 ? 'member' : 'members'}
                  </span>
                  <span>
                    {selectedTeam.members.filter((member) => member.status === 'pending').length} pending invite
                    {selectedTeam.members.filter((member) => member.status === 'pending').length === 1 ? '' : 's'}
                  </span>
                </div>
              )}
            </div>

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
                    <tr key={member.user_id}>
                      <td>{getMemberLabel(member)}</td>
                      <td>{member.email}</td>
                      <td>
                        {canManageSelectedTeam ? (
                          <select
                            value={member.role}
                            onChange={(event) =>
                              updateRoleMutation.mutate({
                                teamId: selectedTeam!.id,
                                userId: member.user_id,
                                role: event.target.value as RoleOption,
                              })
                            }
                            disabled={updateRoleMutation.isPending}
                          >
                            <option value="member">Member</option>
                            <option value="manager">Manager</option>
                            <option value="owner">Owner</option>
                          </select>
                        ) : (
                          <span>{member.role}</span>
                        )}
                      </td>
                      <td>
                        <span className={`team-members-table__badge team-members-table__badge--${member.status}`}>
                          {getStatusLabel(member.status)}
                        </span>
                        {member.status === 'pending' && member.user_id === currentUserId && (
                          <button
                            type="button"
                            className="link"
                            onClick={() => acceptInviteMutation.mutate(selectedTeam!.id)}
                            disabled={acceptInviteMutation.isPending}
                          >
                            Accept
                          </button>
                        )}
                      </td>
                      <td>
                        {canManageSelectedTeam && (
                          <div className="team-members-table__actions">
                            <button
                              type="button"
                              className="link link--critical"
                              onClick={() => removeMutation.mutate({ teamId: selectedTeam!.id, userId: member.user_id })}
                              disabled={removeMutation.isPending}
                            >
                              Remove
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <PlaceholderView
                title="No members match that search"
                description="Try a different filter or invite teammates from your roster."
              />
            )}
          </div>
        )}
      </div>

      <section className="team-members-view__roster">
        <header>
          <h3>Organization roster</h3>
          <p>Upload roster files in the admin console or invite teammates directly in Marble.</p>
        </header>
        {rosterQuery.isLoading ? (
          <div className="team-members-view__loading">Loading roster…</div>
        ) : !isOrgAdmin ? (
          <PlaceholderView
            title="Ask your admin to update the roster"
            description="Only organization admins can update roster membership."
          />
        ) : !roster.length ? (
          <PlaceholderView
            title="Roster is empty"
            description="Upload a roster file from the admin tools so teams can be provisioned automatically."
          />
        ) : (
          <div className="team-roster-table-wrapper">
            <table className="team-roster-table">
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Email</th>
                  <th scope="col">Role</th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {roster.map((entry) => (
                  <tr key={entry.id}>
                    <td>{entry.display_name ?? entry.user_display_name ?? '—'}</td>
                    <td>{entry.email}</td>
                    <td>{entry.role}</td>
                    <td>{entry.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {showInvite && selectedTeam && (
        <div className="dialog-backdrop" role="dialog" aria-modal="true">
          <div className="dialog-card dialog-card--wide">
            <header>
              <h3>Invite teammates to {selectedTeam.name}</h3>
            </header>
            <div className="dialog-body">
              {inviteableMembers.length ? (
                <ul className="invite-list">
                  {inviteableMembers.map((entry) => (
                    <li key={entry.user_id ?? entry.email}>
                      <label>
                        <input
                          type="checkbox"
                          checked={entry.user_id ? selectedInvitees.has(entry.user_id) : false}
                          onChange={() => entry.user_id && toggleInvitee(entry.user_id)}
                          disabled={!entry.user_id}
                        />
                        <span>
                          <strong>{entry.display_name ?? entry.email}</strong>
                          <small>{entry.email}</small>
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted">Everyone on your roster is already part of this team.</p>
              )}
            </div>
            <footer className="dialog-footer">
              <button
                type="button"
                className="link"
                onClick={() => {
                  setShowInvite(false);
                  setSelectedInvitees(new Set<string>());
                }}
                disabled={inviteMutation.isPending}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() =>
                  inviteMutation.mutate({
                    teamId: selectedTeam.id,
                    userIds: Array.from(selectedInvitees),
                  })
                }
                disabled={inviteMutation.isPending || !selectedInvitees.size}
              >
                {inviteMutation.isPending ? 'Sending…' : 'Send invites'}
              </button>
            </footer>
          </div>
        </div>
      )}

      {showCreateTeam && (
        <div className="dialog-backdrop" role="dialog" aria-modal="true">
          <div className="dialog-card">
            <header>
              <h3>Create a team</h3>
            </header>
            <div className="dialog-body">
              <label className="field">
                <span>Name</span>
                <input
                  value={teamNameDraft}
                  onChange={(event) => setTeamNameDraft(event.target.value)}
                  placeholder="e.g. Knowledge Ops"
                  disabled={createTeamMutation.isPending}
                />
              </label>
              <label className="field">
                <span>Description</span>
                <textarea
                  value={teamDescriptionDraft}
                  onChange={(event) => setTeamDescriptionDraft(event.target.value)}
                  rows={3}
                  placeholder="Optional context for your teammates"
                  disabled={createTeamMutation.isPending}
                />
              </label>
              {activeMemberships.length > 0 && (
                <p className="muted">
                  You currently belong to “{activeMemberships[0].name}”. Leaving that team will free you to join another.
                </p>
              )}
            </div>
            <footer className="dialog-footer">
              <button
                type="button"
                className="link"
                onClick={() => {
                  setShowCreateTeam(false);
                  setTeamNameDraft('');
                  setTeamDescriptionDraft('');
                }}
                disabled={createTeamMutation.isPending}
              >
                Cancel
              </button>
              <button type="button" onClick={handleCreateTeam} disabled={createTeamMutation.isPending}>
                {createTeamMutation.isPending ? 'Creating…' : 'Create team'}
              </button>
            </footer>
          </div>
        </div>
      )}
    </section>
  );
}
