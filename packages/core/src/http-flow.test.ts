import { describe, expect, it } from "vitest";
import type { Flow, RespondSettings } from "./types";
import {
  DEFAULT_HTTP_FLOW_METHODS,
  HTTP_FLOW_ACTIONS,
  flowTriggerKind,
  httpFlowMethods,
  httpFlowRequestVariables,
  isHttpTrigger,
  jsonBodyPaths,
  respondHeaders,
  respondSettingsIssue,
  respondStatus,
} from "./http-flow";
import { actionAllowedForTrigger, isProactiveTrigger } from "./engine";

/**
 * The inbound-HTTP trigger (#843). A Flow with a caller waiting on a status
 * code is neither a Visitor's message nor a widget event, and these pin the
 * three ways that difference shows: which actions it may run, what it can read
 * about the request, and what it is allowed to answer.
 */

const flow = (over: Partial<Flow> = {}): Flow =>
  ({
    id: "f1",
    assistantId: "a1",
    name: "Order status",
    trigger: "http_request",
    triggerSettings: {},
    enabled: true,
    isDefault: false,
    position: 0,
    actions: [],
    actionSettings: {},
    conditions: [],
    conditionLogic: "all",
    ...over,
  }) as Flow;

describe("the three kinds of trigger", () => {
  it("separates an inbound request from a widget event", () => {
    expect(flowTriggerKind("message")).toBe("message");
    expect(flowTriggerKind("page_load")).toBe("proactive");
    expect(flowTriggerKind("time_on_page")).toBe("proactive");
    expect(flowTriggerKind("chat_open")).toBe("proactive");
    expect(flowTriggerKind("http_request")).toBe("http");
    expect(isHttpTrigger("http_request")).toBe(true);
    expect(isHttpTrigger("chat_open")).toBe(false);
  });

  it("keeps 'proactive' meaning a widget event, not merely 'not a message'", () => {
    // The old rule was `trigger !== "message"`, which would have swept the
    // inbound trigger into the notification-only funnel.
    expect(isProactiveTrigger("http_request")).toBe(false);
    expect(isProactiveTrigger("page_load")).toBe(true);
    expect(isProactiveTrigger("message")).toBe(false);
  });
});

describe("what an inbound Flow may run", () => {
  it("offers the actions that make sense with no chat window", () => {
    for (const action of HTTP_FLOW_ACTIONS) {
      expect(actionAllowedForTrigger(action, "http_request")).toBe(true);
    }
  });

  it("refuses the ones that need somewhere to render", () => {
    // There is no widget, so a Message, a Follow-up chip or a Notification
    // would be written to nobody.
    for (const action of [
      "custom_message",
      "follow_up_questions",
      "notification",
      "show_button",
      "iframe",
      "search_knowledge",
      "basic_reply",
      "handover",
      "suggest_help_desk",
    ] as const) {
      expect(actionAllowedForTrigger(action, "http_request")).toBe(false);
    }
  });

  it("refuses the two gates, which have no Conversation to resume into", () => {
    // Both stop a turn and continue it later from a Conversation. An inbound
    // run has none, so offering either would offer a step that halts the Flow
    // and answers 204 to a caller holding a socket.
    expect(actionAllowedForTrigger("human_review", "http_request")).toBe(false);
    expect(actionAllowedForTrigger("http_webhook", "http_request")).toBe(false);
    // They stay available where there *is* a Conversation.
    expect(actionAllowedForTrigger("human_review", "message")).toBe(true);
    expect(actionAllowedForTrigger("http_webhook", "message")).toBe(true);
  });

  it("keeps Response out of every other trigger", () => {
    // Nothing is waiting on a status code in a chat.
    expect(actionAllowedForTrigger("respond", "message")).toBe(false);
    expect(actionAllowedForTrigger("respond", "page_load")).toBe(false);
    expect(actionAllowedForTrigger("respond", "http_request")).toBe(true);
  });

  it("leaves the message and proactive rules exactly as they were", () => {
    expect(actionAllowedForTrigger("notification", "page_load")).toBe(true);
    expect(actionAllowedForTrigger("search_knowledge", "page_load")).toBe(false);
    expect(actionAllowedForTrigger("notification", "message")).toBe(false);
    expect(actionAllowedForTrigger("search_knowledge", "message")).toBe(true);
  });
});

describe("which methods the endpoint accepts", () => {
  it("defaults to POST and keeps only methods this build serves", () => {
    expect(httpFlowMethods(flow())).toEqual(DEFAULT_HTTP_FLOW_METHODS);
    expect(httpFlowMethods(flow({ triggerSettings: { httpRequest: { methods: [] } } }))).toEqual(
      DEFAULT_HTTP_FLOW_METHODS
    );
    expect(
      httpFlowMethods(flow({ triggerSettings: { httpRequest: { methods: ["GET", "PUT"] } } }))
    ).toEqual(["GET", "PUT"]);
  });

  it("is the gate the route asks, so an unlisted method never runs the Flow", () => {
    const only = flow({ triggerSettings: { httpRequest: { methods: ["POST"] } } });
    expect(httpFlowMethods(only).includes("DELETE")).toBe(false);
  });
});

