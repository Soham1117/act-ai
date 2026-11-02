import type { RuleJob } from "../context";
import { CORE_JOBS } from "./core";
import { HR_JOBS } from "./hr";
import { PAYROLL_JOBS } from "./payroll";
import { CONTRACT_JOBS, TIME_JOBS } from "./time";

export const ALL_JOBS: RuleJob[] = [...CORE_JOBS, ...TIME_JOBS, ...CONTRACT_JOBS, ...PAYROLL_JOBS, ...HR_JOBS];
