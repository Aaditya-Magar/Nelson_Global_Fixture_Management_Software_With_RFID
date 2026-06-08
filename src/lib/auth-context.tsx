import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { supabase } from "./supabase";
import type { Profile } from "./database.types";

type AuthState = {
  loading: boolean;
  userId: string | null;
  profile: Profile | null;
  signIn: (email: string, password: string) => Promise<{ error: string | null; profile: Profile | null }>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
};

const AuthCtx = createContext<AuthState | null>(null);

const IDLE_MS = 8 * 60 * 60 * 1000; // 8 hours

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadProfile = async (uid: string | null) => {
    if (!uid) {
      setProfile(null);
      return;
    }
    const { data } = await supabase.from("profiles").select("*").eq("id", uid).maybeSingle();
    setProfile((data as Profile | null) ?? null);
  };

  const resetIdle = () => {
    if (idleTimer.current) clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(() => {
      supabase.auth.signOut({ scope: "local" });
    }, IDLE_MS);
  };

  useEffect(() => {
    let mounted = true;
    supabase.auth.getSession().then(async ({ data }) => {
      if (!mounted) return;
      const uid = data.session?.user.id ?? null;
      setUserId(uid);
      await loadProfile(uid);
      setLoading(false);
      if (uid) resetIdle();
    });
    const { data: sub } = supabase.auth.onAuthStateChange(() => {
      setTimeout(async () => {
        const { data } = await supabase.auth.getSession();
        const uid = data.session?.user.id ?? null;
        setUserId(uid);
        await loadProfile(uid);
        setLoading(false);
        if (uid) resetIdle();
        else if (idleTimer.current) clearTimeout(idleTimer.current);
      }, 0);
    });
    const onActivity = () => userId && resetIdle();
    window.addEventListener("mousemove", onActivity);
    window.addEventListener("keydown", onActivity);
    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
      window.removeEventListener("mousemove", onActivity);
      window.removeEventListener("keydown", onActivity);
      if (idleTimer.current) clearTimeout(idleTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const signIn: AuthState["signIn"] = async (email, password) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error || !data.user) return { error: "Invalid credentials", profile: null };
    const { data: prof } = await supabase.from("profiles").select("*").eq("id", data.user.id).maybeSingle();
    if (!prof || (prof as Profile).is_active === false) {
      await supabase.auth.signOut({ scope: "local" });
      return { error: "Invalid credentials", profile: null };
    }
    setUserId(data.user.id);
    setProfile(prof as Profile);
    return { error: null, profile: prof as Profile };
  };

  const signOut = async () => {
    await supabase.auth.signOut({ scope: "local" });
    setUserId(null);
    setProfile(null);
  };

  return (
    <AuthCtx.Provider
      value={{
        loading,
        userId,
        profile,
        signIn,
        signOut,
        refreshProfile: () => loadProfile(userId),
      }}
    >
      {children}
    </AuthCtx.Provider>
  );
}

export function useAuth() {
  const v = useContext(AuthCtx);
  if (!v) throw new Error("useAuth outside AuthProvider");
  return v;
}
