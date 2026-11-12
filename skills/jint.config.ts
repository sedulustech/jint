import { rules as descriptionRules } from "./descriptions.ts";
import { rules as conceptRules } from "./rules.ts";

// The concept rules read the one skill they guard; the description rules read every skill. Which
// file each reads is set here, not in the rules.
export default {
  rules: {
    use: [
      ...conceptRules.map((rule) => ({ ...rule, include: ["skills/writing-rules/SKILL.md"] })),
      ...descriptionRules.map((rule) => ({ ...rule, include: ["skills/*/SKILL.md"] })),
    ],
  },
};
