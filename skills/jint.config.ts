import { rules } from "./rules.ts";

// The concept rules read the one skill they guard; which file each reads is set here, not in the rules.
export default {
  rules: {
    use: rules.map((rule) => ({ ...rule, include: ["skills/writing-rules/SKILL.md"] })),
  },
};
