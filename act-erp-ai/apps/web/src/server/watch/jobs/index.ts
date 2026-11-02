import type { RuleJob } from "../context";
import { CORE_JOBS } from "./core";
import { CONTRACT_JOBS, TIME_JOBS } from "./time";

export const ALL_JOBS: RuleJob[] = [...CORE_JOBS, ...TIME_JOBS, ...CONTRACT_JOBS];
