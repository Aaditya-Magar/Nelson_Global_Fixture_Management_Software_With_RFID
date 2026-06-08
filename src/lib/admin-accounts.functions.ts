import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";

// Server-only: uses service-role key from runtime env. Never imported from a component.
function admin() {
  const url =
    process.env.EXTERNAL_SUPABASE_URL ?? "https://humzkucjcxolhxusmmfv.supabase.co";
  const key = process.env.EXTERNAL_SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("Missing EXTERNAL_SUPABASE_SERVICE_ROLE_KEY");
  return createClient(url, key, { auth: { persistSession: false } });
}

const CreateInput = z.object({
  callerAccessToken: z.string().min(10),
  email: z.string().email().max(255),
  password: z.string().min(8).max(100).regex(/[A-Z]/, "Password needs one capital letter"),
  full_name: z.string().min(1).max(100),
  employee_id: z.string().min(1).max(50),
  role: z.enum(["worker", "gatekeeper"]),
  department: z.string().max(100).optional().nullable(),
  phone: z.string().max(30).optional().nullable(),
});

export const createAccount = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => CreateInput.parse(d))
  .handler(async ({ data }) => {
    const sb = admin();
    // Verify caller is admin
    const { data: caller, error: cErr } = await sb.auth.getUser(data.callerAccessToken);
    if (cErr || !caller.user) throw new Error("Unauthorized");
    const { data: callerProfile } = await sb
      .from("profiles")
      .select("role,is_active")
      .eq("id", caller.user.id)
      .maybeSingle();
    if (!callerProfile || callerProfile.role !== "admin" || callerProfile.is_active === false) {
      throw new Error("Unauthorized");
    }

    const { data: created, error: uErr } = await sb.auth.admin.createUser({
      email: data.email,
      password: data.password,
      email_confirm: true,
    });
    if (uErr || !created.user) {
      const msg = uErr?.message?.toLowerCase() ?? "";
      if (msg.includes("already") || msg.includes("registered")) throw new Error("This email is already used. Try another email.");
      if (msg.includes("password")) throw new Error("Password must be at least 8 characters and include one capital letter.");
      throw new Error("Account could not be created. Please check the highlighted fields.");
    }

    const { error: pErr } = await sb.from("profiles").insert({
      id: created.user.id,
      full_name: data.full_name,
      employee_id: data.employee_id,
      role: data.role,
      department: data.department ?? null,
      phone: data.phone ?? null,
      is_active: true,
    });
    if (pErr) {
      await sb.auth.admin.deleteUser(created.user.id);
      const msg = pErr.message.toLowerCase();
      if (msg.includes("employee") || msg.includes("duplicate") || msg.includes("unique")) {
        throw new Error("Employee ID is already used. Enter a different Employee ID.");
      }
      throw new Error("Profile details could not be saved. Please check the form fields.");
    }
    return { id: created.user.id };
  });

const DeactivateInput = z.object({
  callerAccessToken: z.string(),
  userId: z.string().uuid(),
  active: z.boolean(),
});

export const setAccountActive = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => DeactivateInput.parse(d))
  .handler(async ({ data }) => {
    const sb = admin();
    const { data: caller } = await sb.auth.getUser(data.callerAccessToken);
    if (!caller.user) throw new Error("Unauthorized");
    const { data: cp } = await sb
      .from("profiles")
      .select("role")
      .eq("id", caller.user.id)
      .maybeSingle();
    if (cp?.role !== "admin") throw new Error("Unauthorized");

    await sb.from("profiles").update({ is_active: data.active }).eq("id", data.userId);
    // Ban or unban
    await sb.auth.admin.updateUserById(data.userId, {
      ban_duration: data.active ? "none" : "8760h",
    });
    return { ok: true };
  });

const BootstrapInput = z.object({
  setupKey: z.string(),
  email: z.string().email(),
  password: z.string().min(8),
  full_name: z.string().min(1),
  employee_id: z.string().min(1),
});

// One-time bootstrap: create the first admin. Uses EXTERNAL_DB_PASSWORD as setup key.
export const bootstrapFirstAdmin = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => BootstrapInput.parse(d))
  .handler(async ({ data }) => {
    const expected = process.env.EXTERNAL_DB_PASSWORD;
    if (!expected || data.setupKey !== expected) throw new Error("Invalid setup key");
    const sb = admin();
    const { count } = await sb.from("profiles").select("*", { count: "exact", head: true }).eq("role", "admin");
    if ((count ?? 0) > 0) throw new Error("An admin already exists");

    const { data: created, error } = await sb.auth.admin.createUser({
      email: data.email,
      password: data.password,
      email_confirm: true,
    });
    if (error || !created.user) throw new Error(error?.message ?? "Create failed");

    const { error: pErr } = await sb.from("profiles").insert({
      id: created.user.id,
      full_name: data.full_name,
      employee_id: data.employee_id,
      role: "admin",
      is_active: true,
    });
    if (pErr) {
      await sb.auth.admin.deleteUser(created.user.id);
      throw new Error(pErr.message);
    }
    return { ok: true };
  });
