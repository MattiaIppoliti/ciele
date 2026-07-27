import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type { ClientRequest, IncomingMessage } from "node:http";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { requestMock } = vi.hoisted(() => ({ requestMock: vi.fn() }));
vi.mock("node:http", () => ({ request: requestMock }));
vi.mock("node:https", () => ({ request: requestMock }));

import { fetchPinnedPage } from "./pinned-fetch";

describe("fetchPinnedPage", () => {
  beforeEach(() => requestMock.mockReset());

  it("keeps validated address fallbacks while preserving the hostname for TLS", async () => {
    const responseStream = new PassThrough();
    const response = responseStream as unknown as IncomingMessage;
    response.statusCode = 200;
    response.headers = { "content-type": "text/html" };
    const request = new EventEmitter() as ClientRequest;
    request.setTimeout = vi.fn() as never;
    request.destroy = vi.fn() as never;
    request.end = vi.fn(() => {
      return request;
    }) as never;
    requestMock.mockReturnValue(request);

    const resultPromise = fetchPinnedPage(
      {
        url: new URL("https://public.example/docs"),
        addresses: [
          "2606:2800:220:1:248:1893:25c8:1946",
          "93.184.216.34",
        ],
      },
      15_000,
      { accept: "text/html" }
    );

    const call = requestMock.mock.calls[0] as unknown[];
    const responseCallback = call.find(
      (argument) => typeof argument === "function"
    ) as (response: IncomingMessage) => void;
    responseCallback(response);
    responseStream.end("<html><body>Public</body></html>");
    const result = await resultPromise;

    const options = call[1] as {
      lookup: (
        hostname: string,
        options: object,
        callback: (
          error: Error | null,
          addresses: Array<{ address: string; family: number }>
        ) => void
      ) => void;
      servername: string;
      autoSelectFamily: boolean;
    };
    const lookupCallback = vi.fn();
    options.lookup("public.example", { all: true }, lookupCallback);

    expect(lookupCallback).toHaveBeenCalledWith(
      null,
      [
        { address: "2606:2800:220:1:248:1893:25c8:1946", family: 6 },
        { address: "93.184.216.34", family: 4 },
      ]
    );
    expect(options.autoSelectFamily).toBe(true);
    expect(options.servername).toBe("public.example");
    expect(result.text).toContain("Public");
  });
});
