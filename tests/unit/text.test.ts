import { describe, expect, it } from "vitest";
import { normalizeSourceText, collapseWhitespace, normalizePunctuation, normalizeForMatch } from "@/lib/text";

describe("normalizeSourceText", () => {
  it("converts CRLF and CR to LF", () => {
    expect(normalizeSourceText("a\r\nb\rc")).toBe("a\nb\nc");
  });

  it("converts NBSP and other unicode spaces to a plain space", () => {
    const withNbsp = `Rent: $1,500`;
    expect(normalizeSourceText(withNbsp)).toBe("Rent: $1,500");
  });

  it("strips zero-width characters", () => {
    expect(normalizeSourceText("a​b﻿c")).toBe("abc");
  });

  it("strips trailing whitespace from each line", () => {
    expect(normalizeSourceText("line one   \nline two\t\n")).toBe("line one\nline two");
  });

  it("collapses 3+ blank lines to a single blank line", () => {
    expect(normalizeSourceText("a\n\n\n\n\nb")).toBe("a\n\nb");
  });

  it("keeps a single blank line as-is", () => {
    expect(normalizeSourceText("a\n\nb")).toBe("a\n\nb");
  });

  it("trims leading/trailing whitespace from the whole document", () => {
    expect(normalizeSourceText("\n\n  hello  \n\n")).toBe("hello");
  });
});

describe("whitespace-tolerant matching helpers", () => {
  it("collapseWhitespace collapses any run of whitespace to one space", () => {
    expect(collapseWhitespace("a\n\n b   c\t\td")).toBe("a b c d");
  });

  it("normalizePunctuation maps curly quotes/apostrophes and dashes to straight equivalents", () => {
    expect(normalizePunctuation("“hello” ‘world’ – test—end")).toBe(
      '"hello" \'world\' - test-end',
    );
  });

  it("normalizeForMatch combines both and trims", () => {
    expect(normalizeForMatch("  “Hello   world”  ")).toBe('"Hello world"');
  });
});
