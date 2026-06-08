import { createFileRoute } from "@tanstack/react-router";
import { LoginShell } from "@/components/LoginShell";

export const Route = createFileRoute("/secure/gate-access")({
  head: () => ({ meta: [{ title: "Gatekeeper Access" }, { name: "robots", content: "noindex, nofollow" }] }),
  component: () => (
    <LoginShell
      scope="gatekeeper"
      expectedRole="gatekeeper"
      successPath="/gatekeeper"
      title="Gatekeeper Access"
      theme="navy"
    />
  ),
});
