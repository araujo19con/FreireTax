export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      acoes_tributarias: {
        Row: {
          created_at: string
          id: string
          nome: string
          responsavel_id: string | null
          status: string
          tipo: string
          updated_at: string
          user_id: string
          vinculo: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          nome: string
          responsavel_id?: string | null
          status?: string
          tipo?: string
          updated_at?: string
          user_id: string
          vinculo?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          nome?: string
          responsavel_id?: string | null
          status?: string
          tipo?: string
          updated_at?: string
          user_id?: string
          vinculo?: string | null
        }
        Relationships: []
      }
      audit_logs: {
        Row: {
          acao: string
          created_at: string
          detalhes: Json | null
          id: string
          registro_id: string | null
          tabela: string
          user_id: string
        }
        Insert: {
          acao: string
          created_at?: string
          detalhes?: Json | null
          id?: string
          registro_id?: string | null
          tabela: string
          user_id: string
        }
        Update: {
          acao?: string
          created_at?: string
          detalhes?: Json | null
          id?: string
          registro_id?: string | null
          tabela?: string
          user_id?: string
        }
        Relationships: []
      }
      elegibilidade: {
        Row: {
          acao_id: string
          created_at: string
          elegivel: boolean
          empresa_id: string
          id: string
          justificativa: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          acao_id: string
          created_at?: string
          elegivel?: boolean
          empresa_id: string
          id?: string
          justificativa?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          acao_id?: string
          created_at?: string
          elegivel?: boolean
          empresa_id?: string
          id?: string
          justificativa?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "elegibilidade_acao_id_fkey"
            columns: ["acao_id"]
            isOneToOne: false
            referencedRelation: "acoes_tributarias"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "elegibilidade_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
        ]
      }
      empresas: {
        Row: {
          cnpj: string
          created_at: string
          id: string
          nome: string
          obs: string | null
          responsavel_id: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          cnpj: string
          created_at?: string
          id?: string
          nome: string
          obs?: string | null
          responsavel_id?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          cnpj?: string
          created_at?: string
          id?: string
          nome?: string
          obs?: string | null
          responsavel_id?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      pasta_empresa_items: {
        Row: {
          created_at: string
          empresa_id: string
          id: string
          pasta_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          empresa_id: string
          id?: string
          pasta_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          empresa_id?: string
          id?: string
          pasta_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pasta_empresa_items_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pasta_empresa_items_pasta_id_fkey"
            columns: ["pasta_id"]
            isOneToOne: false
            referencedRelation: "pastas_empresas"
            referencedColumns: ["id"]
          },
        ]
      }
      pastas_empresas: {
        Row: {
          created_at: string
          id: string
          nome: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          nome: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          nome?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      processos: {
        Row: {
          created_at: string
          data_processo: string | null
          elegibilidade_id: string
          fase: string
          id: string
          numero_processo: string | null
          observacoes: string | null
          status: string
          tribunal: string | null
          updated_at: string
          user_id: string
          valor_estimado: number | null
          valor_ganho: number | null
        }
        Insert: {
          created_at?: string
          data_processo?: string | null
          elegibilidade_id: string
          fase?: string
          id?: string
          numero_processo?: string | null
          observacoes?: string | null
          status?: string
          tribunal?: string | null
          updated_at?: string
          user_id: string
          valor_estimado?: number | null
          valor_ganho?: number | null
        }
        Update: {
          created_at?: string
          data_processo?: string | null
          elegibilidade_id?: string
          fase?: string
          id?: string
          numero_processo?: string | null
          observacoes?: string | null
          status?: string
          tribunal?: string | null
          updated_at?: string
          user_id?: string
          valor_estimado?: number | null
          valor_ganho?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "processos_elegibilidade_id_fkey"
            columns: ["elegibilidade_id"]
            isOneToOne: false
            referencedRelation: "elegibilidade"
            referencedColumns: ["id"]
          },
        ]
      }
      prospeccoes: {
        Row: {
          contato_cargo: string | null
          contato_email: string | null
          contato_nome: string | null
          contato_telefone: string | null
          created_at: string
          data_assinatura: string | null
          data_contrato: string | null
          elegibilidade_id: string
          id: string
          notas_prospeccao: string | null
          observacoes_contrato: string | null
          responsavel_id: string | null
          status_prospeccao: string
          tipo_contrato: string | null
          updated_at: string
          user_id: string
          valor_contrato: number | null
        }
        Insert: {
          contato_cargo?: string | null
          contato_email?: string | null
          contato_nome?: string | null
          contato_telefone?: string | null
          created_at?: string
          data_assinatura?: string | null
          data_contrato?: string | null
          elegibilidade_id: string
          id?: string
          notas_prospeccao?: string | null
          observacoes_contrato?: string | null
          responsavel_id?: string | null
          status_prospeccao?: string
          tipo_contrato?: string | null
          updated_at?: string
          user_id: string
          valor_contrato?: number | null
        }
        Update: {
          contato_cargo?: string | null
          contato_email?: string | null
          contato_nome?: string | null
          contato_telefone?: string | null
          created_at?: string
          data_assinatura?: string | null
          data_contrato?: string | null
          elegibilidade_id?: string
          id?: string
          notas_prospeccao?: string | null
          observacoes_contrato?: string | null
          responsavel_id?: string | null
          status_prospeccao?: string
          tipo_contrato?: string | null
          updated_at?: string
          user_id?: string
          valor_contrato?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "prospeccoes_elegibilidade_id_fkey"
            columns: ["elegibilidade_id"]
            isOneToOne: false
            referencedRelation: "elegibilidade"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          ativo: boolean
          avatar_url: string | null
          cargo: string | null
          created_at: string
          email: string
          id: string
          nome: string
          telefone: string | null
          updated_at: string
        }
        Insert: {
          ativo?: boolean
          avatar_url?: string | null
          cargo?: string | null
          created_at?: string
          email: string
          id: string
          nome?: string
          telefone?: string | null
          updated_at?: string
        }
        Update: {
          ativo?: boolean
          avatar_url?: string | null
          cargo?: string | null
          created_at?: string
          email?: string
          id?: string
          nome?: string
          telefone?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      tarefas: {
        Row: {
          acao_id: string | null
          assigned_to: string | null
          concluida_em: string | null
          created_at: string
          created_by: string
          descricao: string | null
          empresa_id: string | null
          id: string
          prazo: string | null
          prioridade: Database["public"]["Enums"]["tarefa_prioridade"]
          prospeccao_id: string | null
          status: Database["public"]["Enums"]["tarefa_status"]
          titulo: string
          updated_at: string
        }
        Insert: {
          acao_id?: string | null
          assigned_to?: string | null
          concluida_em?: string | null
          created_at?: string
          created_by: string
          descricao?: string | null
          empresa_id?: string | null
          id?: string
          prazo?: string | null
          prioridade?: Database["public"]["Enums"]["tarefa_prioridade"]
          prospeccao_id?: string | null
          status?: Database["public"]["Enums"]["tarefa_status"]
          titulo: string
          updated_at?: string
        }
        Update: {
          acao_id?: string | null
          assigned_to?: string | null
          concluida_em?: string | null
          created_at?: string
          created_by?: string
          descricao?: string | null
          empresa_id?: string | null
          id?: string
          prazo?: string | null
          prioridade?: Database["public"]["Enums"]["tarefa_prioridade"]
          prospeccao_id?: string | null
          status?: Database["public"]["Enums"]["tarefa_status"]
          titulo?: string
          updated_at?: string
        }
        Relationships: []
      }
      subtarefas: {
        Row: {
          concluida: boolean
          created_at: string
          id: string
          ordem: number
          tarefa_id: string
          titulo: string
        }
        Insert: {
          concluida?: boolean
          created_at?: string
          id?: string
          ordem?: number
          tarefa_id: string
          titulo: string
        }
        Update: {
          concluida?: boolean
          created_at?: string
          id?: string
          ordem?: number
          tarefa_id?: string
          titulo?: string
        }
        Relationships: []
      }
      tarefa_comentarios: {
        Row: {
          created_at: string
          id: string
          tarefa_id: string
          texto: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          tarefa_id: string
          texto: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          tarefa_id?: string
          texto?: string
          user_id?: string
        }
        Relationships: []
      }
      tarefa_anexos: {
        Row: {
          created_at: string
          id: string
          mime_type: string | null
          nome: string
          storage_path: string
          tamanho_bytes: number | null
          tarefa_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          mime_type?: string | null
          nome: string
          storage_path: string
          tamanho_bytes?: number | null
          tarefa_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          mime_type?: string | null
          nome?: string
          storage_path?: string
          tamanho_bytes?: number | null
          tarefa_id?: string
          user_id?: string
        }
        Relationships: []
      }
      reunioes: {
        Row: {
          advogado_id: string
          created_at: string
          created_by: string
          data_fim: string
          data_inicio: string
          descricao: string | null
          empresa_id: string | null
          ics_enviado_em: string | null
          ics_uid: string | null
          id: string
          lead_email: string
          lead_nome: string
          link_reuniao: string | null
          local: string | null
          notas: string | null
          prospeccao_id: string | null
          status: Database["public"]["Enums"]["reuniao_status"]
          titulo: string
          updated_at: string
        }
        Insert: {
          advogado_id: string
          created_at?: string
          created_by: string
          data_fim: string
          data_inicio: string
          descricao?: string | null
          empresa_id?: string | null
          ics_enviado_em?: string | null
          ics_uid?: string | null
          id?: string
          lead_email: string
          lead_nome: string
          link_reuniao?: string | null
          local?: string | null
          notas?: string | null
          prospeccao_id?: string | null
          status?: Database["public"]["Enums"]["reuniao_status"]
          titulo: string
          updated_at?: string
        }
        Update: {
          advogado_id?: string
          created_at?: string
          created_by?: string
          data_fim?: string
          data_inicio?: string
          descricao?: string | null
          empresa_id?: string | null
          ics_enviado_em?: string | null
          ics_uid?: string | null
          id?: string
          lead_email?: string
          lead_nome?: string
          link_reuniao?: string | null
          local?: string | null
          notas?: string | null
          prospeccao_id?: string | null
          status?: Database["public"]["Enums"]["reuniao_status"]
          titulo?: string
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_role: {
        Args: { _user_id: string; _role: Database["public"]["Enums"]["app_role"] }
        Returns: boolean
      }
      is_admin: {
        Args: { _user_id: string }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "admin" | "advogado" | "comercial" | "gestor"
      tarefa_prioridade: "baixa" | "media" | "alta" | "urgente"
      tarefa_status: "pendente" | "em_andamento" | "concluida" | "cancelada"
      reuniao_status: "agendada" | "realizada" | "cancelada" | "no_show" | "reagendada"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "advogado", "comercial", "gestor"],
      tarefa_prioridade: ["baixa", "media", "alta", "urgente"],
      tarefa_status: ["pendente", "em_andamento", "concluida", "cancelada"],
      reuniao_status: ["agendada", "realizada", "cancelada", "no_show", "reagendada"],
    },
  },
} as const
