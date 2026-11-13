import { Navigate, Outlet, useLocation } from "react-router-dom";

import { useAuth } from "@/auth/AuthContext";

export function RequireAuth() {
  const { status, accountId } = useAuth();
  const location = useLocation();

  if (status === "loading") {
    return (
      <div className="flex min-h-dvh items-center justify-center text-sm text-muted">
        Loading…
      </div>
    );
  }

  if (status === "unauthenticated") {
    if (!navigator.onLine) {
      return (
        <div className="flex min-h-dvh items-center justify-center text-sm text-muted">
          Reconnect to sign in.
        </div>
      );
    }
    const from = `${location.pathname}${location.search}`;
    return <Navigate to="/login" replace state={{ from }} />;
  }

  if (status === "offline" && location.pathname !== "/workout") {
    return <Navigate to="/workout" replace />;
  }

  return <Outlet key={accountId} />;
}
