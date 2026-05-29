import { describe, it, expect, vi } from "vitest";
import { fetchAllRows } from "./supabaseFetchAll";

// O overload (table, select) chama supabase.from internamente. Esses testes
// cobrem o overload (buildQuery) — equivalente em comportamento, mas sem
// precisar mockar o cliente.

describe("fetchAllRows — paginação", () => {
  it("retorna array vazio quando não há linhas", async () => {
    const builder = vi.fn().mockResolvedValue({ data: [], error: null });
    const out = await fetchAllRows<{ id: number }>(builder, { pageSize: 100 });
    expect(out).toEqual([]);
    expect(builder).toHaveBeenCalledTimes(1);
    expect(builder).toHaveBeenCalledWith(0, 99);
  });

  it("para imediatamente quando primeira página vem incompleta (< pageSize)", async () => {
    const builder = vi.fn().mockResolvedValue({
      data: [{ id: 1 }, { id: 2 }, { id: 3 }],
      error: null,
    });
    const out = await fetchAllRows<{ id: number }>(builder, { pageSize: 100 });
    expect(out).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }]);
    expect(builder).toHaveBeenCalledTimes(1);
  });

  it("itera múltiplas páginas até esgotar", async () => {
    const builder = vi
      .fn()
      .mockResolvedValueOnce({
        data: Array.from({ length: 100 }, (_, i) => ({ id: i })),
        error: null,
      })
      .mockResolvedValueOnce({
        data: Array.from({ length: 100 }, (_, i) => ({ id: 100 + i })),
        error: null,
      })
      .mockResolvedValueOnce({
        data: Array.from({ length: 50 }, (_, i) => ({ id: 200 + i })),
        error: null,
      });

    const out = await fetchAllRows<{ id: number }>(builder, { pageSize: 100 });
    expect(out).toHaveLength(250);
    expect(out[0]).toEqual({ id: 0 });
    expect(out[249]).toEqual({ id: 249 });
    expect(builder).toHaveBeenCalledTimes(3);
    expect(builder).toHaveBeenNthCalledWith(1, 0, 99);
    expect(builder).toHaveBeenNthCalledWith(2, 100, 199);
    expect(builder).toHaveBeenNthCalledWith(3, 200, 299);
  });

  it("para quando uma página vem exatamente vazia (data null)", async () => {
    const builder = vi
      .fn()
      .mockResolvedValueOnce({
        data: Array.from({ length: 100 }, (_, i) => ({ id: i })),
        error: null,
      })
      .mockResolvedValueOnce({ data: null, error: null });

    const out = await fetchAllRows<{ id: number }>(builder, { pageSize: 100 });
    expect(out).toHaveLength(100);
    expect(builder).toHaveBeenCalledTimes(2);
  });

  it("lança erro quando o builder retorna error", async () => {
    const err = new Error("PostgrestError simulado");
    const builder = vi.fn().mockResolvedValue({ data: null, error: err });
    await expect(fetchAllRows(builder)).rejects.toBe(err);
  });

  it("respeita safetyCap pra impedir loop infinito", async () => {
    // Builder que sempre retorna página cheia — sem safetyCap iria pra sempre
    const builder = vi.fn().mockImplementation(() =>
      Promise.resolve({
        data: Array.from({ length: 100 }, () => ({ id: 1 })),
        error: null,
      })
    );
    const out = await fetchAllRows(builder, { pageSize: 100, safetyCap: 300 });
    // Com safetyCap=300, pageSize=100 → no máximo 3 chamadas (from=0, 100, 200)
    expect(builder).toHaveBeenCalledTimes(3);
    expect(out).toHaveLength(300);
  });

  it("usa pageSize default de 1000 quando não passado", async () => {
    const builder = vi.fn().mockResolvedValue({ data: [], error: null });
    await fetchAllRows(builder);
    expect(builder).toHaveBeenCalledWith(0, 999);
  });
});
