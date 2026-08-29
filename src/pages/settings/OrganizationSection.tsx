import React, { useEffect, useMemo, useState } from 'react';
import { OrganizationsService } from '../../api/services/OrganizationsService';
import {
  OrganizationDetailService,
  type OrganizationDetail,
  type OrgRole,
} from '../../api/services/OrganizationDetailService';
import { useUnsavedChanges } from '../../hooks/useUnsavedChanges';

const ACTIVE_ORG_STORAGE_KEY = 'sf.activeOrgId';

interface OrgSummary {
  id: string;
  name: string;
}

// Logo/timezone have no backing columns on the Organization model yet (see
// backend/prisma/schema.prisma), so they're kept client-side per org until a
// migration adds them. name/slug persist for real via OrganizationDetailService.
function extrasKey(orgId: string): string {
  return `sf.org.${orgId}.extras`;
}
function readExtras(orgId: string): { logoUrl: string; defaultTimezone: string } {
  try {
    const raw = JSON.parse(window.localStorage.getItem(extrasKey(orgId)) ?? '{}');
    return { logoUrl: raw.logoUrl ?? '', defaultTimezone: raw.defaultTimezone ?? 'UTC' };
  } catch {
    return { logoUrl: '', defaultTimezone: 'UTC' };
  }
}
function writeExtras(orgId: string, extras: { logoUrl: string; defaultTimezone: string }): void {
  window.localStorage.setItem(extrasKey(orgId), JSON.stringify(extras));
}

const TIMEZONES = [
  'UTC',
  'America/New_York',
  'America/Los_Angeles',
  'Europe/London',
  'Europe/Berlin',
  'Asia/Tokyo',
  'Asia/Kolkata',
];
const ASSIGNABLE_ROLES: OrgRole[] = ['member', 'admin', 'owner'];

interface ConfirmState {
  title: string;
  body: string;
  confirmLabel: string;
  onConfirm: () => void;
}

