import { createFileRoute } from "@tanstack/react-router";
import { LoginShell } from "@/components/LoginShell";

export const Route = createFileRoute("/secure/admin-panel")({
  head: () => ({ meta: [{ title: "System Administration" }, { name: "robots", content: "noindex, nofollow" }] }),
  component: () => (
    <LoginShell
      scope="admin"
      expectedRole="admin"
      successPath="/admin"
      title="System Administration"
      theme="dark"
    />
  ),
});
