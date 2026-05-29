import { describe, it, expect } from "vitest";
import { unmaskCNPJ, maskCNPJ, validateCNPJ, validateCNPJMessage } from "./cnpj";

describe("unmaskCNPJ", () => {
  it("remove formatação", () => {
    expect(unmaskCNPJ("11.222.333/0001-81")).toBe("11222333000181");
  });
  it("retorna string vazia para input vazio/null", () => {
    expect(unmaskCNPJ("")).toBe("");
    expect(unmaskCNPJ(null as unknown as string)).toBe("");
  });
  it("preserva apenas dígitos", () => {
    expect(unmaskCNPJ("abc 11.222 def 333/0001-81 xyz")).toBe("11222333000181");
  });
});

describe("maskCNPJ", () => {
  it("aplica formatação 00.000.000/0000-00", () => {
    expect(maskCNPJ("11222333000181")).toBe("11.222.333/0001-81");
  });
  it("aceita já formatado (idempotente)", () => {
    expect(maskCNPJ("11.222.333/0001-81")).toBe("11.222.333/0001-81");
  });
  it("trunca em 14 dígitos", () => {
    expect(maskCNPJ("112223330001819999")).toBe("11.222.333/0001-81");
  });
  it("formata parcial enquanto digita", () => {
    expect(maskCNPJ("11222")).toBe("11.222");
    expect(maskCNPJ("11222333")).toBe("11.222.333");
  });
});

describe("validateCNPJ", () => {
  it("aceita CNPJs válidos conhecidos", () => {
    // Geradores públicos: ambos passam no mod-11
    expect(validateCNPJ("11.222.333/0001-81")).toBe(true);
    expect(validateCNPJ("11222333000181")).toBe(true);
    expect(validateCNPJ("33.000.167/0001-01")).toBe(true); // Banco do Brasil
    expect(validateCNPJ("00.000.000/0001-91")).toBe(true); // Banco do Brasil ag central
  });

  it("rejeita CNPJ com dígitos verificadores errados", () => {
    expect(validateCNPJ("11.222.333/0001-99")).toBe(false);
    expect(validateCNPJ("11222333000100")).toBe(false);
  });

  it("rejeita comprimento errado", () => {
    expect(validateCNPJ("")).toBe(false);
    expect(validateCNPJ("123")).toBe(false);
    expect(validateCNPJ("11222333000")).toBe(false);
    expect(validateCNPJ("112223330001818")).toBe(false);
  });

  it("rejeita todas as sequências repetidas", () => {
    expect(validateCNPJ("00000000000000")).toBe(false);
    expect(validateCNPJ("11111111111111")).toBe(false);
    expect(validateCNPJ("99999999999999")).toBe(false);
  });

  it("aceita CNPJ com máscara ou sem", () => {
    expect(validateCNPJ("11.222.333/0001-81")).toBe(true);
    expect(validateCNPJ("11222333000181")).toBe(true);
  });
});

describe("validateCNPJMessage", () => {
  it("retorna null pra CNPJ válido", () => {
    expect(validateCNPJMessage("11.222.333/0001-81")).toBeNull();
  });
  it("flagga campo obrigatório quando vazio", () => {
    expect(validateCNPJMessage("")).toBe("CNPJ é obrigatório");
  });
  it("flagga comprimento errado", () => {
    expect(validateCNPJMessage("123")).toBe("CNPJ deve ter 14 dígitos");
  });
  it("flagga sequência repetida especificamente", () => {
    expect(validateCNPJMessage("00000000000000")).toBe("CNPJ inválido (sequência repetida)");
  });
  it("flagga dígitos verificadores errados", () => {
    expect(validateCNPJMessage("11.222.333/0001-99")).toBe("CNPJ inválido (dígitos verificadores)");
  });
});