export function OrganizationSection(): React.JSX.Element {
  const [orgs, setOrgs] = useState<OrgSummary[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [activeOrgId, setActiveOrgId] = useState<string | null>(() =>
    window.localStorage.getItem(ACTIVE_ORG_STORAGE_KEY),
  );

  const [detail, setDetail] = useState<OrganizationDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const [newOrgName, setNewOrgName] = useState('');
  const [newOrgSlug, setNewOrgSlug] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [settingsName, setSettingsName] = useState('');
  const [settingsSlug, setSettingsSlug] = useState('');
  const [settingsLogo, setSettingsLogo] = useState('');
  const [settingsTz, setSettingsTz] = useState('UTC');
  const [savingSettings, setSavingSettings] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);

  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<OrgRole>('member');
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);

  const [memberActionError, setMemberActionError] = useState<string | null>(null);
  const [busyUserId, setBusyUserId] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);

  // Load the organizations the user belongs to.
  useEffect(() => {
    let cancelled = false;
    OrganizationsService.getOrganizations()
      .then((list) => {
        if (cancelled) return;
        const summaries = list.map((o) => ({ id: o.id ?? '', name: o.name ?? 'Untitled' }));
        setOrgs(summaries);
        setListError(null);
        setActiveOrgId((prev) =>
          prev && summaries.some((o) => o.id === prev) ? prev : (summaries[0]?.id ?? null),
        );
      })
      .catch(
        (err) =>
          !cancelled &&
          setListError(err instanceof Error ? err.message : 'Failed to load organizations'),
      );
    return () => {
      cancelled = true;
    };
  }, []);

  // All org-scoped data refetches whenever the active org changes.
  useEffect(() => {
    if (activeOrgId) {
      window.localStorage.setItem(ACTIVE_ORG_STORAGE_KEY, activeOrgId);
    } else {
      window.localStorage.removeItem(ACTIVE_ORG_STORAGE_KEY);
    }

    if (!activeOrgId) {
      setDetail(null);
      return;
    }

    let cancelled = false;
    setLoadingDetail(true);
    setDetailError(null);
    OrganizationDetailService.getOrganizationDetail(activeOrgId)
      .then((d) => {
        if (cancelled) return;
        setDetail(d);
        setSettingsName(d.name);
        setSettingsSlug(d.slug);
        const extras = readExtras(d.id);
        setSettingsLogo(extras.logoUrl);
        setSettingsTz(extras.defaultTimezone);
      })
      .catch(
        (err) =>
          !cancelled &&
          setDetailError(err instanceof Error ? err.message : 'Failed to load organization'),
      )
      .finally(() => !cancelled && setLoadingDetail(false));
    return () => {
      cancelled = true;
    };
  }, [activeOrgId]);

  const ownerCount = useMemo(
    () => detail?.members.filter((m) => m.role === 'owner').length ?? 0,
    [detail],
  );
  const canManageMembers = detail?.role === 'owner' || detail?.role === 'admin';
  const isDirty =
    !!detail &&
    (settingsName !== detail.name ||
      settingsSlug !== detail.slug ||
      settingsLogo !== readExtras(detail.id).logoUrl ||
      settingsTz !== readExtras(detail.id).defaultTimezone);
  useUnsavedChanges(isDirty);

  async function handleCreateOrg(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (!newOrgName.trim() || !newOrgSlug.trim()) return;
    setCreating(true);
    setCreateError(null);
    try {
      const requestBody = { name: newOrgName.trim(), slug: newOrgSlug.trim() };
      const org = await OrganizationsService.postOrganizations({ requestBody });
      const summary = { id: org.id ?? '', name: org.name ?? newOrgName.trim() };
      setOrgs((prev) => (prev ? [...prev, summary] : [summary]));
      setActiveOrgId(summary.id);
      setNewOrgName('');
      setNewOrgSlug('');
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Failed to create organization');
    } finally {
      setCreating(false);
    }
  }

  async function handleSaveSettings(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (!activeOrgId) return;
    setSavingSettings(true);
    setSettingsError(null);
    try {
      const updated = await OrganizationDetailService.updateOrganization(activeOrgId, {
        name: settingsName.trim(),
        slug: settingsSlug.trim(),
      });
      writeExtras(activeOrgId, { logoUrl: settingsLogo.trim(), defaultTimezone: settingsTz });
      setDetail((prev) => (prev ? { ...prev, name: updated.name, slug: updated.slug } : prev));
      setOrgs(
        (prev) =>
          prev?.map((o) => (o.id === activeOrgId ? { ...o, name: updated.name } : o)) ?? prev,
      );
    } catch (err) {
      setSettingsError(err instanceof Error ? err.message : 'Failed to save organization settings');
    } finally {
      setSavingSettings(false);
    }
  }

  async function handleInvite(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (!activeOrgId || !inviteEmail.trim()) return;
    setInviting(true);
    setInviteError(null);
    try {
      await OrganizationDetailService.inviteMember(activeOrgId, {
        email: inviteEmail.trim(),
        role: inviteRole,
      });
      const refreshed = await OrganizationDetailService.getOrganizationDetail(activeOrgId);
      setDetail(refreshed);
      setInviteEmail('');
      setInviteRole('member');
    } catch (err) {
      setInviteError(err instanceof Error ? err.message : 'Failed to invite member');
    } finally {
      setInviting(false);
    }
  }

  async function refetchDetail(): Promise<void> {
    if (!activeOrgId) return;
    const refreshed = await OrganizationDetailService.getOrganizationDetail(activeOrgId);
    setDetail(refreshed);
  }

  function requestRoleChange(userId: string, currentRole: OrgRole, nextRole: OrgRole): void {
    if (nextRole === currentRole || !activeOrgId) return;
    setConfirm({
      title: 'Change member role',
      body: `Change this member's role from "${currentRole}" to "${nextRole}"?`,
      confirmLabel: 'Change role',
      onConfirm: async () => {
        setConfirm(null);
        setBusyUserId(userId);
        setMemberActionError(null);
        try {
          await OrganizationDetailService.updateMemberRole(activeOrgId, userId, nextRole);
          await refetchDetail();
        } catch (err) {
          setMemberActionError(err instanceof Error ? err.message : 'Failed to change role');
        } finally {
          setBusyUserId(null);
        }
      },
    });
  }

  function requestRemove(userId: string, label: string): void {
    if (!activeOrgId) return;
    setConfirm({
      title: 'Remove member',
      body: `Remove ${label} from this organization? They will lose access immediately.`,
      confirmLabel: 'Remove',
      onConfirm: async () => {
        setConfirm(null);
        setBusyUserId(userId);
        setMemberActionError(null);
        try {
          await OrganizationDetailService.removeMember(activeOrgId, userId);
          await refetchDetail();
        } catch (err) {
          setMemberActionError(err instanceof Error ? err.message : 'Failed to remove member');
        } finally {
          setBusyUserId(null);
        }
      },
    });
  }

  return (
    <div className="max-w-3xl space-y-8">
      <div>
        <h2 className="text-lg font-bold text-white">Organizations</h2>
        <p className="text-sm text-gray-subtext">
          Manage the organizations you belong to and their members.
        </p>
      </div>

      {listError && <p className="text-sm text-trend-down">{listError}</p>}

      {/* Org list + active indicator */}
      <div className="space-y-2">
        {orgs === null && <p className="text-sm text-gray-subtext">Loading organizations…</p>}
        {orgs?.map((org) => (
          <button
            key={org.id}
            onClick={() => setActiveOrgId(org.id)}
            className={`w-full flex items-center justify-between px-4 py-3 rounded-xl border text-left text-sm font-semibold transition-all ${
              org.id === activeOrgId
                ? 'bg-primary-blue/20 border-primary-blue/40 text-primary-blue'
                : 'border-dark-border text-gray-200 hover:border-white/20'
            }`}
          >
            <span>{org.name}</span>
            {org.id === activeOrgId && (
              <span className="text-xs font-bold uppercase tracking-wide">Active</span>
            )}
          </button>
        ))}
        {orgs && orgs.length === 0 && (
          <p className="text-sm text-gray-subtext">You don't belong to any organization yet.</p>
        )}
      </div>

      {/* Create org */}
      <form
        onSubmit={handleCreateOrg}
        className="rounded-xl border border-dark-border bg-dark-surface p-5 space-y-4"
      >
        <h3 className="text-sm font-bold text-white">Create a new organization</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <input
            value={newOrgName}
            onChange={(e) => setNewOrgName(e.target.value)}
            placeholder="Name"
            className="rounded-xl bg-dark-bg/60 border border-dark-border px-4 py-2.5 text-sm text-white focus:outline-none focus:border-primary-blue/50"
          />
          <input
            value={newOrgSlug}
            onChange={(e) => setNewOrgSlug(e.target.value)}
            placeholder="slug-like-this"
            className="rounded-xl bg-dark-bg/60 border border-dark-border px-4 py-2.5 text-sm text-white focus:outline-none focus:border-primary-blue/50"
          />
        </div>
        {createError && <p className="text-xs text-trend-down">{createError}</p>}
        <button
          type="submit"
          disabled={creating || !newOrgName.trim() || !newOrgSlug.trim()}
          className="px-5 py-2.5 rounded-xl bg-primary-blue text-white text-sm font-bold disabled:opacity-40"
        >
          {creating ? 'Creating…' : 'Create organization'}
        </button>
      </form>

      {activeOrgId && (
        <>
          {loadingDetail && <p className="text-sm text-gray-subtext">Loading organization…</p>}
          {detailError && <p className="text-sm text-trend-down">{detailError}</p>}

          {detail && (
            <>
              {/* Org settings */}
              <form
                onSubmit={handleSaveSettings}
                className="rounded-xl border border-dark-border bg-dark-surface p-5 space-y-4"
              >
                <h3 className="text-sm font-bold text-white">Organization settings</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <label className="block">
                    <span className="text-[11px] font-bold uppercase tracking-widest text-gray-subtext">
                      Name
                    </span>
                    <input
                      value={settingsName}
                      onChange={(e) => setSettingsName(e.target.value)}
                      disabled={!canManageMembers}
                      className="mt-2 w-full rounded-xl bg-dark-bg/60 border border-dark-border px-4 py-2.5 text-sm text-white disabled:opacity-50 focus:outline-none focus:border-primary-blue/50"
                    />
                  </label>
                  <label className="block">
                    <span className="text-[11px] font-bold uppercase tracking-widest text-gray-subtext">
                      Slug
                    </span>
                    <input
                      value={settingsSlug}
                      onChange={(e) => setSettingsSlug(e.target.value)}
                      disabled={!canManageMembers}
                      className="mt-2 w-full rounded-xl bg-dark-bg/60 border border-dark-border px-4 py-2.5 text-sm text-white disabled:opacity-50 focus:outline-none focus:border-primary-blue/50"
                    />
                  </label>
                  <label className="block">
                    <span className="text-[11px] font-bold uppercase tracking-widest text-gray-subtext">
                      Logo URL
                    </span>
                    <input
                      value={settingsLogo}
                      onChange={(e) => setSettingsLogo(e.target.value)}
                      disabled={!canManageMembers}
                      placeholder="https://…"
                      className="mt-2 w-full rounded-xl bg-dark-bg/60 border border-dark-border px-4 py-2.5 text-sm text-white disabled:opacity-50 focus:outline-none focus:border-primary-blue/50"
                    />
                  </label>
                  <label className="block">
                    <span className="text-[11px] font-bold uppercase tracking-widest text-gray-subtext">
                      Default timezone
                    </span>
                    <select
                      value={settingsTz}
                      onChange={(e) => setSettingsTz(e.target.value)}
                      disabled={!canManageMembers}
                      className="mt-2 w-full rounded-xl bg-dark-bg/60 border border-dark-border px-4 py-2.5 text-sm text-white disabled:opacity-50 focus:outline-none focus:border-primary-blue/50"
                    >
                      {TIMEZONES.map((tz) => (
                        <option key={tz} value={tz}>
                          {tz}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                {!canManageMembers && (
                  <p className="text-xs text-gray-subtext">
                    Only owners and admins can edit organization settings.
                  </p>
                )}
                {settingsError && <p className="text-xs text-trend-down">{settingsError}</p>}
                <button
                  type="submit"
                  disabled={savingSettings || !isDirty || !canManageMembers}
                  className="px-5 py-2.5 rounded-xl bg-primary-blue text-white text-sm font-bold disabled:opacity-40"
                >
                  {savingSettings ? 'Saving…' : 'Save settings'}
                </button>
              </form>

              {/* Members */}
              <div className="rounded-xl border border-dark-border bg-dark-surface p-5 space-y-4">
                <h3 className="text-sm font-bold text-white">Members</h3>
                {memberActionError && (
                  <p className="text-xs text-trend-down">{memberActionError}</p>
                )}

                <div className="space-y-2">
                  {detail.members.map((m) => {
                    const isLastOwner = m.role === 'owner' && ownerCount <= 1;
                    const rowBusy = busyUserId === m.userId;
                    return (
                      <div
                        key={m.userId}
                        className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 rounded-xl border border-dark-border"
                      >
                        <div>
                          <p className="text-sm font-semibold text-white">
                            {m.user?.email ?? m.userId}
                          </p>
                          {isLastOwner && (
                            <p className="text-xs text-gray-subtext">
                              Last remaining owner — protected from removal or demotion.
                            </p>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <select
                            value={m.role}
                            disabled={
                              !canManageMembers ||
                              rowBusy ||
                              isLastOwner ||
                              (m.role === 'owner' && detail.role !== 'owner')
                            }
                            onChange={(e) =>
                              requestRoleChange(m.userId, m.role, e.target.value as OrgRole)
                            }
                            className="rounded-lg bg-dark-bg/60 border border-dark-border px-3 py-1.5 text-xs text-white disabled:opacity-50"
                          >
                            {ASSIGNABLE_ROLES.map((r) => (
                              <option
                                key={r}
                                value={r}
                                disabled={r === 'owner' && detail.role !== 'owner'}
                              >
                                {r}
                              </option>
                            ))}
                          </select>
                          <button
                            onClick={() => requestRemove(m.userId, m.user?.email ?? m.userId)}
                            disabled={!canManageMembers || rowBusy || isLastOwner}
                            className="px-3 py-1.5 rounded-lg border border-dark-border text-xs font-bold text-trend-down disabled:opacity-30 hover:border-trend-down/40"
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {canManageMembers && (
                  <form
                    onSubmit={handleInvite}
                    className="flex flex-wrap gap-3 pt-2 border-t border-dark-border"
                  >
                    <input
                      type="email"
                      required
                      value={inviteEmail}
                      onChange={(e) => setInviteEmail(e.target.value)}
                      placeholder="teammate@company.com"
                      className="flex-1 min-w-[200px] rounded-xl bg-dark-bg/60 border border-dark-border px-4 py-2.5 text-sm text-white focus:outline-none focus:border-primary-blue/50"
                    />
                    <select
                      value={inviteRole}
                      onChange={(e) => setInviteRole(e.target.value as OrgRole)}
                      className="rounded-xl bg-dark-bg/60 border border-dark-border px-3 py-2.5 text-sm text-white"
                    >
                      {ASSIGNABLE_ROLES.map((r) => (
                        <option
                          key={r}
                          value={r}
                          disabled={r === 'owner' && detail.role !== 'owner'}
                        >
                          {r}
                        </option>
                      ))}
                    </select>
                    <button
                      type="submit"
                      disabled={inviting}
                      className="px-5 py-2.5 rounded-xl bg-primary-blue text-white text-sm font-bold disabled:opacity-40"
                    >
                      {inviting ? 'Inviting…' : 'Invite by email'}
                    </button>
                    {inviteError && <p className="w-full text-xs text-trend-down">{inviteError}</p>}
                  </form>
                )}
              </div>
            </>
          )}
        </>
      )}

      {confirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-sm rounded-xl border border-dark-border bg-dark-elev p-6 space-y-4">
            <h4 className="text-base font-bold text-white">{confirm.title}</h4>
            <p className="text-sm text-gray-subtext">{confirm.body}</p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setConfirm(null)}
                className="px-4 py-2 rounded-lg text-sm font-semibold text-gray-300 hover:text-white"
              >
                Cancel
              </button>
              <button
                onClick={confirm.onConfirm}
                className="px-4 py-2 rounded-lg bg-trend-down text-white text-sm font-bold"
              >
                {confirm.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default OrganizationSection;
