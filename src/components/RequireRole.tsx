import { Navigate } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useAuth } from "@/lib/auth-context";
import type { Role } from "@/lib/supabase";

export function RequireRole({ role, loginPath, children }: { role: Role; loginPath: string; children: ReactNode }) {
  const { loading, profile } = useAuth();
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }
  if (!profile) return <Navigate to={loginPath} />;
  if (profile.role !== role) {
    // silently route to their correct dashboard
    if (profile.role === "admin") return <Navigate to="/admin" />;
    if (profile.role === "gatekeeper") return <Navigate to="/gatekeeper" />;
    return <Navigate to="/worker" />;
  }
  return <>{children}</>;
}
