import { describe, it, expect } from "vitest";
import { parseCsv, parseCsvRecords } from "./csv.js";

describe("parseCsv", () => {
  it("splits simple rows", () => {
    expect(parseCsv("a,b\n1,2\n")).toEqual([["a", "b"], ["1", "2"]]);
  });
  it("handles CRLF line endings and a BOM", () => {
    expect(parseCsv("﻿a,b\r\n1,2\r\n")).toEqual([["a", "b"], ["1", "2"]]);
  });
  it("keeps commas, newlines, and escaped quotes inside quoted fields", () => {
    expect(parseCsv('n\n"Acme, Inc"\n"two\nlines"\n"say ""hi"""\n')).toEqual([
      ["n"], ["Acme, Inc"], ["two\nlines"], ['say "hi"'],
    ]);
  });
  it("keeps empty fields and drops blank lines", () => {
    expect(parseCsv("a,b,c\n1,,3\n\n")).toEqual([["a", "b", "c"], ["1", "", "3"]]);
  });
  it("parses a final row without a trailing newline", () => {
    expect(parseCsv("a\n1")).toEqual([["a"], ["1"]]);
  });
  it("throws on an unterminated quote", () => {
    expect(() => parseCsv('a\n"oops')).toThrow(/unterminated/);
  });
});

describe("parseCsvRecords", () => {
  it("maps rows onto trimmed header keys, filling missing cells with empty strings", () => {
    expect(parseCsvRecords(" domain , companyName\nacme.com\n")).toEqual([
      { domain: "acme.com", companyName: "" },
    ]);
  });
});
