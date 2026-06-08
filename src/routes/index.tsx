import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth-context";

export const Route = createFileRoute("/")({
  component: IndexRedirect,
});

function IndexRedirect() {
  const { loading, profile } = useAuth();
  if (loading) return <FullScreenLoader />;
  if (!profile) return <Navigate to="/login" />;
  if (profile.role === "admin") return <Navigate to="/admin" />;
  if (profile.role === "gatekeeper") return <Navigate to="/gatekeeper" />;
  return <Navigate to="/worker" />;
}

function FullScreenLoader() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
    </div>
  );
}
