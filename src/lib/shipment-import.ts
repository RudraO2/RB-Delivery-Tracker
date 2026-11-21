import * as XLSX from "xlsx";

export interface ImportSource { sheet: string; row: number }
export interface ImportedShipment {
  trackingNumber: string;
  awb: string;
  shippedDate: string;
  name: string;
  address: string;
  country: string;
  postcode: string;
  carrier: string;
  service: string;
  weight: string;
  city: string;
  state: string;
  shop: string;
  source: ImportSource;
  warnings: string[];
}
export interface ImportIssue { source: ImportSource; reason: string }
export interface ImportResult { shipments: ImportedShipment[]; issues: ImportIssue[]; sheets: number }

type Field = "tracking" | "awb" | "date" | "name" | "address" | "country" | "postcode" | "service" | "weight" | "city" | "state" | "shop";
type Columns = Partial<Record<Field, number>>;
const headers: Record<Field, string[]> = {
  tracking: ["tracking", "tracking no", "tracking number", "tracking id", "tracking code", "tracking #", "trackingnumber"],
  awb: ["awb", "awb no", "awb number", "airway bill", "air waybill"],
  date: ["date", "ship date", "shipping date", "shipped date", "dispatch date", "dispatch on", "sent date"],
  name: ["name", "customer", "customer name", "recipient", "recipient name", "buyer", "buyer name", "consignee", "consignee name"],
  address: ["address", "adress", "address 1", "address line 1", "shipping address", "delivery address"],
  country: ["country", "destination", "destination country", "shipping country"],
  postcode: ["code", "postcode", "postal code", "post code", "zip", "zip code", "zipcode", "pin code", "pincode"],
  service: ["service", "carrier", "courier", "shipping service", "shipping carrier", "shipping method"],
  weight: ["wt", "weight", "weight kg"],
  city: ["city", "town", "shipping city"],
  state: ["state", "province", "county", "region", "shipping state"],
  shop: ["shop", "shop name", "store", "store name", "etsy shop"],
};

const normalizeHeader = (s: string) => s.toLowerCase().replace(/[.\-_/():]/g, " ").replace(/\s+/g, " ").trim();
const text = (cell?: XLSX.CellObject): string => {
  if (!cell || cell.v === null || cell.v === undefined) return "";
  return String(cell.w ?? cell.v).trim();
};
const get = (sheet: XLSX.WorkSheet, row: number, col?: number) =>
  col === undefined ? undefined : sheet[XLSX.utils.encode_cell({ r: row, c: col })] as XLSX.CellObject | undefined;
const sourceFor = (sheet: string, row: number): ImportSource => ({ sheet, row: row + 1 });

function headerColumns(sheet: XLSX.WorkSheet, row: number, startCol: number, endCol: number): Columns {
  const columns: Columns = {};
  for (let col = startCol; col <= endCol; col++) {
    const value = normalizeHeader(text(get(sheet, row, col)));
    if (!value) continue;
    for (const [field, aliases] of Object.entries(headers) as Array<[Field, string[]]>) {
      if (columns[field] === undefined && aliases.includes(value)) columns[field] = col;
    }
  }
  return columns;
}

function validDay(y: number, m: number, d: number): string {
  const parsed = new Date(Date.UTC(y, m - 1, d));
  if (parsed.getUTCFullYear() !== y || parsed.getUTCMonth() + 1 !== m || parsed.getUTCDate() !== d) return "";
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function parseDate(cell: XLSX.CellObject | undefined, warnings: string[]): string {
  if (!cell || cell.v === undefined || cell.v === null || cell.v === "") return "";
  if (cell.t === "n" && typeof cell.v === "number") {
    const d = XLSX.SSF.parse_date_code(cell.v);
    if (d) return validDay(d.y, d.m, d.d);
  }
  if (cell.v instanceof Date && !Number.isNaN(cell.v.getTime())) return validDay(cell.v.getUTCFullYear(), cell.v.getUTCMonth() + 1, cell.v.getUTCDate());
  const value = String(cell.v).trim();
  const iso = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(value);
  if (iso) return validDay(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  const local = /^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})$/.exec(value);
  if (local) {
    const day = Number(local[1]);
    const month = Number(local[2]);
    if (day <= 12 && month <= 12 && day !== month) warnings.push("Date interpreted as day/month/year; check if your file uses month/day/year.");
    const result = validDay(Number(local[3]), month, day);
    if (result) return result;
  }
  warnings.push("Date could not be read; enter the shipping date manually.");
  return "";
}

