/**
 * The protocol adapters by name. `systemone` has none, and `decisions` is called through its own
 * client (decisions.ts): the vendor SDK speaks it natively.
 */

import { decisionModel } from "./decision-model.ts";
import type { Protocol } from "./protocol.ts";
import type { ProtocolName } from "./providers.ts";

export const ADAPTERS: Partial<Record<ProtocolName, Protocol>> = {
  "decision-model": decisionModel,
};
