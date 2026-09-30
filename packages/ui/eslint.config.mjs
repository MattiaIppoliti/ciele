import config from "@agent-hub/eslint-config";
import { designTokenRules } from "@agent-hub/eslint-config/design-tokens";

export default [...config, ...designTokenRules({ files: ["src/**/*.{ts,tsx}"] })];
