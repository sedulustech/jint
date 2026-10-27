/** The protocol adapters by name. `systemone` has none: the vendor SDK speaks it natively. */

import { decisionModel } from "./decision-model.ts";
import { decisions } from "./decisions.ts";
import type { Protocol } from "./protocol.ts";
import type { ProtocolName } from "./providers.ts";

export const ADAPTERS: Partial<Record<ProtocolName, Protocol>> = {
  decisions,
  "decision-model": decisionModel,
};
