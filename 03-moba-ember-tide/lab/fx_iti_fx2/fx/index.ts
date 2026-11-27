import type { Demo } from "../api";
import { r } from "./iti_r";
import { q } from "./iti_q";
import { passive } from "./iti_passive";

export const DEMOS: Record<string, Demo> = { r, q, passive };
