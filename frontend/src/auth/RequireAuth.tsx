import { Navigate, Outlet, useLocation } from "react-router-dom";

import { useAuth } from "@/auth/AuthContext";

export function RequireAuth() {
  const { status } = useAuth();
  const location = useLocation();

  if (status === "loading") {
    return (
      <div className="flex min-h-dvh items-center justify-center text-sm text-muted">
        Loading…
      </div>
    );
  }

  if (status === "unauthenticated") {
    const from = `${location.pathname}${location.search}`;
    return <Navigate to="/login" replace state={{ from }} />;
  }

  return <Outlet />;
}
