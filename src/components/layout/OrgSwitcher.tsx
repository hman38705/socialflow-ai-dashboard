import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Check, ChevronDown, Loader2, Plus } from 'lucide-react';
import { OrganizationsService } from '../../api/services/OrganizationsService';
import { ApiError } from '../../api/core/ApiError';
import type { Organization } from '../../api/models/Organization';
import { AUTH_LOGOUT_EVENT } from '../../contexts/AuthContext';

const ACTIVE_ORG_KEY = 'sf_active_org_id';
export const ORG_CHANGED_EVENT = 'org:changed';

interface OrgContextValue {
  organizations: Organization[];
  activeOrgId: string | null;
  activeOrg: Organization | null;
  loading: boolean;
  switchOrg: (orgId: string) => void;
  createOrg: (name: string) => Promise<Organization>;
}

const OrgContext = createContext<OrgContextValue | null>(null);

export const OrgProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [activeOrgId, setActiveOrgId] = useState<string | null>(() =>
    localStorage.getItem(ACTIVE_ORG_KEY),
  );
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const orgs = await OrganizationsService.getOrganizations();
        if (cancelled) return;
        setOrganizations(orgs);
        setActiveOrgId((current) => {
          if (current && orgs.some((o) => o.id === current)) return current;
          const fallback = orgs[0]?.id ?? null;
          if (fallback) localStorage.setItem(ACTIVE_ORG_KEY, fallback);
          return fallback;
        });
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const onLogout = () => {
      setOrganizations([]);
      setActiveOrgId(null);
      localStorage.removeItem(ACTIVE_ORG_KEY);
    };
    window.addEventListener(AUTH_LOGOUT_EVENT, onLogout);
    return () => window.removeEventListener(AUTH_LOGOUT_EVENT, onLogout);
  }, []);

  const switchOrg = useCallback((orgId: string) => {
    setActiveOrgId(orgId);
    localStorage.setItem(ACTIVE_ORG_KEY, orgId);
    // Org-scoped data (analytics, posts, webhooks) is fetched and cached by its
    // own hooks, keyed by org id — broadcast the switch so they can invalidate
    // without this component depending on every one of them directly.
    window.dispatchEvent(new CustomEvent(ORG_CHANGED_EVENT, { detail: { orgId } }));
  }, []);

  const createOrg = useCallback(
    async (name: string): Promise<Organization> => {
      const org = await OrganizationsService.postOrganizations({ requestBody: { name } });
      setOrganizations((prev) => [...prev, org]);
      if (org.id) switchOrg(org.id);
      return org;
    },
    [switchOrg],
  );

  const activeOrg = useMemo(
    () => organizations.find((o) => o.id === activeOrgId) ?? null,
    [organizations, activeOrgId],
  );

  const value = useMemo<OrgContextValue>(
    () => ({ organizations, activeOrgId, activeOrg, loading, switchOrg, createOrg }),
    [organizations, activeOrgId, activeOrg, loading, switchOrg, createOrg],
  );

  return <OrgContext.Provider value={value}>{children}</OrgContext.Provider>;
};

export function useOrg(): OrgContextValue {
  const ctx = useContext(OrgContext);
  if (!ctx) {
    throw new Error('useOrg must be used within an OrgProvider');
  }
  return ctx;
}

const CreateOrgModal: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { createOrg } = useOrg();
  const [name, setName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Enter an organization name.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await createOrg(trimmed);
      onClose();
    } catch (err) {
      setError(
        err instanceof ApiError
          ? 'Could not create the organization. Check the name and try again.'
          : 'Something went wrong. Please try again.',
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
    >
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm rounded-xl border border-dark-border bg-dark-elev p-6 space-y-4"
      >
        <h2 className="text-lg font-bold text-white">Create organization</h2>
        <label className="block">
          <span className="text-[11px] font-bold uppercase tracking-widest text-gray-subtext">
            Name
          </span>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="mt-2 w-full rounded-lg bg-dark-bg/60 border border-dark-border px-3 py-2 text-sm text-white focus:outline-none focus:border-primary-blue/50"
            placeholder="Acme Inc."
          />
        </label>
        {error && <p className="text-sm text-trend-down">{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm rounded-lg text-gray-subtext hover:text-white transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="px-4 py-2 text-sm rounded-lg bg-primary-blue text-white disabled:opacity-60 flex items-center gap-2"
          >
            {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
            Create
          </button>
        </div>
      </form>
    </div>
  );
};

export const OrgSwitcher: React.FC = () => {
  const { organizations, activeOrg, switchOrg, loading } = useOrg();
  const [open, setOpen] = useState(false);
  const [showCreate, setShowCreate] = useState(false);

  if (loading) {
    return <div className="h-9 w-40 rounded-lg bg-dark-elev animate-pulse" />;
  }

  if (organizations.length <= 1) {
    return (
      <span className="text-sm font-medium text-white truncate max-w-[12rem]">
        {activeOrg?.name ?? 'Personal workspace'}
      </span>
    );
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 rounded-lg border border-dark-border bg-dark-elev/60 px-3 py-2 text-sm text-white hover:border-primary-blue/50 transition-colors"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="truncate max-w-[10rem]">{activeOrg?.name ?? 'Select organization'}</span>
        <ChevronDown className="w-4 h-4 text-gray-subtext" />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div
            role="listbox"
            className="absolute right-0 z-20 mt-2 w-64 rounded-xl border border-dark-border bg-dark-elev shadow-elev-3 p-1"
          >
            {organizations.map((org) => (
              <button
                key={org.id}
                type="button"
                role="option"
                aria-selected={org.id === activeOrg?.id}
                onClick={() => {
                  if (org.id) switchOrg(org.id);
                  setOpen(false);
                }}
                className="flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm text-left text-white hover:bg-white/5"
              >
                <span className="truncate">{org.name}</span>
                {org.id === activeOrg?.id && <Check className="w-4 h-4 text-primary-blue" />}
              </button>
            ))}
            <div className="my-1 border-t border-dark-border" />
            <button
              type="button"
              onClick={() => {
                setShowCreate(true);
                setOpen(false);
              }}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-left text-gray-subtext hover:text-white hover:bg-white/5"
            >
              <Plus className="w-4 h-4" />
              Create organization
            </button>
          </div>
        </>
      )}

      {showCreate && <CreateOrgModal onClose={() => setShowCreate(false)} />}
    </div>
  );
};

export default OrgSwitcher;
