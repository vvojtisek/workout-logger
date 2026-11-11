import { useQueryClient } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

import { ApiError, apiFetch } from "@/api/client";
import type { CurrentUser } from "@/api/types";

type AuthStatus = "loading" | "authenticated" | "unauthenticated" | "offline";
const LAST_ACCOUNT_KEY = "workout_logger_last_verified_account";

interface AuthState {
  user: CurrentUser | null;
  status: AuthStatus;
  accountId: string | null;
}

interface AuthContextValue extends AuthState {
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);
const SIGNED_OUT: AuthState = { user: null, status: "unauthenticated", accountId: null };

function readLastAccount(): string | null {
  try {
    return localStorage.getItem(LAST_ACCOUNT_KEY);
  } catch {
    return null;
  }
}

function writeLastAccount(accountId: string | null) {
  try {
    if (accountId) localStorage.setItem(LAST_ACCOUNT_KEY, accountId);
    else localStorage.removeItem(LAST_ACCOUNT_KEY);
  } catch {
    // Server sign-in remains available if local storage is disabled.
  }
}

function offlineAccount(): AuthState {
  const accountId = readLastAccount();
  return accountId ? { user: null, status: "offline", accountId } : SIGNED_OUT;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [auth, setAuth] = useState<AuthState>({ ...SIGNED_OUT, status: "loading" });
  const queryClient = useQueryClient();
  const attempt = useRef(0);

  const refresh = useCallback(async () => {
    const current = ++attempt.current;
    if (!navigator.onLine) {
      setAuth(offlineAccount());
      return;
    }
    try {
      const me = await apiFetch<CurrentUser>("/auth/me");
      if (current !== attempt.current) return;
      if (readLastAccount() !== me.id) queryClient.clear();
      writeLastAccount(me.id);
      setAuth({ user: me, status: "authenticated", accountId: me.id });
    } catch (error) {
      if (current !== attempt.current) return;
      if (error instanceof TypeError || (error instanceof ApiError && error.status >= 500)) {
        setAuth(offlineAccount());
      } else {
        writeLastAccount(null);
        queryClient.clear();
        setAuth(SIGNED_OUT);
      }
    }
  }, [queryClient]);

  useEffect(() => {
    void refresh();
    const connectionChanged = () => void refresh();
    const accountChanged = (event: StorageEvent) => {
      if (event.key !== LAST_ACCOUNT_KEY) return;
      if (event.newValue) {
        queryClient.clear();
        setAuth({ ...SIGNED_OUT, status: "loading" });
        void refresh();
      } else {
        attempt.current += 1;
        queryClient.clear();
        setAuth(SIGNED_OUT);
      }
    };
    window.addEventListener("online", connectionChanged);
    window.addEventListener("offline", connectionChanged);
    window.addEventListener("storage", accountChanged);
    return () => {
      window.removeEventListener("online", connectionChanged);
      window.removeEventListener("offline", connectionChanged);
      window.removeEventListener("storage", accountChanged);
    };
  }, [queryClient, refresh]);

  const logout = useCallback(async () => {
    attempt.current += 1;
    writeLastAccount(null);
    try {
      await apiFetch("/auth/logout", { method: "POST" });
    } finally {
      attempt.current += 1;
      writeLastAccount(null);
      queryClient.clear();
      setAuth(SIGNED_OUT);
    }
  }, [queryClient]);

  return (
    <AuthContext.Provider value={{ ...auth, refresh, logout }}>
      {children}
    </AuthContext.Provider>
  );
}
