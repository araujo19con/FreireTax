import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { supabase } from "@/integrations/supabase/client";
import type { User, Session } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

type Profile = Database["public"]["Tables"]["profiles"]["Row"];
type AppRole = Database["public"]["Enums"]["app_role"];

interface AuthContextValue {
  user: User | null;
  session: Session | null;
  profile: Profile | null;
  roles: AppRole[];
  loading: boolean;
  signOut: () => Promise<void>;
  hasRole: (role: AppRole) => boolean;
  isAdmin: boolean;
  isGestor: boolean;
  canManageAll: boolean;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * Provider único que gerencia sessão, profile e papéis.
 * Evita que cada `useAuth()` em cada tela crie uma nova assinatura
 * `onAuthStateChange` e duplique as queries para `profiles` / `user_roles`.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [roles, setRoles] = useState<AppRole[]>([]);
  const [loading, setLoading] = useState(true);

  // cancela requests antigos quando a sessão muda rapidamente (login/logout)
  const reqIdRef = useRef(0);
  const mountedRef = useRef(true);

  const loadProfileAndRoles = useCallback(async (userId: string) => {
    const reqId = ++reqIdRef.current;
    try {
      const [{ data: profileData, error: pErr }, { data: rolesData, error: rErr }] =
        await Promise.all([
          supabase.from("profiles").select("*").eq("id", userId).maybeSingle(),
          supabase.from("user_roles").select("role").eq("user_id", userId),
        ]);
      // request obsoleto (outro login aconteceu no meio) — descarta
      if (reqId !== reqIdRef.current || !mountedRef.current) return;

      if (pErr) console.error("[useAuth] erro ao carregar profile:", pErr.message);
      if (rErr) console.error("[useAuth] erro ao carregar roles:", rErr.message);

      setProfile(profileData ?? null);
      setRoles((rolesData ?? []).map((r) => r.role));
    } catch (e) {
      if (reqId !== reqIdRef.current || !mountedRef.current) return;
      console.error("[useAuth] falha ao buscar profile/roles:", e);
      setProfile(null);
      setRoles([]);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;

    supabase.auth.getSession().then(async ({ data: { session: initial } }) => {
      if (!mountedRef.current) return;
      setSession(initial);
      setUser(initial?.user ?? null);
      if (initial?.user) {
        await loadProfileAndRoles(initial.user.id);
      }
      if (mountedRef.current) setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, next) => {
      if (!mountedRef.current) return;
      setSession(next);
      setUser(next?.user ?? null);
      if (next?.user) {
        // Roda em microtask — não bloqueia o callback do supabase nem
        // precisa de setTimeout (que escondia erros do evento loop).
        void loadProfileAndRoles(next.user.id);
      } else {
        setProfile(null);
        setRoles([]);
      }
      setLoading(false);
    });

    return () => {
      mountedRef.current = false;
      subscription.unsubscribe();
    };
  }, [loadProfileAndRoles]);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
  }, []);

  const refreshProfile = useCallback(async () => {
    if (user) await loadProfileAndRoles(user.id);
  }, [user, loadProfileAndRoles]);

  const value = useMemo<AuthContextValue>(() => {
    const rolesSet = new Set(roles);
    const hasRole = (role: AppRole) => rolesSet.has(role);
    const isAdmin = rolesSet.has("admin");
    const isGestor = rolesSet.has("gestor");
    return {
      user,
      session,
      profile,
      roles,
      loading,
      signOut,
      hasRole,
      isAdmin,
      isGestor,
      canManageAll: isAdmin || isGestor,
      refreshProfile,
    };
  }, [user, session, profile, roles, loading, signOut, refreshProfile]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/**
 * Hook de autenticação. Deve ser usado dentro de <AuthProvider>.
 *
 * Fallback: se algum componente legado for renderizado fora do provider
 * (ex.: em testes), lançamos um erro claro em dev e retornamos um stub
 * seguro em produção para evitar tela branca.
 */
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (ctx) return ctx;

  if (import.meta.env.DEV) {
    throw new Error("useAuth() usado fora de <AuthProvider>.");
  }
  return {
    user: null,
    session: null,
    profile: null,
    roles: [],
    loading: false,
    signOut: async () => { /* noop */ },
    hasRole: () => false,
    isAdmin: false,
    isGestor: false,
    canManageAll: false,
    refreshProfile: async () => { /* noop */ },
  };
}
