import { describe, it, expect } from "vitest";
import {
  defaultRegraFor,
  respostaDisparaExclusao,
  validateRegra,
  type RegraExcludente,
} from "./criterios";

describe("defaultRegraFor", () => {
  it("boolean default: excluir quando false (resposta negativa)", () => {
    expect(defaultRegraFor("boolean")).toEqual({ tipo: "boolean", excludeWhen: false });
  });
  it("number default: excluir quando <= 0", () => {
    expect(defaultRegraFor("number")).toEqual({ tipo: "number", operator: "lte", value: 0 });
  });
  it("date default: excluir quando vazio", () => {
    expect(defaultRegraFor("date")).toEqual({ tipo: "date", operator: "empty" });
  });
  it("text default: excluir quando vazio", () => {
    expect(defaultRegraFor("text")).toEqual({ tipo: "text", operator: "empty" });
  });
  it("select default: nenhuma opção exclui (admin escolhe)", () => {
    expect(defaultRegraFor("select")).toEqual({ tipo: "select", excludeOptions: [] });
  });
});

describe("respostaDisparaExclusao — boolean", () => {
  const regra: RegraExcludente = { tipo: "boolean", excludeWhen: false };
  it("dispara quando bool === excludeWhen", () => {
    expect(respostaDisparaExclusao(regra, { bool: false })).toBe(true);
  });
  it("não dispara quando bool !== excludeWhen", () => {
    expect(respostaDisparaExclusao(regra, { bool: true })).toBe(false);
  });
  it("não dispara quando resposta undefined", () => {
    expect(respostaDisparaExclusao(regra, {})).toBe(false);
  });
});

describe("respostaDisparaExclusao — number", () => {
  it("operator=lte dispara quando v <= valor", () => {
    const r: RegraExcludente = { tipo: "number", operator: "lte", value: 0 };
    expect(respostaDisparaExclusao(r, { number: 0 })).toBe(true);
    expect(respostaDisparaExclusao(r, { number: -1 })).toBe(true);
    expect(respostaDisparaExclusao(r, { number: 1 })).toBe(false);
  });
  it("operator=gt dispara quando v > valor", () => {
    const r: RegraExcludente = { tipo: "number", operator: "gt", value: 100 };
    expect(respostaDisparaExclusao(r, { number: 101 })).toBe(true);
    expect(respostaDisparaExclusao(r, { number: 100 })).toBe(false);
  });
  it("operator=eq dispara em igualdade exata", () => {
    const r: RegraExcludente = { tipo: "number", operator: "eq", value: 42 };
    expect(respostaDisparaExclusao(r, { number: 42 })).toBe(true);
    expect(respostaDisparaExclusao(r, { number: 41.99 })).toBe(false);
  });
  it("operator=between exige value2 e dispara dentro do range", () => {
    const r: RegraExcludente = { tipo: "number", operator: "between", value: 10, value2: 20 };
    expect(respostaDisparaExclusao(r, { number: 15 })).toBe(true);
    expect(respostaDisparaExclusao(r, { number: 10 })).toBe(true);
    expect(respostaDisparaExclusao(r, { number: 20 })).toBe(true);
    expect(respostaDisparaExclusao(r, { number: 9 })).toBe(false);
    expect(respostaDisparaExclusao(r, { number: 21 })).toBe(false);
  });
  it("operator=outside dispara fora do range", () => {
    const r: RegraExcludente = { tipo: "number", operator: "outside", value: 10, value2: 20 };
    expect(respostaDisparaExclusao(r, { number: 5 })).toBe(true);
    expect(respostaDisparaExclusao(r, { number: 25 })).toBe(true);
    expect(respostaDisparaExclusao(r, { number: 15 })).toBe(false);
  });
  it("não dispara quando resposta ausente ou NaN", () => {
    const r: RegraExcludente = { tipo: "number", operator: "lte", value: 0 };
    expect(respostaDisparaExclusao(r, {})).toBe(false);
    expect(respostaDisparaExclusao(r, { number: NaN })).toBe(false);
  });
});

