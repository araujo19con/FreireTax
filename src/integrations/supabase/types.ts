export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5";
  };
  public: {
    Tables: {
      acoes_tributarias: {
        Row: {
          created_at: string;
          data_limite_prescricao: string | null;
          id: string;
          nome: string;
          observacao_prazo: string | null;
          responsavel_id: string | null;
          status: string;
          tipo: string;
          tipo_prazo: Database["public"]["Enums"]["tipo_prazo"] | null;
          updated_at: string;
          user_id: string;
          vinculo: string | null;
        };
        Insert: {
          created_at?: string;
          data_limite_prescricao?: string | null;
          id?: string;
          nome: string;
          observacao_prazo?: string | null;
          responsavel_id?: string | null;
          status?: string;
          tipo?: string;
          tipo_prazo?: Database["public"]["Enums"]["tipo_prazo"] | null;
          updated_at?: string;
          user_id: string;
          vinculo?: string | null;
        };
        Update: {
          created_at?: string;
          data_limite_prescricao?: string | null;
          id?: string;
          nome?: string;
          observacao_prazo?: string | null;
          responsavel_id?: string | null;
          status?: string;
          tipo?: string;
          tipo_prazo?: Database["public"]["Enums"]["tipo_prazo"] | null;
          updated_at?: string;
          user_id?: string;
          vinculo?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "acoes_tributarias_responsavel_id_fkey";
            columns: ["responsavel_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      audit_logs: {
        Row: {
          acao: string;
          created_at: string;
          detalhes: Json | null;
          id: string;
          registro_id: string | null;
          tabela: string;
          user_id: string;
        };
        Insert: {
          acao: string;
          created_at?: string;
          detalhes?: Json | null;
          id?: string;
          registro_id?: string | null;
          tabela: string;
          user_id: string;
        };
        Update: {
          acao?: string;
          created_at?: string;
          detalhes?: Json | null;
          id?: string;
          registro_id?: string | null;
          tabela?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      cnpj_cache: {
        Row: {
          cnpj: string;
          consultado_em: string;
          erro: string | null;
          fonte: string;
          payload: Json;
          sucesso: boolean;
        };
        Insert: {
          cnpj: string;
          consultado_em?: string;
          erro?: string | null;
          fonte?: string;
          payload: Json;
          sucesso?: boolean;
        };
        Update: {
          cnpj?: string;
          consultado_em?: string;
          erro?: string | null;
          fonte?: string;
          payload?: Json;
          sucesso?: boolean;
        };
        Relationships: [];
      };
      criterios_elegibilidade: {
        Row: {
          acao_id: string;
          created_at: string;
          descricao: string | null;
          eh_excludente: boolean;
          formula_valor: string | null;
          id: string;
          opcoes: Json | null;
          ordem: number;
          pergunta: string;
          peso: number;
          regra_excludente: Json | null;
          tipo_resposta: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          acao_id: string;
          created_at?: string;
          descricao?: string | null;
          eh_excludente?: boolean;
          formula_valor?: string | null;
          id?: string;
          opcoes?: Json | null;
          ordem?: number;
          pergunta: string;
          peso?: number;
          regra_excludente?: Json | null;
          tipo_resposta: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          acao_id?: string;
          created_at?: string;
          descricao?: string | null;
          eh_excludente?: boolean;
          formula_valor?: string | null;
          id?: string;
          opcoes?: Json | null;
          ordem?: number;
          pergunta?: string;
          peso?: number;
          regra_excludente?: Json | null;
          tipo_resposta?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "criterios_elegibilidade_acao_id_fkey";
            columns: ["acao_id"];
            isOneToOne: false;
            referencedRelation: "acoes_tributarias";
            referencedColumns: ["id"];
          },
        ];
      };
      elegibilidade: {
        Row: {
          acao_id: string;
          created_at: string;
          destaque: boolean;
          elegivel: boolean;
          empresa_id: string;
          id: string;
          justificativa: string | null;
          motivo_desqualificacao: string | null;
          notas_contexto: string | null;
          observacao_valor: string | null;
          qualificada_em: string | null;
          qualificada_por: string | null;
          score_elegibilidade: number | null;
          status_qualificacao: string | null;
          updated_at: string;
          user_id: string;
          valor_calculado: number | null;
          valor_potencial_estimado: number | null;
        };
        Insert: {
          acao_id: string;
          created_at?: string;
          destaque?: boolean;
          elegivel?: boolean;
          empresa_id: string;
          id?: string;
          justificativa?: string | null;
          motivo_desqualificacao?: string | null;
          notas_contexto?: string | null;
          observacao_valor?: string | null;
          qualificada_em?: string | null;
          qualificada_por?: string | null;
          score_elegibilidade?: number | null;
          status_qualificacao?: string | null;
          updated_at?: string;
          user_id: string;
          valor_calculado?: number | null;
          valor_potencial_estimado?: number | null;
        };
        Update: {
          acao_id?: string;
          created_at?: string;
          destaque?: boolean;
          elegivel?: boolean;
          empresa_id?: string;
          id?: string;
          justificativa?: string | null;
          motivo_desqualificacao?: string | null;
          notas_contexto?: string | null;
          observacao_valor?: string | null;
          qualificada_em?: string | null;
          qualificada_por?: string | null;
          score_elegibilidade?: number | null;
          status_qualificacao?: string | null;
          updated_at?: string;
          user_id?: string;
          valor_calculado?: number | null;
          valor_potencial_estimado?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "elegibilidade_acao_id_fkey";
            columns: ["acao_id"];
            isOneToOne: false;
            referencedRelation: "acoes_tributarias";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "elegibilidade_empresa_id_fkey";
            columns: ["empresa_id"];
            isOneToOne: false;
            referencedRelation: "empresas";
            referencedColumns: ["id"];
          },
        ];
      };
      elegibilidade_respostas: {
        Row: {
          answered_at: string;
          criterio_id: string;
          elegibilidade_id: string;
          id: string;
          resposta_bool: boolean | null;
          resposta_date: string | null;
          resposta_number: number | null;
          resposta_select: string | null;
          resposta_text: string | null;
          user_id: string;
        };
        Insert: {
          answered_at?: string;
          criterio_id: string;
          elegibilidade_id: string;
          id?: string;
          resposta_bool?: boolean | null;
          resposta_date?: string | null;
          resposta_number?: number | null;
          resposta_select?: string | null;
          resposta_text?: string | null;
          user_id: string;
        };
        Update: {
          answered_at?: string;
          criterio_id?: string;
          elegibilidade_id?: string;
          id?: string;
          resposta_bool?: boolean | null;
          resposta_date?: string | null;
          resposta_number?: number | null;
          resposta_select?: string | null;
          resposta_text?: string | null;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "elegibilidade_respostas_criterio_id_fkey";
            columns: ["criterio_id"];
            isOneToOne: false;
            referencedRelation: "criterios_elegibilidade";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "elegibilidade_respostas_elegibilidade_id_fkey";
            columns: ["elegibilidade_id"];
            isOneToOne: false;
            referencedRelation: "elegibilidade";
            referencedColumns: ["id"];
          },
        ];
      };
      empresa_contatos: {
        Row: {
          cargo: string | null;
          cpf_mascarado: string | null;
          created_at: string;
          created_by: string | null;
          dedup_key: string | null;
          email: string | null;
          empresa_id: string;
          faixa_etaria: string | null;
          id: string;
          is_contador: boolean;
          linkedin: string | null;
          metadados: Json;
          nome: string | null;
          observacoes: string | null;
          origem: Database["public"]["Enums"]["origem_contato"];
          papel: Database["public"]["Enums"]["papel_contato"];
          principal: boolean;
          telefone: string | null;
          tipo_telefone: Database["public"]["Enums"]["tipo_telefone"];
          updated_at: string;
          whatsapp: boolean;
        };
        Insert: {
          cargo?: string | null;
          cpf_mascarado?: string | null;
          created_at?: string;
          created_by?: string | null;
          dedup_key?: string | null;
          email?: string | null;
          empresa_id: string;
          faixa_etaria?: string | null;
          id?: string;
          is_contador?: boolean;
          linkedin?: string | null;
          metadados?: Json;
          nome?: string | null;
          observacoes?: string | null;
          origem?: Database["public"]["Enums"]["origem_contato"];
          papel?: Database["public"]["Enums"]["papel_contato"];
          principal?: boolean;
          telefone?: string | null;
          tipo_telefone?: Database["public"]["Enums"]["tipo_telefone"];
          updated_at?: string;
          whatsapp?: boolean;
        };
        Update: {
          cargo?: string | null;
          cpf_mascarado?: string | null;
          created_at?: string;
          created_by?: string | null;
          dedup_key?: string | null;
          email?: string | null;
          empresa_id?: string;
          faixa_etaria?: string | null;
          id?: string;
          is_contador?: boolean;
          linkedin?: string | null;
          metadados?: Json;
          nome?: string | null;
          observacoes?: string | null;
          origem?: Database["public"]["Enums"]["origem_contato"];
          papel?: Database["public"]["Enums"]["papel_contato"];
          principal?: boolean;
          telefone?: string | null;
          tipo_telefone?: Database["public"]["Enums"]["tipo_telefone"];
          updated_at?: string;
          whatsapp?: boolean;
        };
        Relationships: [
          {
            foreignKeyName: "empresa_contatos_empresa_id_fkey";
            columns: ["empresa_id"];
            isOneToOne: false;
            referencedRelation: "empresas";
            referencedColumns: ["id"];
          },
        ];
      };
      empresas: {
        Row: {
          bairro: string | null;
          capital_social: number | null;
          cep: string | null;
          cnae_principal: string | null;
          cnae_principal_desc: string | null;
          cnaes_secundarios: Json | null;
          cnpj: string | null;
          complemento: string | null;
          created_at: string;
          data_abertura: string | null;
          data_opcao_simples: string | null;
          email_manual: boolean;
          email_receita: string | null;
          faturamento_anual: number | null;
          faturamento_estimado: number | null;
          id: string;
          logradouro: string | null;
          metadados: Json;
          motivo_situacao: string | null;
          municipio: string | null;
          natureza_juridica: string | null;
          nome: string;
          nome_fantasia: string | null;
          numero_endereco: string | null;
          obs: string | null;
          opcao_mei: boolean | null;
          opcao_simples: boolean | null;
          porte: Database["public"]["Enums"]["porte_rfb"] | null;
          qsa: Json | null;
          quantidade_funcionarios: number | null;
          razao_social: string | null;
          receita_atualizada_em: string | null;
          receita_erro: string | null;
          regime_tributario: string | null;
          responsavel_id: string | null;
          situacao_cadastral: Database["public"]["Enums"]["situacao_cadastral_rfb"] | null;
          situacao_cadastral_data: string | null;
          status: string;
          telefone_manual: boolean;
          telefone_receita: string | null;
          uf: string | null;
          updated_at: string;
          user_id: string;
          contatos_count: number;
          contato_principal_cargo: string | null;
          contato_principal_email: string | null;
          contato_principal_nome: string | null;
          contato_principal_origem: Database["public"]["Enums"]["origem_contato"] | null;
          contato_principal_telefone: string | null;
          contato_principal_whatsapp: boolean;
          valor_potencial_total: number | null;
        };
        Insert: {
          bairro?: string | null;
          capital_social?: number | null;
          cep?: string | null;
          cnae_principal?: string | null;
          cnae_principal_desc?: string | null;
          cnaes_secundarios?: Json | null;
          cnpj?: string | null;
          complemento?: string | null;
          created_at?: string;
          data_abertura?: string | null;
          data_opcao_simples?: string | null;
          email_manual?: boolean;
          email_receita?: string | null;
          faturamento_anual?: number | null;
          faturamento_estimado?: number | null;
          id?: string;
          logradouro?: string | null;
          metadados?: Json;
          motivo_situacao?: string | null;
          municipio?: string | null;
          natureza_juridica?: string | null;
          nome: string;
          nome_fantasia?: string | null;
          numero_endereco?: string | null;
          obs?: string | null;
          opcao_mei?: boolean | null;
          opcao_simples?: boolean | null;
          porte?: Database["public"]["Enums"]["porte_rfb"] | null;
          qsa?: Json | null;
          quantidade_funcionarios?: number | null;
          razao_social?: string | null;
          receita_atualizada_em?: string | null;
          receita_erro?: string | null;
          regime_tributario?: string | null;
          responsavel_id?: string | null;
          situacao_cadastral?: Database["public"]["Enums"]["situacao_cadastral_rfb"] | null;
          situacao_cadastral_data?: string | null;
          status?: string;
          telefone_manual?: boolean;
          telefone_receita?: string | null;
          uf?: string | null;
          updated_at?: string;
          user_id: string;
          contatos_count?: number;
          contato_principal_cargo?: string | null;
          contato_principal_email?: string | null;
          contato_principal_nome?: string | null;
          contato_principal_origem?: Database["public"]["Enums"]["origem_contato"] | null;
          contato_principal_telefone?: string | null;
          contato_principal_whatsapp?: boolean;
          valor_potencial_total?: number | null;
        };
        Update: {
          bairro?: string | null;
          capital_social?: number | null;
          cep?: string | null;
          cnae_principal?: string | null;
          cnae_principal_desc?: string | null;
          cnaes_secundarios?: Json | null;
          cnpj?: string | null;
          complemento?: string | null;
          created_at?: string;
          data_abertura?: string | null;
          data_opcao_simples?: string | null;
          email_manual?: boolean;
          email_receita?: string | null;
          faturamento_anual?: number | null;
          faturamento_estimado?: number | null;
          id?: string;
          logradouro?: string | null;
          metadados?: Json;
          motivo_situacao?: string | null;
          municipio?: string | null;
          natureza_juridica?: string | null;
          nome?: string;
          nome_fantasia?: string | null;
          numero_endereco?: string | null;
          obs?: string | null;
          opcao_mei?: boolean | null;
          opcao_simples?: boolean | null;
          porte?: Database["public"]["Enums"]["porte_rfb"] | null;
          qsa?: Json | null;
          quantidade_funcionarios?: number | null;
          razao_social?: string | null;
          receita_atualizada_em?: string | null;
          receita_erro?: string | null;
          regime_tributario?: string | null;
          responsavel_id?: string | null;
          situacao_cadastral?: Database["public"]["Enums"]["situacao_cadastral_rfb"] | null;
          situacao_cadastral_data?: string | null;
          status?: string;
          telefone_manual?: boolean;
          telefone_receita?: string | null;
          uf?: string | null;
          updated_at?: string;
          user_id?: string;
          contatos_count?: number;
          contato_principal_cargo?: string | null;
          contato_principal_email?: string | null;
          contato_principal_nome?: string | null;
          contato_principal_origem?: Database["public"]["Enums"]["origem_contato"] | null;
          contato_principal_telefone?: string | null;
          contato_principal_whatsapp?: boolean;
          valor_potencial_total?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "empresas_responsavel_id_fkey";
            columns: ["responsavel_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      pasta_empresa_items: {
        Row: {
          created_at: string;
          empresa_id: string;
          id: string;
          pasta_id: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          empresa_id: string;
          id?: string;
          pasta_id: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          empresa_id?: string;
          id?: string;
          pasta_id?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "pasta_empresa_items_empresa_id_fkey";
            columns: ["empresa_id"];
            isOneToOne: false;
            referencedRelation: "empresas";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "pasta_empresa_items_pasta_id_fkey";
            columns: ["pasta_id"];
            isOneToOne: false;
            referencedRelation: "pastas_empresas";
            referencedColumns: ["id"];
          },
        ];
      };
      pastas_empresas: {
        Row: {
          created_at: string;
          id: string;
          nome: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          nome: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          nome?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      processos: {
        Row: {
          acao_id: string;
          created_at: string;
          data_processo: string | null;
          elegibilidade_id: string;
          empresa_id: string;
          fase: string;
          id: string;
          numero_processo: string | null;
          observacoes: string | null;
          status: string;
          tribunal: string | null;
          updated_at: string;
          user_id: string;
          valor_estimado: number | null;
          valor_ganho: number | null;
        };
        Insert: {
          acao_id: string;
          created_at?: string;
          data_processo?: string | null;
          elegibilidade_id: string;
          empresa_id: string;
          fase?: string;
          id?: string;
          numero_processo?: string | null;
          observacoes?: string | null;
          status?: string;
          tribunal?: string | null;
          updated_at?: string;
          user_id: string;
          valor_estimado?: number | null;
          valor_ganho?: number | null;
        };
        Update: {
          acao_id?: string;
          created_at?: string;
          data_processo?: string | null;
          elegibilidade_id?: string;
          empresa_id?: string;
          fase?: string;
          id?: string;
          numero_processo?: string | null;
          observacoes?: string | null;
          status?: string;
          tribunal?: string | null;
          updated_at?: string;
          user_id?: string;
          valor_estimado?: number | null;
          valor_ganho?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "processos_acao_id_fkey";
            columns: ["acao_id"];
            isOneToOne: false;
            referencedRelation: "acoes_tributarias";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "processos_elegibilidade_id_fkey";
            columns: ["elegibilidade_id"];
            isOneToOne: false;
            referencedRelation: "elegibilidade";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "processos_empresa_id_fkey";
            columns: ["empresa_id"];
            isOneToOne: false;
            referencedRelation: "empresas";
            referencedColumns: ["id"];
          },
        ];
      };
      profiles: {
        Row: {
          ativo: boolean;
          avatar_url: string | null;
          cargo: string | null;
          created_at: string;
          email: string;
          id: string;
          nome: string;
          telefone: string | null;
          tutorial_seen_at: string | null;
          updated_at: string;
        };
        Insert: {
          ativo?: boolean;
          avatar_url?: string | null;
          cargo?: string | null;
          created_at?: string;
          email: string;
          id: string;
          nome?: string;
          telefone?: string | null;
          tutorial_seen_at?: string | null;
          updated_at?: string;
        };
        Update: {
          ativo?: boolean;
          avatar_url?: string | null;
          cargo?: string | null;
          created_at?: string;
          email?: string;
          id?: string;
          nome?: string;
          telefone?: string | null;
          tutorial_seen_at?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      propostas: {
        Row: {
          acao_id: string | null;
          aceita_em: string | null;
          created_at: string;
          created_by: string;
          destinatario_att: string | null;
          destinatario_empresa: string | null;
          empresa_id: string | null;
          enviada_em: string | null;
          id: string;
          motivo_rejeicao: string | null;
          percentual_exito: number | null;
          prospeccao_id: string;
          rejeitada_em: string | null;
          secoes: Json;
          signatario_cargo: string | null;
          signatario_nome: string | null;
          status: string;
          template_id: string | null;
          texto_introducao: string | null;
          titulo: string;
          updated_at: string;
          valor_entrada: number | null;
        };
        Insert: {
          acao_id?: string | null;
          aceita_em?: string | null;
          created_at?: string;
          created_by?: string;
          destinatario_att?: string | null;
          destinatario_empresa?: string | null;
          empresa_id?: string | null;
          enviada_em?: string | null;
          id?: string;
          motivo_rejeicao?: string | null;
          percentual_exito?: number | null;
          prospeccao_id: string;
          rejeitada_em?: string | null;
          secoes?: Json;
          signatario_cargo?: string | null;
          signatario_nome?: string | null;
          status?: string;
          template_id?: string | null;
          texto_introducao?: string | null;
          titulo: string;
          updated_at?: string;
          valor_entrada?: number | null;
        };
        Update: {
          acao_id?: string | null;
          aceita_em?: string | null;
          created_at?: string;
          created_by?: string;
          destinatario_att?: string | null;
          destinatario_empresa?: string | null;
          empresa_id?: string | null;
          enviada_em?: string | null;
          id?: string;
          motivo_rejeicao?: string | null;
          percentual_exito?: number | null;
          prospeccao_id?: string;
          rejeitada_em?: string | null;
          secoes?: Json;
          signatario_cargo?: string | null;
          signatario_nome?: string | null;
          status?: string;
          template_id?: string | null;
          texto_introducao?: string | null;
          titulo?: string;
          updated_at?: string;
          valor_entrada?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "propostas_acao_id_fkey";
            columns: ["acao_id"];
            isOneToOne: false;
            referencedRelation: "acoes_tributarias";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "propostas_empresa_id_fkey";
            columns: ["empresa_id"];
            isOneToOne: false;
            referencedRelation: "empresas";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "propostas_prospeccao_id_fkey";
            columns: ["prospeccao_id"];
            isOneToOne: true;
            referencedRelation: "prospeccoes";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "propostas_template_id_fkey";
            columns: ["template_id"];
            isOneToOne: false;
            referencedRelation: "propostas_templates";
            referencedColumns: ["id"];
          },
        ];
      };
      propostas_templates: {
        Row: {
          acao_id: string | null;
          ativo: boolean;
          created_at: string;
          descricao: string | null;
          docx_template_path: string | null;
          id: string;
          nome: string;
          percentual_exito_default: number | null;
          secoes: Json;
          texto_destinatario_default: string | null;
          tipo_servico: string | null;
          updated_at: string;
          user_id: string;
          valor_entrada_default: number | null;
        };
        Insert: {
          acao_id?: string | null;
          ativo?: boolean;
          created_at?: string;
          descricao?: string | null;
          docx_template_path?: string | null;
          id?: string;
          nome: string;
          percentual_exito_default?: number | null;
          secoes?: Json;
          texto_destinatario_default?: string | null;
          tipo_servico?: string | null;
          updated_at?: string;
          user_id: string;
          valor_entrada_default?: number | null;
        };
        Update: {
          acao_id?: string | null;
          ativo?: boolean;
          created_at?: string;
          descricao?: string | null;
          docx_template_path?: string | null;
          id?: string;
          nome?: string;
          percentual_exito_default?: number | null;
          secoes?: Json;
          texto_destinatario_default?: string | null;
          tipo_servico?: string | null;
          updated_at?: string;
          user_id?: string;
          valor_entrada_default?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "propostas_templates_acao_id_fkey";
            columns: ["acao_id"];
            isOneToOne: false;
            referencedRelation: "acoes_tributarias";
            referencedColumns: ["id"];
          },
        ];
      };
      prospeccao_contatos: {
        Row: {
          canal: Database["public"]["Enums"]["canal_contato"];
          created_at: string;
          data_contato: string;
          id: string;
          notas: string | null;
          prospeccao_id: string;
          proximo_contato_em: string | null;
          resultado: string | null;
          tipo: Database["public"]["Enums"]["tipo_contato"];
          user_id: string | null;
        };
        Insert: {
          canal: Database["public"]["Enums"]["canal_contato"];
          created_at?: string;
          data_contato?: string;
          id?: string;
          notas?: string | null;
          prospeccao_id: string;
          proximo_contato_em?: string | null;
          resultado?: string | null;
          tipo?: Database["public"]["Enums"]["tipo_contato"];
          user_id?: string | null;
        };
        Update: {
          canal?: Database["public"]["Enums"]["canal_contato"];
          created_at?: string;
          data_contato?: string;
          id?: string;
          notas?: string | null;
          prospeccao_id?: string;
          proximo_contato_em?: string | null;
          resultado?: string | null;
          tipo?: Database["public"]["Enums"]["tipo_contato"];
          user_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "prospeccao_contatos_prospeccao_id_fkey";
            columns: ["prospeccao_id"];
            isOneToOne: false;
            referencedRelation: "prospeccoes";
            referencedColumns: ["id"];
          },
        ];
      };
      prospeccoes: {
        Row: {
          acao_id: string;
          cargo_categoria: Database["public"]["Enums"]["cargo_categoria"] | null;
          contato_cargo: string | null;
          contato_email: string | null;
          contato_nome: string | null;
          contato_telefone: string | null;
          created_at: string;
          data_assinatura: string | null;
          data_contrato: string | null;
          decisor_confirmado: boolean;
          dor_identificada: string | null;
          eh_decisor: boolean;
          elegibilidade_id: string;
          empresa_id: string;
          id: string;
          motivo_perdido: Database["public"]["Enums"]["motivo_perdido"] | null;
          motivo_perdido_detalhes: string | null;
          notas_prospeccao: string | null;
          numero_contatos: number;
          objecoes_principais: string[];
          observacoes_contrato: string | null;
          proximo_contato_em: string | null;
          responsavel_id: string | null;
          status_prospeccao: string;
          tentativas_anteriores: string | null;
          tipo_contrato: string | null;
          ultimo_contato_em: string | null;
          updated_at: string;
          user_id: string;
          valor_contrato: number | null;
          valor_emocional_articulado: string | null;
        };
        Insert: {
          acao_id: string;
          cargo_categoria?: Database["public"]["Enums"]["cargo_categoria"] | null;
          contato_cargo?: string | null;
          contato_email?: string | null;
          contato_nome?: string | null;
          contato_telefone?: string | null;
          created_at?: string;
          data_assinatura?: string | null;
          data_contrato?: string | null;
          decisor_confirmado?: boolean;
          dor_identificada?: string | null;
          eh_decisor?: boolean;
          elegibilidade_id: string;
          empresa_id: string;
          id?: string;
          motivo_perdido?: Database["public"]["Enums"]["motivo_perdido"] | null;
          motivo_perdido_detalhes?: string | null;
          notas_prospeccao?: string | null;
          numero_contatos?: number;
          objecoes_principais?: string[];
          observacoes_contrato?: string | null;
          proximo_contato_em?: string | null;
          responsavel_id?: string | null;
          status_prospeccao?: string;
          tentativas_anteriores?: string | null;
          tipo_contrato?: string | null;
          ultimo_contato_em?: string | null;
          updated_at?: string;
          user_id: string;
          valor_contrato?: number | null;
          valor_emocional_articulado?: string | null;
        };
        Update: {
          acao_id?: string;
          cargo_categoria?: Database["public"]["Enums"]["cargo_categoria"] | null;
          contato_cargo?: string | null;
          contato_email?: string | null;
          contato_nome?: string | null;
          contato_telefone?: string | null;
          created_at?: string;
          data_assinatura?: string | null;
          data_contrato?: string | null;
          decisor_confirmado?: boolean;
          dor_identificada?: string | null;
          eh_decisor?: boolean;
          elegibilidade_id?: string;
          empresa_id?: string;
          id?: string;
          motivo_perdido?: Database["public"]["Enums"]["motivo_perdido"] | null;
          motivo_perdido_detalhes?: string | null;
          notas_prospeccao?: string | null;
          numero_contatos?: number;
          objecoes_principais?: string[];
          observacoes_contrato?: string | null;
          proximo_contato_em?: string | null;
          responsavel_id?: string | null;
          status_prospeccao?: string;
          tentativas_anteriores?: string | null;
          tipo_contrato?: string | null;
          ultimo_contato_em?: string | null;
          updated_at?: string;
          user_id?: string;
          valor_contrato?: number | null;
          valor_emocional_articulado?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "prospeccoes_acao_id_fkey";
            columns: ["acao_id"];
            isOneToOne: false;
            referencedRelation: "acoes_tributarias";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "prospeccoes_elegibilidade_id_fkey";
            columns: ["elegibilidade_id"];
            isOneToOne: false;
            referencedRelation: "elegibilidade";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "prospeccoes_empresa_id_fkey";
            columns: ["empresa_id"];
            isOneToOne: false;
            referencedRelation: "empresas";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "prospeccoes_responsavel_id_fkey";
            columns: ["responsavel_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      reunioes: {
        Row: {
          advogado_id: string;
          created_at: string;
          created_by: string;
          data_fim: string;
          data_inicio: string;
          descricao: string | null;
          empresa_id: string | null;
          ics_enviado_em: string | null;
          ics_uid: string | null;
          id: string;
          lead_email: string;
          lead_nome: string;
          link_reuniao: string | null;
          local: string | null;
          notas: string | null;
          prospeccao_id: string | null;
          status: Database["public"]["Enums"]["reuniao_status"];
          titulo: string;
          updated_at: string;
        };
        Insert: {
          advogado_id: string;
          created_at?: string;
          created_by: string;
          data_fim: string;
          data_inicio: string;
          descricao?: string | null;
          empresa_id?: string | null;
          ics_enviado_em?: string | null;
          ics_uid?: string | null;
          id?: string;
          lead_email: string;
          lead_nome: string;
          link_reuniao?: string | null;
          local?: string | null;
          notas?: string | null;
          prospeccao_id?: string | null;
          status?: Database["public"]["Enums"]["reuniao_status"];
          titulo: string;
          updated_at?: string;
        };
        Update: {
          advogado_id?: string;
          created_at?: string;
          created_by?: string;
          data_fim?: string;
          data_inicio?: string;
          descricao?: string | null;
          empresa_id?: string | null;
          ics_enviado_em?: string | null;
          ics_uid?: string | null;
          id?: string;
          lead_email?: string;
          lead_nome?: string;
          link_reuniao?: string | null;
          local?: string | null;
          notas?: string | null;
          prospeccao_id?: string | null;
          status?: Database["public"]["Enums"]["reuniao_status"];
          titulo?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "reunioes_advogado_id_fkey";
            columns: ["advogado_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "reunioes_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "reunioes_empresa_id_fkey";
            columns: ["empresa_id"];
            isOneToOne: false;
            referencedRelation: "empresas";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "reunioes_prospeccao_id_fkey";
            columns: ["prospeccao_id"];
            isOneToOne: false;
            referencedRelation: "prospeccoes";
            referencedColumns: ["id"];
          },
        ];
      };
      rfb_estabelecimentos_busca: {
        Row: {
          atualizado_em: string;
          cnpj: string;
          municipio: string | null;
          nome_fantasia: string | null;
          razao_social: string;
          uf: string;
        };
        Insert: {
          atualizado_em?: string;
          cnpj: string;
          municipio?: string | null;
          nome_fantasia?: string | null;
          razao_social: string;
          uf: string;
        };
        Update: {
          atualizado_em?: string;
          cnpj?: string;
          municipio?: string | null;
          nome_fantasia?: string | null;
          razao_social?: string;
          uf?: string;
        };
        Relationships: [];
      };
      subtarefas: {
        Row: {
          concluida: boolean;
          created_at: string;
          id: string;
          ordem: number;
          tarefa_id: string;
          titulo: string;
        };
        Insert: {
          concluida?: boolean;
          created_at?: string;
          id?: string;
          ordem?: number;
          tarefa_id: string;
          titulo: string;
        };
        Update: {
          concluida?: boolean;
          created_at?: string;
          id?: string;
          ordem?: number;
          tarefa_id?: string;
          titulo?: string;
        };
        Relationships: [
          {
            foreignKeyName: "subtarefas_tarefa_id_fkey";
            columns: ["tarefa_id"];
            isOneToOne: false;
            referencedRelation: "tarefas";
            referencedColumns: ["id"];
          },
        ];
      };
      tarefa_anexos: {
        Row: {
          created_at: string;
          id: string;
          mime_type: string | null;
          nome: string;
          storage_path: string;
          tamanho_bytes: number | null;
          tarefa_id: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          mime_type?: string | null;
          nome: string;
          storage_path: string;
          tamanho_bytes?: number | null;
          tarefa_id: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          mime_type?: string | null;
          nome?: string;
          storage_path?: string;
          tamanho_bytes?: number | null;
          tarefa_id?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "tarefa_anexos_tarefa_id_fkey";
            columns: ["tarefa_id"];
            isOneToOne: false;
            referencedRelation: "tarefas";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "tarefa_anexos_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      tarefa_comentarios: {
        Row: {
          created_at: string;
          id: string;
          tarefa_id: string;
          texto: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          tarefa_id: string;
          texto: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          tarefa_id?: string;
          texto?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "tarefa_comentarios_tarefa_id_fkey";
            columns: ["tarefa_id"];
            isOneToOne: false;
            referencedRelation: "tarefas";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "tarefa_comentarios_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      tarefas: {
        Row: {
          acao_id: string | null;
          assigned_to: string | null;
          concluida_em: string | null;
          created_at: string;
          created_by: string;
          descricao: string | null;
          empresa_id: string | null;
          id: string;
          prazo: string | null;
          prioridade: Database["public"]["Enums"]["tarefa_prioridade"];
          prospeccao_id: string | null;
          recurrence_next_run: string | null;
          recurrence_parent_id: string | null;
          recurrence_rule: string | null;
          status: Database["public"]["Enums"]["tarefa_status"];
          template_id: string | null;
          titulo: string;
          updated_at: string;
        };
        Insert: {
          acao_id?: string | null;
          assigned_to?: string | null;
          concluida_em?: string | null;
          created_at?: string;
          created_by: string;
          descricao?: string | null;
          empresa_id?: string | null;
          id?: string;
          prazo?: string | null;
          prioridade?: Database["public"]["Enums"]["tarefa_prioridade"];
          prospeccao_id?: string | null;
          recurrence_next_run?: string | null;
          recurrence_parent_id?: string | null;
          recurrence_rule?: string | null;
          status?: Database["public"]["Enums"]["tarefa_status"];
          template_id?: string | null;
          titulo: string;
          updated_at?: string;
        };
        Update: {
          acao_id?: string | null;
          assigned_to?: string | null;
          concluida_em?: string | null;
          created_at?: string;
          created_by?: string;
          descricao?: string | null;
          empresa_id?: string | null;
          id?: string;
          prazo?: string | null;
          prioridade?: Database["public"]["Enums"]["tarefa_prioridade"];
          prospeccao_id?: string | null;
          recurrence_next_run?: string | null;
          recurrence_parent_id?: string | null;
          recurrence_rule?: string | null;
          status?: Database["public"]["Enums"]["tarefa_status"];
          template_id?: string | null;
          titulo?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "tarefas_acao_id_fkey";
            columns: ["acao_id"];
            isOneToOne: false;
            referencedRelation: "acoes_tributarias";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "tarefas_assigned_to_fkey";
            columns: ["assigned_to"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "tarefas_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "tarefas_empresa_id_fkey";
            columns: ["empresa_id"];
            isOneToOne: false;
            referencedRelation: "empresas";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "tarefas_prospeccao_id_fkey";
            columns: ["prospeccao_id"];
            isOneToOne: false;
            referencedRelation: "prospeccoes";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "tarefas_recurrence_parent_id_fkey";
            columns: ["recurrence_parent_id"];
            isOneToOne: false;
            referencedRelation: "tarefas";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "tarefas_template_id_fkey";
            columns: ["template_id"];
            isOneToOne: false;
            referencedRelation: "tarefas_templates";
            referencedColumns: ["id"];
          },
        ];
      };
      tarefas_dependencias: {
        Row: {
          created_at: string;
          depende_de_id: string;
          id: string;
          tarefa_id: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          depende_de_id: string;
          id?: string;
          tarefa_id: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          depende_de_id?: string;
          id?: string;
          tarefa_id?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "tarefas_dependencias_depende_de_id_fkey";
            columns: ["depende_de_id"];
            isOneToOne: false;
            referencedRelation: "tarefas";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "tarefas_dependencias_tarefa_id_fkey";
            columns: ["tarefa_id"];
            isOneToOne: false;
            referencedRelation: "tarefas";
            referencedColumns: ["id"];
          },
        ];
      };
      tarefas_templates: {
        Row: {
          acao_id: string | null;
          categoria: string | null;
          created_at: string;
          descricao_padrao: string | null;
          id: string;
          nome: string;
          prazo_relativo_dias: number | null;
          prioridade_padrao: string | null;
          subtarefas_padrao: Json | null;
          titulo_padrao: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          acao_id?: string | null;
          categoria?: string | null;
          created_at?: string;
          descricao_padrao?: string | null;
          id?: string;
          nome: string;
          prazo_relativo_dias?: number | null;
          prioridade_padrao?: string | null;
          subtarefas_padrao?: Json | null;
          titulo_padrao: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          acao_id?: string | null;
          categoria?: string | null;
          created_at?: string;
          descricao_padrao?: string | null;
          id?: string;
          nome?: string;
          prazo_relativo_dias?: number | null;
          prioridade_padrao?: string | null;
          subtarefas_padrao?: Json | null;
          titulo_padrao?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "tarefas_templates_acao_id_fkey";
            columns: ["acao_id"];
            isOneToOne: false;
            referencedRelation: "acoes_tributarias";
            referencedColumns: ["id"];
          },
        ];
      };
      tarefas_tempo: {
        Row: {
          created_at: string;
          duration_sec: number | null;
          id: string;
          nota: string | null;
          started_at: string;
          stopped_at: string | null;
          tarefa_id: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          duration_sec?: number | null;
          id?: string;
          nota?: string | null;
          started_at: string;
          stopped_at?: string | null;
          tarefa_id: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          duration_sec?: number | null;
          id?: string;
          nota?: string | null;
          started_at?: string;
          stopped_at?: string | null;
          tarefa_id?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "tarefas_tempo_tarefa_id_fkey";
            columns: ["tarefa_id"];
            isOneToOne: false;
            referencedRelation: "tarefas";
            referencedColumns: ["id"];
          },
        ];
      };
      tarefas_views_salvas: {
        Row: {
          created_at: string;
          eh_padrao: boolean;
          filtros: Json;
          id: string;
          nome: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          eh_padrao?: boolean;
          filtros?: Json;
          id?: string;
          nome: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          eh_padrao?: boolean;
          filtros?: Json;
          id?: string;
          nome?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      templates_mensagem: {
        Row: {
          assunto: string | null;
          ativo: boolean;
          canal: Database["public"]["Enums"]["canal_contato"];
          categoria: Database["public"]["Enums"]["categoria_template"];
          corpo: string;
          created_at: string;
          created_by: string | null;
          descricao: string | null;
          id: string;
          nome: string;
          updated_at: string;
        };
        Insert: {
          assunto?: string | null;
          ativo?: boolean;
          canal?: Database["public"]["Enums"]["canal_contato"];
          categoria: Database["public"]["Enums"]["categoria_template"];
          corpo: string;
          created_at?: string;
          created_by?: string | null;
          descricao?: string | null;
          id?: string;
          nome: string;
          updated_at?: string;
        };
        Update: {
          assunto?: string | null;
          ativo?: boolean;
          canal?: Database["public"]["Enums"]["canal_contato"];
          categoria?: Database["public"]["Enums"]["categoria_template"];
          corpo?: string;
          created_at?: string;
          created_by?: string | null;
          descricao?: string | null;
          id?: string;
          nome?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "templates_mensagem_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      user_roles: {
        Row: {
          created_at: string;
          id: string;
          role: Database["public"]["Enums"]["app_role"];
          user_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          role: Database["public"]["Enums"]["app_role"];
          user_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          role?: Database["public"]["Enums"]["app_role"];
          user_id?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      v_empresas_enriquecidas: {
        Row: {
          ativas_rfb: number | null;
          baixadas_rfb: number | null;
          enriquecidas: number | null;
          epp: number | null;
          me: number | null;
          medio_grande: number | null;
          mei: number | null;
          simples: number | null;
          total: number | null;
        };
        Relationships: [];
      };
      v_funil_conversao: {
        Row: {
          dias_medios_na_etapa: number | null;
          etapa: string | null;
          qtd: number | null;
          valor_contrato_total: number | null;
        };
        Relationships: [];
      };
      v_funil_valor_potencial: {
        Row: {
          etapa: string | null;
          qtd: number | null;
          valor_potencial_total: number | null;
        };
        Relationships: [];
      };
      v_rfb_busca_status: {
        Row: {
          atualizado_em: string | null;
          total: number | null;
          uf: string | null;
        };
        Relationships: [];
      };
    };
    Functions: {
      buscar_rfb_por_nome: {
        Args: { limite?: number; termo: string; uf_filtro?: string };
        Returns: {
          cnpj: string;
          municipio: string;
          nome_fantasia: string;
          razao_social: string;
          score: number;
          uf: string;
        }[];
      };
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"];
          _user_id: string;
        };
        Returns: boolean;
      };
      is_admin: { Args: { _user_id: string }; Returns: boolean };
      normaliza_cnpj: { Args: { txt: string }; Returns: string };
      normalize_cnpj_text: { Args: { raw: string }; Returns: string };
      pode_iniciar_tarefa: { Args: { tarefa_uuid: string }; Returns: boolean };
      show_limit: { Args: never; Returns: number };
      show_trgm: { Args: { "": string }; Returns: string[] };
    };
    Enums: {
      app_role: "admin" | "advogado" | "comercial" | "gestor";
      canal_contato:
        | "email"
        | "telefone"
        | "whatsapp"
        | "linkedin"
        | "reuniao_presencial"
        | "reuniao_online"
        | "outro";
      cargo_categoria:
        | "ceo"
        | "cfo"
        | "socio"
        | "diretor"
        | "controller"
        | "gerente_fiscal"
        | "contador"
        | "coordenador"
        | "analista"
        | "outros";
      categoria_template:
        | "abertura"
        | "follow_up"
        | "proposta"
        | "negociacao"
        | "breakup"
        | "pos_venda"
        | "objecao_preco"
        | "objecao_tese"
        | "objecao_timing";
      motivo_perdido:
        | "preco"
        | "desconfianca_tese"
        | "timing"
        | "concorrente"
        | "decisor_errado"
        | "sem_interesse"
        | "sem_resposta"
        | "outros";
      origem_contato: "driva" | "rfb" | "manual" | "importacao" | "enriquecimento" | "outro";
      papel_contato:
        | "socio"
        | "decisor"
        | "financeiro"
        | "juridico"
        | "contador"
        | "comercial"
        | "operacional"
        | "geral"
        | "outro";
      porte_rfb: "MEI" | "ME" | "EPP" | "DEMAIS" | "NAO_INFORMADO";
      reuniao_status: "agendada" | "realizada" | "cancelada" | "no_show" | "reagendada";
      situacao_cadastral_rfb: "NULA" | "ATIVA" | "SUSPENSA" | "INAPTA" | "BAIXADA";
      tarefa_prioridade: "baixa" | "media" | "alta" | "urgente";
      tarefa_status: "pendente" | "em_andamento" | "concluida" | "cancelada";
      tipo_contato: "outbound" | "resposta_lead" | "reuniao" | "breakup";
      tipo_prazo: "rescisoria_24m" | "prescricional_5a" | "decadencial_5a" | "personalizado";
      tipo_telefone: "fixo" | "movel" | "desconhecido";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "advogado", "comercial", "gestor"],
      canal_contato: [
        "email",
        "telefone",
        "whatsapp",
        "linkedin",
        "reuniao_presencial",
        "reuniao_online",
        "outro",
      ],
      cargo_categoria: [
        "ceo",
        "cfo",
        "socio",
        "diretor",
        "controller",
        "gerente_fiscal",
        "contador",
        "coordenador",
        "analista",
        "outros",
      ],
      categoria_template: [
        "abertura",
        "follow_up",
        "proposta",
        "negociacao",
        "breakup",
        "pos_venda",
        "objecao_preco",
        "objecao_tese",
        "objecao_timing",
      ],
      motivo_perdido: [
        "preco",
        "desconfianca_tese",
        "timing",
        "concorrente",
        "decisor_errado",
        "sem_interesse",
        "sem_resposta",
        "outros",
      ],
      origem_contato: ["driva", "rfb", "manual", "importacao", "enriquecimento", "outro"],
      papel_contato: [
        "socio",
        "decisor",
        "financeiro",
        "juridico",
        "contador",
        "comercial",
        "operacional",
        "geral",
        "outro",
      ],
      porte_rfb: ["MEI", "ME", "EPP", "DEMAIS", "NAO_INFORMADO"],
      reuniao_status: ["agendada", "realizada", "cancelada", "no_show", "reagendada"],
      situacao_cadastral_rfb: ["NULA", "ATIVA", "SUSPENSA", "INAPTA", "BAIXADA"],
      tarefa_prioridade: ["baixa", "media", "alta", "urgente"],
      tarefa_status: ["pendente", "em_andamento", "concluida", "cancelada"],
      tipo_contato: ["outbound", "resposta_lead", "reuniao", "breakup"],
      tipo_prazo: ["rescisoria_24m", "prescricional_5a", "decadencial_5a", "personalizado"],
      tipo_telefone: ["fixo", "movel", "desconhecido"],
    },
  },
} as const;
