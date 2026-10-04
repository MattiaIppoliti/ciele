import { z } from "zod";

const harnessSchema = z
  .object({
    id: z
      .string()
      .regex(/^[a-zA-Z0-9_-]{1,80}$/)
      .refine((id) => id !== "ciele", "The ciele harness ID is reserved"),
    name: z.string().min(1).max(120),
    organizationId: z.string().min(1),
    url: z.string().url(),
    tokenEnv: z
      .string()
      .regex(/^[A-Z][A-Z0-9_]*$/)
      .optional(),
  })
  .strict();

/** Operator-provisioned destinations. A persona, client or model cannot add an endpoint. */
export function registeredHarnesses(organizationId: string) {
  const raw: unknown = JSON.parse(process.env.CIELE_AG_UI_HARNESSES || "[]");
  const entries = z.array(harnessSchema).max(100).parse(raw);
  if (new Set(entries.map((entry) => entry.id)).size !== entries.length) {
    throw new Error("Harness connection IDs must be unique");
  }
  return entries.filter((entry) => entry.organizationId === organizationId);
}

export function computerConfiguration() {
  const url = process.env.CIELE_COMPUTER_SUPERVISOR_URL?.trim();
  const supervisorToken = process.env.CIELE_COMPUTER_SUPERVISOR_TOKEN?.trim();
  const masterToken = process.env.CIELE_COMPUTER_TOKEN?.trim();
  const namespace = process.env.CIELE_COMPUTER_NAMESPACE?.trim() || "ciele";
  if (!url || !supervisorToken || !masterToken) return null;
  if (
    supervisorToken.length < 24 ||
    masterToken.length < 24 ||
    supervisorToken === masterToken
  ) {
    throw new Error(
      "Computer services require two distinct secrets of at least 24 characters",
    );
  }
  const origin = new URL(url);
  if (
    !/^https?:$/.test(origin.protocol) ||
    origin.username ||
    origin.password ||
    origin.pathname !== "/" ||
    origin.search ||
    origin.hash
  ) {
    throw new Error("Invalid computer supervisor origin");
  }
  if (!/^[a-z][a-z0-9-]{0,12}$/.test(namespace))
    throw new Error(
      "Computer namespaces must be DNS labels of at most 13 characters",
    );
  return { url: origin.origin, supervisorToken, masterToken, namespace };
}

/** Safe setup metadata for the console; credentials and origins stay server-side. */
export function teammateExecutionOptions(organizationId: string) {
  return {
    computerConfigured: computerConfiguration() !== null,
    harnesses: registeredHarnesses(organizationId).map(({ id, name }) => ({
      id,
      name,
    })),
  };
}