describe("what the Flow can read about the request", () => {
  it("offers the body, the query and the method as template variables", () => {
    const vars = httpFlowRequestVariables({
      method: "POST",
      body: '{"orderId":"A-1"}',
      query: { ref: "abc" },
      headers: { "x-source": "erp" },
    });
    expect(vars["request.method"]).toBe("POST");
    expect(vars["request.body"]).toBe('{"orderId":"A-1"}');
    expect(vars["request.query.ref"]).toBe("abc");
    expect(vars["request.header.x-source"]).toBe("erp");
  });

  it("offers a JSON body by path, so {{request.body.orderId}} reads like {{user.name}}", () => {
    const vars = httpFlowRequestVariables({
      method: "POST",
      body: '{"orderId":"A-1","customer":{"email":"ada@example.com","tags":["vip","eu"]},"count":2,"paid":false}',
      query: {},
      headers: {},
    });
    expect(vars["request.body.orderId"]).toBe("A-1");
    expect(vars["request.body.customer.email"]).toBe("ada@example.com");
    expect(vars["request.body.customer.tags.0"]).toBe("vip");
    expect(vars["request.body.count"]).toBe("2");
    expect(vars["request.body.paid"]).toBe("false");
    // The whole text stays available: a Flow may still hand it on verbatim.
    expect(vars["request.body"]).toContain('"orderId"');
  });

  it("has no paths for a body that is not a JSON object, and bounds a deep one", () => {
    expect(jsonBodyPaths("plain text")).toEqual({});
    expect(jsonBodyPaths('"a string"')).toEqual({});
    expect(jsonBodyPaths("42")).toEqual({});
    const deep = JSON.stringify({ a: { b: { c: { d: { e: "too deep" } } } }, top: "kept" });
    const paths = jsonBodyPaths(deep);
    expect(paths.top).toBe("kept");
    expect(paths["a.b.c.d.e"]).toBeUndefined();
    // A key that could not be a template token is skipped, never written oddly.
    expect(jsonBodyPaths('{"with space":"x","ok_key":"y"}')).toEqual({ ok_key: "y" });
  });

  it("lower-cases header names, so a caller's capitalisation does not matter", () => {
    const vars = httpFlowRequestVariables({
      method: "GET",
      body: "",
      query: {},
      headers: { "X-Source": "erp" },
    });
    expect(vars["request.header.x-source"]).toBe("erp");
  });

  it("never exposes the credential the caller authenticated with", () => {
    // The Authorization header is the perimeter; a Flow that could echo it
    // into an outbound API request would leak the org's own key.
    const vars = httpFlowRequestVariables({
      method: "POST",
      body: "",
      query: {},
      headers: { authorization: "Bearer sk-live-secret", cookie: "session=abc" },
    });
    expect(vars["request.header.authorization"]).toBeUndefined();
    expect(vars["request.header.cookie"]).toBeUndefined();
    expect(JSON.stringify(vars)).not.toContain("sk-live-secret");
  });
});

describe("the Response action", () => {
  it("sends the configured status and has no opinion when there is none", () => {
    expect(respondStatus({ status: 201 })).toBe(201);
    expect(respondStatus({ status: 404 })).toBe(404);
    // Missing, out of range, or not a number: null, so the caller decides how
    // to answer a Flow that never said, rather than a default inventing a 200.
    expect(respondStatus({})).toBeNull();
    expect(respondStatus({ status: 600 })).toBeNull();
    expect(respondStatus({ status: Number.NaN })).toBeNull();
    // 1xx is not a final answer and the platform Response constructor throws
    // on it, which would turn a Flow that ran into an unconfigured 500.
    expect(respondStatus({ status: 101 })).toBeNull();
    expect(respondStatus({ status: 99 })).toBeNull();
  });

  it("is configured only once it has a status the route can send", () => {
    expect(respondSettingsIssue({})).toMatch(/status code/i);
    expect(respondSettingsIssue({ status: 150 })).toMatch(/status code/i);
    expect(respondSettingsIssue({ status: 204 })).toBeNull();
  });

  it("strips line breaks from a resolved header value, so a body cannot end the header", () => {
    const headers = respondHeaders(
      { status: 200, headers: [{ id: "h1", name: "X-Echo", value: "{{request.body}}" }] },
      () => "done\r\nSet-Cookie: session=stolen"
    );
    expect(headers["x-echo"]).toBe("doneSet-Cookie: session=stolen");
  });

  it("refuses a header a route must own", () => {
    // Content-Length written by hand desynchronises from the body; hop-by-hop
    // headers are the server's to decide.
    const forbidden: RespondSettings = {
      status: 200,
      headers: [{ id: "h1", name: "content-length", value: "12" }],
    };
    expect(respondSettingsIssue(forbidden)).toMatch(/content-length/i);
    expect(
      respondSettingsIssue({
        status: 200,
        headers: [{ id: "h1", name: "x-order-state", value: "done" }],
      })
    ).toBeNull();
  });
});
