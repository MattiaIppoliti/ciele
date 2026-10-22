import { describe, expect, it } from "vitest";
import {
  PII_DETECTORS,
  createPiiMasker,
  detectPii,
  piiMaskingOrigins,
  piiMaskingSummary,
  transcriptPiiMasker,
  type PiiDetector,
} from "./pii";

const ALL = PII_DETECTORS;

function masked(text: string, detectors: readonly PiiDetector[] = ALL): string {
  return createPiiMasker(detectors).mask(text);
}

describe("email detector", () => {
  it("masks an address, embedded in surrounding text", () => {
    expect(masked("Write to jane.doe+uni@example.co.uk, thanks.")).toBe("Write to [EMAIL_1], thanks.");
  });

  it("leaves look-alikes alone", () => {
    for (const text of ["ping me @jane", "jane@localhost", "a@b", "user at example dot com"]) {
      expect(masked(text)).toBe(text);
    }
  });
});

describe("phone detector", () => {
  it("masks international, trunk-prefixed and grouped numbers", () => {
    for (const phone of [
      "+39 06 1234 5678",
      "0039 06 1234 5678",
      "+44 20 7946 0958",
      "+390612345678",
      "+1 (555) 123-4567",
      "06 1234 5678",
      "020 7946 0958",
      "(555) 123-4567",
      "555-123-4567",
      "333 123 4567",
    ]) {
      expect(masked(`call ${phone} today`), phone).toBe("call [PHONE_1] today");
    }
  });

  it("leaves a bare digit run, a date and a short code alone", () => {
    for (const text of [
      "order 3331234567",
      "ticket 1234567890 is open",
      "born 01.02.2024",
      "room 06 12",
      "version 1.2.3",
      "+39 12",
      // `00` is the international prefix, never a trunk 0 plus an area code,
      // and no country code starts with 0.
      "ref 0000 0123 456",
      "code +0 1234 5678 90",
      // `00` is only a prefix when the number is written in groups.
      "order 0012345678",
      // A day and an hour, a day and a head count.
      "booked 01-02-2024 10:30",
      "on 05.10.2026 14 people",
    ]) {
      expect(masked(text), text).toBe(text);
    }
  });
});

describe("payment card detector", () => {
  it("masks a Luhn-valid number however it is grouped", () => {
    for (const card of ["4111 1111 1111 1111", "4111-1111-1111-1111", "5555555555554444", "3782 822463 10005"]) {
      expect(masked(`card ${card} exp 12/27`), card).toBe("card [CARD_1] exp 12/27");
    }
  });

  it("leaves a number that fails the Luhn check alone", () => {
    expect(masked("card 4111 1111 1111 1112")).toBe("card 4111 1111 1111 1112");
  });

  it("leaves a Luhn-valid number that cannot be a card alone", () => {
    // 16 digits, Luhn-valid, but no card scheme starts with 1.
    expect(masked("order 1234567812345670")).toBe("order 1234567812345670");
  });

  it("leaves a list of amounts alone, however Luhn reads a window of it", () => {
    const text = "I paid 100 200 300 400 500 600 700 800 900";
    expect(masked(text)).toBe(text);
  });

  it("finds the card inside a longer run of digits", () => {
    expect(masked("ref 12 4111 1111 1111 1111 2027")).toBe("ref 12 [CARD_1] 2027");
  });
});

describe("IBAN detector", () => {
  it("masks a mod-97-valid IBAN, spaced or not, upper or lower case", () => {
    for (const iban of [
      "IT60 X054 2811 1010 0000 0123 456",
      "IT60X0542811101000000123456",
      "GB82 WEST 1234 5698 7654 32",
      "de89370400440532013000",
    ]) {
      expect(masked(`pay to ${iban} thanks`), iban).toBe("pay to [IBAN_1] thanks");
    }
  });

  it("keeps the sentence's own punctuation", () => {
    expect(masked("IBAN: DE89370400440532013000.")).toBe("IBAN: [IBAN_1].");
  });

  it("leaves an IBAN with a wrong check digit alone", () => {
    expect(masked("pay to IT61 X054 2811 1010 0000 0123 456")).toBe("pay to IT61 X054 2811 1010 0000 0123 456");
  });
});

describe("codice fiscale detector", () => {
  it("masks a code whose check character is right, in either case", () => {
    for (const code of ["RSSMRA85T10A562S", "bncgpp70a41h501g"]) {
      expect(masked(`CF: ${code}.`), code).toBe("CF: [CODICE_FISCALE_1].");
    }
  });

  it("leaves a code with a wrong check character alone", () => {
    expect(masked("CF: RSSMRA85T10A562X")).toBe("CF: RSSMRA85T10A562X");
  });

  it("masks an omocodia variant, letters standing in for digits", () => {
    for (const code of ["RSSMRA85T10A56NH", "RSSMRA85T10A5SNT"]) {
      expect(masked(`codice ${code} ok`), code).toBe("codice [CODICE_FISCALE_1] ok");
    }
  });

  it("is one value however it is cased", () => {
    const masker = createPiiMasker(ALL);
    expect(masker.mask("RSSMRA85T10A562S and rssmra85t10a562s")).toBe(
      "[CODICE_FISCALE_1] and [CODICE_FISCALE_1]"
    );
  });
});

