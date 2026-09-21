import { EXIT } from "../index.ts";
import { table } from "../output.ts";
import { str, usage as usageLine, type CommandContext } from "./shared.ts";

/**
 * `ciele usage …` (#853): the plan's meters, and who spent the window's
 * credits. Read-only; buying a top-up pack is deliberately not here, because a
 * purchase belongs to a surface where a person confirms an amount.
 */
export async function usage(verb: string | undefined, ctx: CommandContext): Promise<number> {
  const { client, flags, emit, deps } = ctx;
  switch (verb) {
    case "meters": {
      const { data } = (await client.usage.meters()) as {
        data: {
          metered: boolean;
          plan: string | null;
          topupCredits?: number | null;
          meters: {
            resource: string;
            window: { name: string; from: string; to: string };
            cap: number | null;
            usedCredits: number;
          }[];
        };
      };
      if (!data.metered) {
        // Saying so beats printing an empty table: a self-hosted deployment is
        // uncapped, which is a different fact from having used nothing.
        emit("This deployment is unmetered: no plan, no caps.", data);
        return EXIT.ok;
      }
      emit(
        table(
          data.meters.map((meter) => ({
            resource: meter.resource,
            window: meter.window.name,
            used: Math.round(meter.usedCredits).toString(),
            cap: meter.cap === null ? "no limit" : Math.round(meter.cap).toString(),
            resets: meter.window.to,
          })),
          [
            { key: "resource", header: "Resource" },
            { key: "window", header: "Window" },
            { key: "used", header: "Used" },
            { key: "cap", header: "Included" },
            { key: "resets", header: "Resets" },
          ]
        ),
        data
      );
      return EXIT.ok;
    }
    case "spenders": {
      const { data } = (await client.usage.spenders({
        from: str(flags.from),
        to: str(flags.to),
      })) as {
        data: {
          from: string;
          to: string;
          dimensions: {
            dimension: string;
            spenders: { id: string | null; credits: number; calls: number }[];
          }[];
        };
      };
      const rows = data.dimensions.flatMap((entry) =>
        entry.spenders.map((spender) => ({
          dimension: entry.dimension,
          // A turn names both a Teammate and the Member who asked, so the same
          // credit appears under two dimensions. Printing the dimension on
          // every row is what stops a reader adding the column up.
          id: spender.id ?? "(unattributed)",
          credits: Math.round(spender.credits).toString(),
          calls: spender.calls.toString(),
        }))
      );
      emit(
        table(rows, [
          { key: "dimension", header: "Kind" },
          { key: "id", header: "Spender" },
          { key: "credits", header: "Credits" },
          { key: "calls", header: "Calls" },
        ]),
        data
      );
      return EXIT.ok;
    }
    default:
      return usageLine(deps, "usage meters|spenders");
  }
}
