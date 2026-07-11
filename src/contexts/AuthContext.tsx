import React, { createContext, useContext, useMemo, useState, useCallback } from 'react';

const TOKEN_KEY = 'sf_auth_token';
const USER_KEY = 'sf_auth_user';

export interface AuthUser {
  name: string;
  email: string;
  plan: string;
}

interface AuthContextValue {
  isAuthenticated: boolean;
  user: AuthUser | null;
  login: (email: string) => void;
  logout: () => void;
}

const DEFAULT_USER: AuthUser = { name: 'Alex Morgan', email: 'alex@socialflow.ai', plan: 'Pro Plan' };

const AuthContext = createContext<AuthContextValue | null>(null);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(TOKEN_KEY));
  const [user, setUser] = useState<AuthUser | null>(() => {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? (JSON.parse(raw) as AuthUser) : null;
  });

  const login = useCallback((email: string) => {
    const nextUser: AuthUser = {
      ...DEFAULT_USER,
      email: email || DEFAULT_USER.email,
      name: email ? email.split('@')[0].replace(/^\w/, (c) => c.toUpperCase()) : DEFAULT_USER.name,
    };
    const nextToken = `demo-${Date.now()}`;
    localStorage.setItem(TOKEN_KEY, nextToken);
    localStorage.setItem(USER_KEY, JSON.stringify(nextUser));
    setToken(nextToken);
    setUser(nextUser);
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    setToken(null);
    setUser(null);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ isAuthenticated: !!token, user: user ?? DEFAULT_USER, login, logout }),
    [token, user, login, logout]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = (): AuthContextValue => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
};