describe("detectPii", () => {
  it("runs only the selected detectors", () => {
    const text = "jane@example.com +39 06 1234 5678";
    expect(detectPii(text, ["phone"]).map((m) => m.detector)).toEqual(["phone"]);
    expect(createPiiMasker(["email"]).mask(text)).toBe("[EMAIL_1] +39 06 1234 5678");
  });

  it("never reports overlapping matches", () => {
    const matches = detectPii("+44 4111 1111 1111 1111 and it60x0542811101000000123456@bank.example", ALL);
    for (let i = 1; i < matches.length; i++) {
      expect(matches[i]!.start).toBeGreaterThanOrEqual(matches[i - 1]!.end);
    }
  });
});

describe("createPiiMasker", () => {
  it("gives one value one placeholder across calls, whatever its case or spacing", () => {
    const masker = createPiiMasker(ALL);
    expect(masker.mask("I am Jane@Example.com")).toBe("I am [EMAIL_1]");
    expect(masker.mask("again jane@example.com and bob@example.com")).toBe("again [EMAIL_1] and [EMAIL_2]");
    expect(masker.mask("IBAN IT60X0542811101000000123456")).toBe("IBAN [IBAN_1]");
    expect(masker.mask("IBAN IT60 X054 2811 1010 0000 0123 456")).toBe("IBAN [IBAN_1]");
  });

  it("is idempotent: masked text masks to itself", () => {
    const masker = createPiiMasker(ALL);
    const once = masker.mask("jane@example.com +39 06 1234 5678 4111 1111 1111 1111 DE89370400440532013000");
    expect(masker.mask(once)).toBe(once);
  });

  it("restores issued placeholders and passes others through", () => {
    const masker = createPiiMasker(ALL);
    masker.mask("I am Jane@Example.com");
    expect(masker.restore("Hello [EMAIL_1], not [EMAIL_2] or [PHONE_1] or [email_1]")).toBe(
      "Hello Jane@Example.com, not [EMAIL_2] or [PHONE_1] or [email_1]"
    );
  });

  it("never issues a placeholder the Visitor typed as text", () => {
    const masker = createPiiMasker(ALL);
    expect(masker.mask("I typed [EMAIL_1] and my address is jane@example.com")).toBe(
      "I typed [EMAIL_1] and my address is [EMAIL_2]"
    );
    expect(masker.restore("[EMAIL_1] is not [EMAIL_2]")).toBe("[EMAIL_1] is not jane@example.com");
  });

  it("reserves a literal from text seen before the value it would collide with", () => {
    const masker = createPiiMasker(ALL);
    masker.reserve("later: what does [EMAIL_1] mean?");
    masker.seed("first: jane@example.com", "visitor");
    expect(masker.mask("jane@example.com")).toBe("[EMAIL_2]");
  });

  it("numbers seeded values without counting them as sent", () => {
    const masker = createPiiMasker(ALL);
    masker.seed("history: old@example.com", "visitor");
    masker.seed("now: new@example.com", "visitor");
    expect(masker.report()).toEqual([]);
    expect(masker.mask("about new@example.com")).toBe("about [EMAIL_2]");
    expect(masker.report()).toEqual([{ detector: "email", origin: "visitor", count: 1 }]);
  });

  it("counts each value once, by detector and origin", () => {
    const masker = createPiiMasker(ALL);
    masker.seed("me: a@example.com", "visitor");
    masker.mask("a@example.com a@example.com b@example.com +39 06 1234 5678");
    expect(masker.report()).toEqual([
      { detector: "email", origin: "visitor", count: 1 },
      { detector: "email", origin: "other", count: 1 },
      { detector: "phone", origin: "other", count: 1 },
    ]);
  });

  it("lets a specific origin replace `other`, never the reverse", () => {
    const masker = createPiiMasker(ALL);
    masker.mask("instructions: a@example.com");
    masker.seed("visitor wrote a@example.com", "visitor");
    masker.mask("b@example.com", "visitor");
    masker.mask("b@example.com", "other");
    expect(masker.report()).toEqual([{ detector: "email", origin: "visitor", count: 2 }]);
  });
});

