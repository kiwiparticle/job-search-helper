#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import { lookup } from 'node:dns/promises';
import { prepareRun } from '../lib/run.js';
import { fromEnv } from './d1rest.js';

const [runDir, workflow, runDate = new Date().toISOString().slice(0, 10)] = process.argv.slice(2);
if (!runDir || !workflow) { console.error('usage: prepare.js <runDir> <workflow> [runDate]'); process.exit(2); }
if (!process.env.EXECUTION_ID) throw new Error('EXECUTION_ID is required');
await prepareRun(fromEnv(), fileURLToPath(new URL('..', import.meta.url)), runDir, workflow, runDate, undefined, { executionId: process.env.EXECUTION_ID, retry: Number(process.env.GITHUB_RUN_ATTEMPT ?? 1) > 1, fetchImpl: fetch, lookup, topic: process.env.TOPIC ?? '', sweepRoles: Number(process.env.SWEEP_ROLES) || undefined, job: { company: process.env.JOB_COMPANY ?? '', role: process.env.JOB_ROLE ?? '', url: process.env.JOB_URL ?? '' } });
