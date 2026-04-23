import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { BookOpen, ArrowRight, X } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";

const STORAGE_KEY = "tt_tutorial_seen_v1";

/**
 * Banner de boas-vindas que aponta o tutorial pra novos usuários.
 * Dispensa é persistida em dois lugares:
 *   1. localStorage (instantâneo, offline-friendly)
 *   2. profiles.tutorial_seen_at (cross-device — volta a aparecer no próximo
 *      device até que o user dispense lá também, ou até que o primeiro sync
 *      puxe o profile)
 * Some imediato se qualquer um dos dois já estiver setado.
 */
export function TutorialWelcomeBanner() {
  const { user, profile, refreshProfile } = useAuth();
  const [show, setShow] = useState(false);

  useEffect(() => {
    // Profile vindo do banco já tem tutorial_seen_at? Esconde.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if ((profile as any)?.tutorial_seen_at) {
      setShow(false);
      return;
    }
    try {
      const seen = localStorage.getItem(STORAGE_KEY);
      if (!seen) setShow(true);
    } catch {
      // localStorage indisponível (modo privado antigo etc) — não mostra pra não irritar
    }
  }, [profile]);

  const dismiss = async () => {
    try {
      localStorage.setItem(STORAGE_KEY, new Date().toISOString());
    } catch {
      // ignora
    }
    setShow(false);
    // Sync cross-device — best-effort, não bloqueia UX
    if (user) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase.from("profiles") as any)
        .update({ tutorial_seen_at: new Date().toISOString() })
        .eq("id", user.id);
      await refreshProfile();
    }
  };

  if (!show) return null;

  return (
    <Card className="p-4 border-primary/30 bg-primary/5 flex items-start gap-4">
      <div className="h-10 w-10 rounded-full bg-primary/15 border border-primary/30 flex items-center justify-center shrink-0">
        <BookOpen className="h-5 w-5 text-primary" />
      </div>
      <div className="min-w-0 flex-1">
        <h3 className="font-heading font-semibold text-sm mb-1">
          Primeira vez no Tax Trakker?
        </h3>
        <p className="text-xs text-muted-foreground mb-3">
          Veja o tutorial — 10 minutos explicando o fluxo principal, o glossário dos termos e dicas de
          produtividade. Depois a sidebar mantém um atalho permanente.
        </p>
        <div className="flex items-center gap-2">
          <Button asChild size="sm" onClick={dismiss}>
            <Link to="/tutorial">
              Abrir tutorial
              <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
            </Link>
          </Button>
          <Button size="sm" variant="ghost" onClick={dismiss}>
            Já conheço, dispensar
          </Button>
        </div>
      </div>
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7 shrink-0 -mt-1 -mr-1"
        onClick={dismiss}
        aria-label="Fechar banner"
      >
        <X className="h-4 w-4" />
      </Button>
    </Card>
  );
}
