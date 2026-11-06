-- The Teammate "Capability Ceiling" becomes the Action Ceiling (map #1164,
-- ADR-0028): a Capability is now one thing a Member's Role allows, and the
-- ceiling caps the *tier* of the actions a Teammate's grants reach, which is a
-- different thing. Same values, same default, same check.
--
-- One deploy window: code that still reads capability_ceiling sees no value,
-- which `ceilingAllowsCapability` refuses, so a Teammate briefly has no
-- actions rather than more of them.

alter table public.teammates rename column capability_ceiling to action_ceiling;
alter table public.teammates rename constraint teammates_capability_ceiling_check to teammates_action_ceiling_check;
