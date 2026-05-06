import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Scale3d, Loader2, ArrowLeft, MailCheck } from "lucide-react";

type Mode = "login" | "forgot" | "sent";

export default function Auth() {
  // Auto-cadastro desativado: contas só são criadas por admin (edge fn `criar-usuario`).
  // Defesa em profundidade — também desativar "Email signups" no painel do Supabase.
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      toast.success("Login realizado com sucesso!");
    } catch (error: any) {
      toast.error(error.message || "Erro ao autenticar");
    } finally {
      setLoading(false);
    }
  };

  const handleForgot = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const redirectTo = `${window.location.origin}/reset-password`;
      const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
      if (error) throw error;
      setMode("sent");
    } catch (error: any) {
      toast.error(error.message || "Erro ao enviar e-mail de recuperação");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen grid lg:grid-cols-2 bg-background">
      {/* Brand column — só desktop, transmite identidade do escritório */}
      <aside
        className="hidden lg:flex flex-col justify-between p-12 bg-sidebar text-sidebar-foreground relative overflow-hidden"
        aria-hidden="true"
      >
        {/* Pattern sutil */}
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
          {/* Brand mobile — aparece quando a aside some */}
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

          {mode === "login" && (
            <>
              <div className="mb-7">
                <h1 className="font-heading text-h1 tracking-tight">Entrar</h1>
                <p className="text-sm text-muted-foreground mt-1.5">
                  Acesse o CRM do escritório com suas credenciais.
                </p>
              </div>

              <Card className="p-6 shadow-elevated border-border/80">
                <form onSubmit={handleLogin} className="space-y-4" noValidate>
                  <div className="space-y-2">
                    <Label htmlFor="email">E-mail</Label>
                    <Input
                      id="email"
                      type="email"
                      autoComplete="email"
                      placeholder="seu@email.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                      aria-required="true"
                    />
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label htmlFor="password">Senha</Label>
                      <button
                        type="button"
                        onClick={() => setMode("forgot")}
                        className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                      >
                        Esqueci minha senha
                      </button>
                    </div>
                    <Input
                      id="password"
                      type="password"
                      autoComplete="current-password"
                      placeholder="••••••••"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      aria-required="true"
                    />
                  </div>
                  <Button type="submit" className="w-full" disabled={loading}>
                    {loading ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                        Aguarde...
                      </>
                    ) : "Entrar"}
                  </Button>
                </form>
              </Card>

              <p className="text-center text-xs text-muted-foreground mt-5">
                Não tem acesso? Solicite a um administrador.
              </p>
            </>
          )}

          {mode === "forgot" && (
            <>
              <div className="mb-7">
                <h1 className="font-heading text-h1 tracking-tight">Recuperar acesso</h1>
                <p className="text-sm text-muted-foreground mt-1.5">
                  Informe seu e-mail cadastrado e enviaremos um link para redefinir sua senha.
                </p>
              </div>

              <Card className="p-6 shadow-elevated border-border/80">
                <form onSubmit={handleForgot} className="space-y-4" noValidate>
                  <div className="space-y-2">
                    <Label htmlFor="forgot-email">E-mail</Label>
                    <Input
                      id="forgot-email"
                      type="email"
                      autoComplete="email"
                      placeholder="seu@email.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                      aria-required="true"
                    />
                  </div>
                  <Button type="submit" className="w-full" disabled={loading}>
                    {loading ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                        Enviando...
                      </>
                    ) : "Enviar link de recuperação"}
                  </Button>
                </form>
              </Card>

              <button
                type="button"
                onClick={() => setMode("login")}
                className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors mx-auto mt-5"
              >
                <ArrowLeft className="h-3 w-3" />
                Voltar ao login
              </button>
            </>
          )}

          {mode === "sent" && (
            <>
              <div className="mb-7">
                <div className="h-11 w-11 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center mb-4">
                  <MailCheck className="h-5 w-5 text-primary" />
                </div>
                <h1 className="font-heading text-h1 tracking-tight">E-mail enviado</h1>
                <p className="text-sm text-muted-foreground mt-1.5">
                  Verifique sua caixa de entrada. O link de redefinição expira em 1 hora.
                </p>
              </div>

              <Card className="p-6 shadow-elevated border-border/80 text-sm text-muted-foreground space-y-2">
                <p>E-mail enviado para <span className="font-medium text-foreground">{email}</span>.</p>
                <p>Não encontrou? Verifique a pasta de spam.</p>
              </Card>

              <button
                type="button"
                onClick={() => { setMode("login"); setEmail(""); }}
                className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors mx-auto mt-5"
              >
                <ArrowLeft className="h-3 w-3" />
                Voltar ao login
              </button>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
