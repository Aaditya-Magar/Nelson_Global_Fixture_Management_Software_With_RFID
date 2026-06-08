import { createFileRoute } from "@tanstack/react-router";
import { LoginShell } from "@/components/LoginShell";

export const Route = createFileRoute("/login")({
  head: () => ({ meta: [{ title: "Nelson Global — Employee Portal" }] }),
  component: () => (
    <LoginShell
      scope="worker"
      expectedRole="worker"
      successPath="/worker"
      title="Nelson Global"
      subtitle="Employee Portal"
      theme="light"
    />
  ),
});