describe("restorer (streamed text)", () => {
  function stream(chunks: string[]): string {
    const masker = createPiiMasker(ALL);
    masker.mask("jane@example.com and +39 06 1234 5678");
    const restorer = masker.restorer();
    return chunks.map((chunk) => restorer.push(chunk)).join("") + restorer.end();
  }

  it("restores a placeholder split across chunks", () => {
    expect(stream(["Mail [EMA", "IL_1", "] or call [PHONE_", "1]."])).toBe(
      "Mail jane@example.com or call +39 06 1234 5678."
    );
  });

  it("holds a tag with an underscore of its own until it is whole", () => {
    const masker = createPiiMasker(ALL);
    masker.mask("CF RSSMRA85T10A562S");
    const restorer = masker.restorer();
    expect(restorer.push("It is [CODICE_")).toBe("It is ");
    expect(restorer.push("FISCALE_")).toBe("");
    expect(restorer.push("1].")).toBe("RSSMRA85T10A562S.");
  });

  it("holds back only what could still become a placeholder", () => {
    const masker = createPiiMasker(ALL);
    masker.mask("jane@example.com");
    const restorer = masker.restorer();
    expect(restorer.push("see [1] and [EM")).toBe("see [1] and ");
    expect(restorer.push("AIL_1]!")).toBe("jane@example.com!");
    expect(restorer.push("a [b")).toBe("a [b");
  });

  it("releases an unfinished bracket when the stream ends", () => {
    expect(stream(["array[EMAIL_"])).toBe("array[EMAIL_");
  });

  it("keeps a placeholder it did not issue", () => {
    expect(stream(["[EMAIL_", "7] stays"])).toBe("[EMAIL_7] stays");
  });
});

describe("piiMaskingSummary", () => {
  it("reads as a count per detector, in detector order", () => {
    expect(
      piiMaskingSummary([
        { detector: "phone", origin: "other", count: 1 },
        { detector: "email", origin: "visitor", count: 1 },
        { detector: "email", origin: "other", count: 1 },
      ])
    ).toBe("2 email addresses, 1 phone number");
  });
});

describe("piiMaskingOrigins", () => {
  it("reads as counts per origin, Visitor first", () => {
    expect(
      piiMaskingOrigins([
        { detector: "email", origin: "visitor", count: 1 },
        { detector: "phone", origin: "tool", count: 2 },
        { detector: "email", origin: "knowledge", count: 1 },
        { detector: "iban", origin: "knowledge", count: 1 },
      ])
    ).toBe(
      "From the Visitor: 1 email address. From knowledge: 1 email address, 1 IBAN. From tool results: 2 phone numbers."
    );
  });
});

describe("transcriptPiiMasker (#1080)", () => {
  const transcript = [
    { role: "user" as const, text: "I am jane@example.com, card 4111 1111 1111 1111" },
    { role: "assistant" as const, text: "Thanks. Our desk is help@example.org." },
    { role: "user" as const, text: "And my IBAN is DE89370400440532013000; what is [EMAIL_1]?" },
  ];
  const probe = "help@example.org jane@example.com DE89370400440532013000 4111111111111111";

  it("is deterministic: the same messages in the same order give the same placeholders", () => {
    const first = transcriptPiiMasker(ALL, transcript).mask(probe);
    const second = transcriptPiiMasker(ALL, structuredClone(transcript)).mask(probe);
    expect(first).toBe(second);
    // The typed "[EMAIL_1]" is reserved, so the real addresses start at 2.
    expect(first).toBe("[EMAIL_3] [EMAIL_2] [IBAN_1] [CARD_1]");
  });

  it("depends on the order, and only on the order", () => {
    const reversed = transcriptPiiMasker(ALL, [...transcript].reverse()).mask(probe);
    expect(reversed).not.toBe(transcriptPiiMasker(ALL, transcript).mask(probe));
  });

  it("can describe what it restores instead, keeping only what knowledge already holds", () => {
    const masker = transcriptPiiMasker(ALL, transcript, { restore: "descriptions" });
    masker.seed("Policy: write to refunds@example.org", "knowledge");
    const masked = masker.mask("jane@example.com, refunds@example.org, DE89370400440532013000");
    expect(masker.restore(masked)).toBe("your email address, refunds@example.org, your IBAN");
    const restorer = masker.restorer();
    expect(restorer.push(masked.slice(0, 5)) + restorer.push(masked.slice(5)) + restorer.end()).toBe(
      "your email address, refunds@example.org, your IBAN"
    );
  });

  it("restores a value the Visitor typed once knowledge turns out to hold it too", () => {
    const masker = transcriptPiiMasker(ALL, [{ role: "user", text: "Is help@example.org right?" }], {
      restore: "descriptions",
    });
    expect(masker.restore(masker.mask("help@example.org"))).toBe("your email address");
    masker.seed("Desk: help@example.org", "knowledge");
    expect(masker.restore("[EMAIL_1]")).toBe("help@example.org");
    // Still counted as the Visitor's: they said it first.
    expect(masker.report()).toEqual([{ detector: "email", origin: "visitor", count: 1 }]);
  });
});
