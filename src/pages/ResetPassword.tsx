import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Scale3d, Loader2, ArrowLeft, KeyRound } from "lucide-react";

export default function ResetPassword() {
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [sessionReady, setSessionReady] = useState<boolean | null>(null);

  useEffect(() => {
    // Supabase processa o hash da URL automaticamente; aguardamos a sessão.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY" || (event === "SIGNED_IN" && session)) {
        setSessionReady(true);
      }
    });

    // Verifica se já existe sessão ativa (hash processado antes do mount).
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) {
        setSessionReady(true);
      } else {
        // Dá 2s para o evento PASSWORD_RECOVERY chegar antes de invalidar.
        setTimeout(() => {
          setSessionReady((prev) => (prev === null ? false : prev));
        }, 2000);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (sessionReady === false) {
      toast.error("Link inválido ou expirado. Solicite um novo.");
      navigate("/auth", { replace: true });
    }
  }, [sessionReady, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (password !== confirm) {
      toast.error("As senhas não coincidem");
      return;
    }
    if (password.length < 8 || !/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) {
      toast.error("A senha deve ter pelo menos 8 caracteres, com letras e números");
      return;
    }

    setLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      toast.success("Senha redefinida com sucesso!");
      navigate("/", { replace: true });
    } catch (error: any) {
      toast.error(error.message || "Erro ao redefinir senha");
    } finally {
      setLoading(false);
    }
  };

  if (sessionReady === null) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex items-center gap-3 text-muted-foreground text-sm">
          <span className="h-2 w-2 rounded-full bg-primary animate-pulse" aria-hidden="true" />
          <span>Verificando link...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen grid lg:grid-cols-2 bg-background">
      {/* Brand column */}
      <aside
        className="hidden lg:flex flex-col justify-between p-12 bg-sidebar text-sidebar-foreground relative overflow-hidden"
        aria-hidden="true"
      >
        <div
          className="absolute inset-0 opacity-[0.03] pointer-events-none"
          style={{
            backgroundImage:
              "radial-gradient(circle at 1px 1px, hsl(var(--sidebar-primary)) 1px, transparent 0)",
            backgroundSize: "24px 24px",
          }}
        />
        <div className="relative z-10">
          <div className="flex items-center gap-3">
            <div className="h-11 w-11 rounded-lg bg-sidebar-primary/15 border border-sidebar-primary/30 flex items-center justify-center">
              <Scale3d className="h-5 w-5 text-sidebar-primary" />
            </div>
            <div>
              <p className="font-heading text-xl font-bold leading-none">Tax Trakker</p>
              <p className="text-[11px] text-sidebar-foreground/55 uppercase tracking-widest mt-1.5">
                Freire Pignataro
              </p>
            </div>
          </div>
        </div>

        <div className="relative z-10 space-y-4">
          <h2 className="font-heading text-3xl font-bold leading-tight text-sidebar-foreground max-w-md">
            Gestão tributária com a disciplina de um escritório sério.
          </h2>
          <p className="text-sm text-sidebar-foreground/65 max-w-md leading-relaxed">
            Pipeline comercial, elegibilidade, processos e cadência de prospecção — tudo
            no mesmo lugar, com a rastreabilidade que a prática exige.
          </p>
        </div>

        <div className="relative z-10 text-[11px] text-sidebar-foreground/45">
          © 2026 Dantas, Freire, Pignataro, Maciel e Costa Advogados Associados
        </div>
      </aside>

      {/* Form column */}
      <main className="flex items-center justify-center p-6 lg:p-12">
        <div className="w-full max-w-sm">
          {/* Brand mobile */}
          <div className="flex lg:hidden items-center gap-2.5 mb-8 justify-center">
            <div className="h-9 w-9 rounded-md bg-primary/10 border border-primary/20 flex items-center justify-center">
              <Scale3d className="h-4 w-4 text-primary" aria-hidden="true" />
            </div>
            <div>
              <p className="font-heading text-lg font-bold leading-none">Tax Trakker</p>
              <p className="text-[10px] text-muted-foreground uppercase tracking-widest mt-1">
                Freire Pignataro
              </p>
            </div>
          </div>

          <div className="mb-7">
            <div className="h-11 w-11 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center mb-4">
              <KeyRound className="h-5 w-5 text-primary" />
            </div>
            <h1 className="font-heading text-h1 tracking-tight">Nova senha</h1>
            <p className="text-sm text-muted-foreground mt-1.5">
              Escolha uma nova senha para sua conta.
            </p>
          </div>

          <Card className="p-6 shadow-elevated border-border/80">
            <form onSubmit={handleSubmit} className="space-y-4" noValidate>
              <div className="space-y-2">
                <Label htmlFor="password">Nova senha</Label>
                <Input
                  id="password"
                  type="password"
                  autoComplete="new-password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  aria-required="true"
                />
                <p className="text-xs text-muted-foreground">
                  Mínimo 8 caracteres, com letras e números.
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirm">Confirmar nova senha</Label>
                <Input
                  id="confirm"
                  type="password"
                  autoComplete="new-password"
                  placeholder="••••••••"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  required
                  aria-required="true"
                />
              </div>
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                    Salvando...
                  </>
                ) : "Salvar nova senha"}
              </Button>
            </form>
          </Card>

          <button
            type="button"
            onClick={() => navigate("/auth", { replace: true })}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors mx-auto mt-5"
          >
            <ArrowLeft className="h-3 w-3" />
            Voltar ao login
          </button>
        </div>
      </main>
    </div>
  );
}
