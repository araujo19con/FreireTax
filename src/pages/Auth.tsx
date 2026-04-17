import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Scale3d, Loader2 } from "lucide-react";

export default function Auth() {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      if (isLogin) {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        toast.success("Login realizado com sucesso!");
      } else {
        const { error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        toast.success("Cadastro realizado! Verifique seu e-mail para confirmar.");
      }
    } catch (error: any) {
      toast.error(error.message || "Erro ao autenticar");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="min-h-screen grid lg:grid-cols-2 bg-background"
    >
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

          <div className="mb-7">
            <h1 className="font-heading text-h1 tracking-tight">
              {isLogin ? "Entrar" : "Criar conta"}
            </h1>
            <p className="text-sm text-muted-foreground mt-1.5">
              {isLogin
                ? "Acesse o CRM do escritório com suas credenciais."
                : "Cadastre-se para solicitar acesso ao sistema."}
            </p>
          </div>

          <Card className="p-6 shadow-elevated border-border/80">
            <form onSubmit={handleSubmit} className="space-y-4" noValidate>
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
                <Label htmlFor="password">Senha</Label>
                <Input
                  id="password"
                  type="password"
                  autoComplete={isLogin ? "current-password" : "new-password"}
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={6}
                  aria-required="true"
                  aria-describedby={!isLogin ? "password-hint" : undefined}
                />
                {!isLogin && (
                  <p id="password-hint" className="text-[11px] text-muted-foreground">
                    Mínimo 8 caracteres, com letras e números.
                  </p>
                )}
              </div>
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                    Aguarde...
                  </>
                ) : isLogin ? "Entrar" : "Cadastrar"}
              </Button>
            </form>
          </Card>

          <p className="text-center text-sm text-muted-foreground mt-5">
            {isLogin ? "Não tem conta?" : "Já tem conta?"}{" "}
            <button
              type="button"
              className="text-primary font-medium underline-offset-4 hover:underline focus-visible:underline"
              onClick={() => setIsLogin(!isLogin)}
            >
              {isLogin ? "Cadastre-se" : "Faça login"}
            </button>
          </p>
        </div>
      </main>
    </div>
  );
}