const carrierAliases: Record<string, string[]> = {
  usps: ["usps", "united states postal service", "us postal service", "us mail"],
  "royal-mail": ["royal mail", "royalmail", "rm"],
  ups: ["ups", "united parcel service"],
  fedex: ["fedex", "federal express", "fed ex"],
  dhl: ["dhl", "dhl express"],
  "india-post": ["india post", "indiapost", "indian post"],
  "australia-post": ["au post", "auspost", "aus post", "australia post", "australian post"],
  // Dragonfly is Intelcom's international brand (Canada); the tracking engine names it intelcom.
  intelcom: ["dragonfly", "dragon fly", "dragonfly canada", "intelcom"],
};
function smallEditDistance(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diagonal = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const old = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
      diagonal = old;
    }
  }
  return prev[b.length];
}

function carrierFor(service: string, number: string, warnings: string[]): string {
  const s = service.toLowerCase().replace(/[^a-z0-9]/g, "");
  let explicit = "";
  let corrected = false;
  for (const [carrier, aliases] of Object.entries(carrierAliases)) {
    if (aliases.some((a) => a.replace(/[^a-z0-9]/g, "") === s)) { explicit = carrier; break; }
  }
  if (s && !explicit && s.length >= 4) {
    const matches = Object.entries(carrierAliases).filter(([, aliases]) => aliases.some((a) => {
      const clean = a.replace(/[^a-z0-9]/g, "");
      return clean.length >= 4 && smallEditDistance(clean, s) === 1;
    }));
    if (matches.length === 1) { explicit = matches[0][0]; corrected = true; }
  }
  // These are hints, not proof. International postal numbers can change hands.
  const compact = number.replace(/\s/g, "").toUpperCase();
  const inferred = /^1Z[A-Z0-9]{16}$/.test(compact) ? "ups" : /^(92|93|94|95)\d{18,20}$/.test(compact) ? "usps" : "";
  if (explicit && inferred && explicit !== inferred) {
    warnings.push("Service and tracking number suggest different carriers; check the carrier.");
    return explicit;
  }
  if (corrected) warnings.push("Carrier spelling was corrected; please check it.");
  if (!explicit && service) warnings.push("Service was not recognized; please check the carrier.");
  if (!explicit && inferred) warnings.push("Carrier was suggested from the tracking number; please check it.");
  if (!explicit && !inferred) warnings.push("Carrier is unknown; select it before tracking if needed.");
  return explicit || inferred;
}

function postalCode(cell: XLSX.CellObject | undefined, country: string, address: string, warnings: string[]): string {
  let value = text(cell);
  if (cell?.t === "n" && typeof cell.v === "number" && /^(usa|us|united states|united states of america)$/i.test(country.trim()) && Number.isInteger(cell.v) && cell.v >= 0 && cell.v <= 99999) {
    value = String(cell.v).padStart(5, "0");
    warnings.push("US postcode came from a number; check leading zeros.");
  }
  if (!value && address) {
    const match = /\b(?:[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}|\d{5}(?:-\d{4})?)\b/i.exec(address);
    if (match) { value = match[0]; warnings.push("Postcode was found in the address; please check it."); }
  }
  return value;
}

