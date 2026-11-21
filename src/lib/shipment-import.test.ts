import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { parseShipmentWorkbook } from "./shipment-import";

function workbook(rows: unknown[][]): ArrayBuffer {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), "Orders");
  return XLSX.write(book, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
}

describe("shipment workbook import", () => {
  it("imports sample-style grouped rows and preserves long text identifiers and postcodes", () => {
    const file = workbook([
      ["", "TRACKING NO.", "AWB NO.", "DATE", "NAME", "ADRESS", "COUNTRY", "CODE", "SERVICE", "WT.", "CITY", "STATE"],
      [],
      ["", "", "", "", "Shop One"],
      [1, "9214490123456789012345", "", "04/11/2026", "First Customer", "Example Street", "USA", "02132", "USPS", 0.05, "Boston", "MA"],
      [2, "QP120391234GB", "", "05/11/2026", "Second Customer", "Example Road", "UNITED KINGDOM", "DE4 3LT", "ROYAL MAIL"],
      [],
      ["", "", "", "", "Shop Two"],
      [1, "9214490123456789012346", "", "14/11/2026", "Third Customer", "Test Avenue", "USA", 7882, "USPS"],
    ]);
    const result = parseShipmentWorkbook(file);
    expect(result.issues).toEqual([]);
    expect(result.shipments).toHaveLength(3);
    expect(result.shipments[0]).toMatchObject({ trackingNumber: "9214490123456789012345", shop: "Shop One", name: "First Customer", postcode: "02132", carrier: "usps", shippedDate: "2026-11-04", source: { sheet: "Orders", row: 4 } });
    expect(result.shipments[1]).toMatchObject({ carrier: "royal-mail", postcode: "DE4 3LT", shop: "Shop One" });
    expect(result.shipments[2]).toMatchObject({ postcode: "07882", shop: "Shop Two" });
    expect(result.shipments[2].warnings).toContain("US postcode came from a number; check leading zeros.");
    expect(result.shipments[0].warnings.some((w) => w.includes("day/month/year"))).toBe(true);
  });

  it("flags duplicates, unsafe Excel numbers, and missing tracking numbers without silently importing them", () => {
    const file = workbook([
      ["Tracking number", "Customer name", "Shipping address", "Carrier"],
      ["1Z999AA10123456784", "A", "Road", "UPS"],
      ["1Z999AA10123456784", "B", "Road", "UPS"],
      [9214490123456789000000, "C", "Road", "USPS"],
      ["", "D", "Road", "USPS"],
    ]);
    const result = parseShipmentWorkbook(file);
    expect(result.shipments).toHaveLength(1);
    expect(result.issues.map((issue) => issue.source.row)).toEqual([3, 4, 5]);
    expect(result.issues.map((issue) => issue.reason)).toEqual(expect.arrayContaining([
      expect.stringContaining("Duplicate"), expect.stringContaining("lost digits"), expect.stringContaining("Missing tracking"),
    ]));
  });

  it("handles reordered headers, typo corrections, postcode extraction, and ambiguous carrier mismatch", () => {
    const file = workbook([
      ["Customer", "Shipping method", "tracking ID", "Shipping address", "Store", "Country", "Sent date"],
      ["Example", "USPS", "1Z999AA10123456784", "Example Street, DE4 3LT", "Shop", "UK", "2026-11-13"],
      ["Other", "ROYAL MAL", "QP120391234GB", "Example Street", "Shop", "UK", "bad date"],
    ]);
    const result = parseShipmentWorkbook(file);
    expect(result.shipments[0]).toMatchObject({ carrier: "usps", postcode: "DE4 3LT", shop: "Shop", shippedDate: "2026-11-13" });
    expect(result.shipments[0].warnings.some((w) => w.includes("different carriers"))).toBe(true);
    expect(result.shipments[1].carrier).toBe("royal-mail");
    expect(result.shipments[1].warnings.some((w) => w.includes("corrected"))).toBe(true);
    expect(result.shipments[1].warnings.some((w) => w.includes("could not be read"))).toBe(true);
  });

  it("recognizes the service names used in real tracking sheets", () => {
    const result = parseShipmentWorkbook(workbook([
      ["TRACKING NO.", "NAME", "SERVICE"],
      ["8QP000000000000000001", "A", "AU POST"],
      ["DFSG00000000000000001", "B", "DRAGONFLY"],
      ["QP000000001GB", "C", "ROYALMAIL"],
    ]));
    expect(result.shipments.map((s) => s.carrier)).toEqual(["australia-post", "intelcom", "royal-mail"]);
    expect(result.shipments.flatMap((s) => s.warnings)).toEqual([]);
  });

  it("reports unrecognized layouts and accepts Excel date cells", () => {
    expect(parseShipmentWorkbook(workbook([["Not an order table"], ["text"]])).issues[0].reason).toContain("Could not find");
    const result = parseShipmentWorkbook(workbook([["Tracking", "Name", "Date"], ["12345", "Example", new Date(Date.UTC(2026, 10, 4))]]));
    expect(result.shipments[0].shippedDate).toBe("2026-11-04");
  });

  it("preserves long tracking numbers and zero-prefixed postcodes from CSV", () => {
    const csv = "Tracking Number,Name,Country,Postcode,Service\n9214490123456789012345,Example,USA,02132,USPS\n";
    const bytes = new TextEncoder().encode(csv);
    const result = parseShipmentWorkbook(bytes.buffer);
    expect(result.shipments[0]).toMatchObject({ trackingNumber: "9214490123456789012345", postcode: "02132" });
    expect(result.issues).toEqual([]);
  });
});