describe("respostaDisparaExclusao — date", () => {
  it("operator=empty dispara quando sem data", () => {
    const r: RegraExcludente = { tipo: "date", operator: "empty" };
    expect(respostaDisparaExclusao(r, {})).toBe(true);
    expect(respostaDisparaExclusao(r, { date: "2026-01-01" })).toBe(false);
  });
  it("operator=non_empty dispara quando tem data", () => {
    const r: RegraExcludente = { tipo: "date", operator: "non_empty" };
    expect(respostaDisparaExclusao(r, { date: "2026-01-01" })).toBe(true);
    expect(respostaDisparaExclusao(r, {})).toBe(false);
  });
  it("operator=before dispara quando d < valor", () => {
    const r: RegraExcludente = { tipo: "date", operator: "before", value: "2026-01-01" };
    expect(respostaDisparaExclusao(r, { date: "2025-12-31" })).toBe(true);
    expect(respostaDisparaExclusao(r, { date: "2026-01-01" })).toBe(false);
  });
  it("operator=between exige value E value2", () => {
    const r: RegraExcludente = {
      tipo: "date",
      operator: "between",
      value: "2026-01-01",
      value2: "2026-12-31",
    };
    expect(respostaDisparaExclusao(r, { date: "2026-06-15" })).toBe(true);
    expect(respostaDisparaExclusao(r, { date: "2025-12-31" })).toBe(false);
  });
});

describe("respostaDisparaExclusao — select / text", () => {
  it("select: dispara quando opção marcada como exclusão", () => {
    const r: RegraExcludente = { tipo: "select", excludeOptions: ["MEI", "LucroReal"] };
    expect(respostaDisparaExclusao(r, { select: "MEI" })).toBe(true);
    expect(respostaDisparaExclusao(r, { select: "Simples" })).toBe(false);
  });
  it("text contains: dispara quando texto contém termo (case-insensitive)", () => {
    const r: RegraExcludente = { tipo: "text", operator: "contains", value: "Falência" };
    expect(respostaDisparaExclusao(r, { text: "Empresa em FALÊNCIA hoje" })).toBe(true);
    expect(respostaDisparaExclusao(r, { text: "Ativa" })).toBe(false);
  });
  it("text empty: dispara quando texto vazio ou só espaços", () => {
    const r: RegraExcludente = { tipo: "text", operator: "empty" };
    expect(respostaDisparaExclusao(r, { text: "" })).toBe(true);
    expect(respostaDisparaExclusao(r, { text: "   " })).toBe(true);
    expect(respostaDisparaExclusao(r, {})).toBe(true);
    expect(respostaDisparaExclusao(r, { text: "qualquer" })).toBe(false);
  });
});

describe("validateRegra", () => {
  it("number sem valor: erro", () => {
    expect(validateRegra({ tipo: "number", operator: "lte", value: NaN })).toMatch(/valor/i);
  });
  it("number between sem value2: erro", () => {
    expect(validateRegra({ tipo: "number", operator: "between", value: 10 })).toMatch(/intervalo/i);
  });
  it("number between com value > value2: erro", () => {
    expect(validateRegra({ tipo: "number", operator: "between", value: 20, value2: 10 })).toMatch(
      /menor/i
    );
  });
  it("date empty/non_empty: válido sem value", () => {
    expect(validateRegra({ tipo: "date", operator: "empty" })).toBeNull();
    expect(validateRegra({ tipo: "date", operator: "non_empty" })).toBeNull();
  });
  it("date before sem value: erro", () => {
    expect(validateRegra({ tipo: "date", operator: "before" })).toMatch(/data/i);
  });
  it("select sem opções: erro", () => {
    expect(validateRegra({ tipo: "select", excludeOptions: [] })).toMatch(/opção/i);
  });
  it("text contains sem termo: erro", () => {
    expect(validateRegra({ tipo: "text", operator: "contains", value: "  " })).toMatch(/termo/i);
  });
  it("boolean sempre válido", () => {
    expect(validateRegra({ tipo: "boolean", excludeWhen: false })).toBeNull();
  });
});
