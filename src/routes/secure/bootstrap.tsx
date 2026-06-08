import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { bootstrapFirstAdmin } from "@/lib/admin-accounts.functions";

export const Route = createFileRoute("/secure/bootstrap")({
  head: () => ({ meta: [{ title: "First-time setup" }, { name: "robots", content: "noindex, nofollow" }] }),
  component: BootstrapPage,
});

function BootstrapPage() {
  const navigate = useNavigate();
  const [setupKey, setSetupKey] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [empId, setEmpId] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await bootstrapFirstAdmin({
        data: {
          setupKey,
          email: email.trim().toLowerCase(),
          password,
          full_name: fullName.trim(),
          employee_id: empId.trim(),
        },
      });
      setOk(true);
      setTimeout(() => navigate({ to: "/secure/admin-panel" }), 1500);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0a0a0a] px-4 text-white">
      <div className="w-full max-w-md rounded-2xl bg-white/5 border border-white/10 backdrop-blur p-8">
        <h1 className="text-2xl font-semibold">First-time setup</h1>
        <p className="mt-1 text-sm opacity-70">Create the first admin account.</p>
        {ok ? (
          <div className="mt-6 rounded-md bg-green-500/15 border border-green-500/30 px-4 py-3 text-sm">
            Admin created. Redirecting to admin login…
          </div>
        ) : (
          <form onSubmit={submit} className="mt-6 space-y-3">
            <Input label="Setup key" type="password" value={setupKey} onChange={setSetupKey} />
            <Input label="Email" type="email" value={email} onChange={setEmail} />
            <Input label="Password (min 8 chars)" type="password" value={password} onChange={setPassword} />
            <Input label="Full name" value={fullName} onChange={setFullName} />
            <Input label="Employee ID" value={empId} onChange={setEmpId} />
            {err && <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{err}</div>}
            <button disabled={busy} className="w-full rounded-md bg-accent px-4 py-2.5 text-sm font-medium text-accent-foreground disabled:opacity-60">
              {busy ? "Creating…" : "Create admin"}
            </button>
            <p className="text-xs opacity-60 mt-3">
              The setup key is your Supabase database password. This page disables itself once an admin exists.
            </p>
          </form>
        )}
      </div>
    </div>
  );
}

function Input({ label, type = "text", value, onChange }: { label: string; type?: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="block text-xs uppercase tracking-wider opacity-70">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required
        className="mt-1 w-full rounded-md border border-white/15 bg-transparent px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-accent"
      />
    </div>
  );
}
