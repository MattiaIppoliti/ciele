import { describeDbContract } from "../db-contract.suite";
import { createSupabaseContractContext } from "./supabase-contract-harness";

/**
 * ADR-0016 stage 2: the SAME contract expectations the mock passes, run over
 * the real `createSupabaseDb` adapter, real migrations in PGlite, a
 * PostgREST shim in place of the network. This is what turns
 * `describeDbContract` from a mock spec into an actual contract.
 */
describeDbContract("supabase (pglite)", createSupabaseContractContext);