/** Read the workbook without modifying it. Only rows with trustworthy tracking IDs are returned. */
export function parseShipmentWorkbook(buffer: ArrayBuffer): ImportResult {
  if (buffer.byteLength > 25 * 1024 * 1024) throw new Error("The file is larger than 25 MB. Split it into smaller files.");
  // `raw` prevents CSV tracking numbers from being coerced to floating point.
  const workbook = XLSX.read(buffer, { type: "array", cellDates: true, cellText: true, raw: true });
  const shipments: ImportedShipment[] = [];
  const issues: ImportIssue[] = [];
  const seen = new Set<string>();
  let recognizedSheets = 0;
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    // Excel chart sheets are not order tables, even when the parser exposes them as sheets.
    if (sheet["!type"] === "chart") continue;
    if (!sheet["!ref"]) continue;
    const range = XLSX.utils.decode_range(sheet["!ref"]);
    if (range.e.r - range.s.r > 100_000 || range.e.c - range.s.c > 500) throw new Error(`Sheet "${sheetName}" is too large to import safely.`);
    let columns: Columns | undefined;
    let group = "";
    for (let row = range.s.r; row <= range.e.r; row++) {
      const candidate = headerColumns(sheet, row, range.s.c, range.e.c);
      if (candidate.tracking !== undefined && (candidate.name !== undefined || candidate.address !== undefined || candidate.service !== undefined)) {
        if (!columns) recognizedSheets++;
        columns = candidate;
        continue;
      }
      if (!columns) continue;
      const cell = (field: Field) => get(sheet, row, columns![field]);
      const trackingCell = cell("tracking");
      const trackingNumber = text(trackingCell).replace(/\s+/g, "");
      const name = text(cell("name"));
      const address = text(cell("address"));
      const service = text(cell("service"));
      const explicitShop = text(cell("shop"));
      const rowSource = sourceFor(sheetName, row);
      if (!trackingNumber) {
        const looksLikeGroup = name && !address && !service && !text(cell("country")) && !text(cell("postcode")) && !text(cell("date")) && !text(cell("awb"));
        if (looksLikeGroup && columns.shop === undefined) group = name;
        else if (name || address || service || text(cell("awb"))) issues.push({ source: rowSource, reason: "Missing tracking number." });
        continue;
      }
      if (trackingCell?.t === "n" && typeof trackingCell.v === "number" && (!Number.isSafeInteger(trackingCell.v) || Math.abs(trackingCell.v) >= 1e15)) {
        issues.push({ source: rowSource, reason: "Tracking number was stored as a long Excel number and may have lost digits. Correct the source as text before importing." });
        continue;
      }
      if (!/^[A-Za-z0-9-]+$/.test(trackingNumber) || !/\d/.test(trackingNumber)) {
        issues.push({ source: rowSource, reason: "Tracking number has an unsupported format." });
        continue;
      }
      const identity = trackingNumber.toUpperCase();
      if (seen.has(identity)) { issues.push({ source: rowSource, reason: "Duplicate tracking number in this file." }); continue; }
      seen.add(identity);
      const warnings: string[] = [];
      if (!name) warnings.push("Customer name is missing.");
      if (trackingCell?.t === "n") warnings.push("Tracking number came from a numeric cell; check for missing leading zeros.");
      const country = text(cell("country"));
      const date = parseDate(cell("date"), warnings);
      shipments.push({ trackingNumber, awb: text(cell("awb")), shippedDate: date, name, address, country,
        postcode: postalCode(cell("postcode"), country, address, warnings), carrier: carrierFor(service, trackingNumber, warnings), service,
        weight: text(cell("weight")), city: text(cell("city")), state: text(cell("state")), shop: explicitShop || group, source: rowSource, warnings });
    }
    if (!columns) issues.push({ source: sourceFor(sheetName, range.s.r), reason: "Could not find a tracking-number header and a name, address or service header on this sheet." });
  }
  return { shipments, issues, sheets: recognizedSheets };
}
