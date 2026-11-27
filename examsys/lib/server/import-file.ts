import Papa from "papaparse";
import { readJson, validation } from "@/lib/api/errors";
import { IMPORT_MAX_BYTES, IMPORT_MAX_ROWS } from "@/lib/constants";

/**
 * Reads a bulk-import upload into plain records. Accepted inputs:
 * - `multipart/form-data` with field `file` (.csv or .json) and optional `examId` (the contract);
 * - `application/json` body: an array of rows, or `{ rows: [...], examId? }` (handy for scripts).
 * Every size/row limit is enforced here, before any validation or database work.
 */

export type ImportFormat = "csv" | "json";

export type ImportSource = {
  format: ImportFormat;
  /** One entry per data row (CSV: header excluded). Rows that are not objects stay as-is. */
  records: unknown[];
  /** CSV header (trimmed); null for JSON input. */
  headers: string[] | null;
  /** Problems found while parsing, keyed by 0-based record index. */
  parseErrors: Map<number, string[]>;
  examId?: string;
};

/** Room for the multipart boundaries and the small extra fields around the file. */
const MULTIPART_OVERHEAD = 64 * 1024;
const MAX_MB = Math.round(IMPORT_MAX_BYTES / (1024 * 1024));
const tooBig = () => validation(`The file is larger than ${MAX_MB} MB`, { file: `Maximum size is ${MAX_MB} MB` });

export async function readImportRequest(request: Request): Promise<ImportSource> {
  const contentType = request.headers.get("content-type") ?? "";

  if (contentType.toLowerCase().startsWith("application/json")) {
    let body: unknown;
    try {
      body = await readJson(request, { maxBytes: IMPORT_MAX_BYTES });
    } catch (error) {
      const length = Number(request.headers.get("content-length") ?? 0);
      if (length > IMPORT_MAX_BYTES) throw tooBig();
      throw error;
    }
    const rows = Array.isArray(body) ? body : isObject(body) && Array.isArray(body.rows) ? body.rows : null;
    if (!rows) throw validation("Send an array of rows, or { rows: [...] }", { rows: "Expected an array of rows" });
    const examId = isObject(body) && typeof body.examId === "string" && body.examId.trim() ? body.examId.trim() : undefined;
    return checkRows({ format: "json", records: rows, headers: null, parseErrors: new Map(), examId });
  }

  if (!contentType.toLowerCase().startsWith("multipart/form-data")) {
    throw validation("Upload the file as multipart/form-data with the field \"file\"", { file: "Choose a .csv or .json file" });
  }

  const bytes = await readBounded(request, IMPORT_MAX_BYTES + MULTIPART_OVERHEAD);
  let form: FormData;
  try {
    form = await new Response(bytes, { headers: { "content-type": contentType } }).formData();
  } catch {
    throw validation("The upload could not be read", { file: "Choose a .csv or .json file" });
  }

  const file = form.get("file");
  if (file === null || typeof file === "string") throw validation("No file was uploaded", { file: "Choose a .csv or .json file" });
  if (file.size > IMPORT_MAX_BYTES) throw tooBig();
  if (file.size === 0) throw validation("The file is empty", { file: "The file is empty" });

  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer());
  } catch {
    throw validation("The file must be UTF-8 text (CSV or JSON)", { file: "Save the file as UTF-8 CSV or JSON" });
  }
  text = text.replace(/^﻿/, "");

  const examIdField = form.get("examId");
  const examId = typeof examIdField === "string" && examIdField.trim() ? examIdField.trim() : undefined;
  const format = detectFormat(file.name, file.type, text);
  return checkRows({ ...(format === "json" ? parseJson(text) : parseCsv(text)), examId });
}

function detectFormat(name: string, type: string, text: string): ImportFormat {
  const lower = name.toLowerCase();
  if (lower.endsWith(".json")) return "json";
  if (lower.endsWith(".csv")) return "csv";
  if (type.includes("json")) return "json";
  const first = text.trimStart()[0];
  return first === "[" || first === "{" ? "json" : "csv";
}

function parseJson(text: string): Omit<ImportSource, "examId"> {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw validation("The JSON file could not be parsed", { file: "Invalid JSON" });
  }
  const rows = Array.isArray(data) ? data : isObject(data) && Array.isArray(data.rows) ? data.rows : null;
  if (!rows) throw validation("The JSON file must contain an array of rows", { file: "Expected an array of rows" });
  return { format: "json", records: rows, headers: null, parseErrors: new Map() };
}

function parseCsv(text: string): Omit<ImportSource, "examId"> {
  const result = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (header) => header.trim(),
  });
  const headers = (result.meta.fields ?? []).filter((field) => field !== "");
  if (headers.length === 0) throw validation("The CSV file has no header row", { file: "Missing header row" });

  const parseErrors = new Map<number, string[]>();
  for (const error of result.errors) {
    // Short rows are fine (trailing optional columns may be left out); single-column files have no delimiter.
    if (error.code === "TooFewFields" || error.code === "UndetectableDelimiter") continue;
    if (typeof error.row !== "number") throw validation(`The CSV file could not be read: ${error.message}`, { file: error.message });
    const message = error.code === "TooManyFields" ? "row: More values than there are columns" : `row: ${error.message}`;
    parseErrors.set(error.row, [...(parseErrors.get(error.row) ?? []), message]);
  }
  return { format: "csv", records: result.data, headers, parseErrors };
}

function checkRows(source: ImportSource): ImportSource {
  if (source.records.length === 0) throw validation("The file has no data rows", { file: "No data rows found" });
  if (source.records.length > IMPORT_MAX_ROWS) {
    throw validation(`The file has ${source.records.length} rows; the maximum is ${IMPORT_MAX_ROWS}`, {
      file: `At most ${IMPORT_MAX_ROWS} rows per import`,
    });
  }
  return source;
}

/** Reads the whole body, refusing anything over `maxBytes` without buffering it all. */
async function readBounded(request: Request, maxBytes: number): Promise<Uint8Array<ArrayBuffer>> {
  const length = request.headers.get("content-length");
  if (length !== null && Number(length) > maxBytes) throw tooBig();
  if (request.body === null) throw validation("No file was uploaded", { file: "Choose a .csv or .json file" });

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw tooBig();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(new ArrayBuffer(total));
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Maps a record's keys onto the canonical column names, ignoring case, spaces,
 * underscores and dashes ("Roll No" -> rollNo, "option_a" -> optionA). Unknown keys are kept.
 */
export function canonicalKeys(record: Record<string, unknown>, columns: readonly string[]): Record<string, unknown> {
  const lookup = new Map(columns.map((column) => [squash(column), column]));
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    const canonical = lookup.get(squash(key)) ?? key;
    if (!(canonical in out) || out[canonical] === "" || out[canonical] === undefined) out[canonical] = value;
  }
  return out;
}

/** CSV only: every required column must be in the header. */
export function requireColumns(headers: string[] | null, required: readonly string[], all: readonly string[]) {
  if (!headers) return;
  const present = new Set(headers.map(squash));
  const missing = required.filter((column) => !present.has(squash(column)));
  if (missing.length > 0) {
    throw validation(`Missing column${missing.length === 1 ? "" : "s"}: ${missing.join(", ")}. Expected: ${all.join(",")}`, {
      file: `Missing column${missing.length === 1 ? "" : "s"}: ${missing.join(", ")}`,
    });
  }
}

const squash = (value: string) => value.toLowerCase().replace(/[\s_-]/g, "");
