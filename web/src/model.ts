// Record shapes from data/companies.jsonl (see lib/companies.js, lib/postings.js, lib/newQueue.js).
export type Note = { at: string; text: string };
export type Check = { label?: string; mark: string; value?: string; note?: string };
export type Verdict = { verdict?: string; checks?: Check[]; [k: string]: unknown };

export type Stance = '' | 'Watching' | 'Dormant' | 'To review' | 'Ruled out';
export type Outcome = 'applied' | 'rejected' | 'passed' | 'no response';

export type JobEntry = { kitStartedAt?: string; // applying: when the kit run was dispatched
    state: 'saved' | 'applying' | 'skipped'; role: string; leadKey: string; url?: string; at: string; seenGone?: string; note?: string;
    reasons?: { state: 'saved' | 'applying' | 'skipped'; reason: string; at: string }[];
    fromSaved?: string; // the day a saved job was skipped; Passed offers it back
    // Jobs the owner added by hand: what the search knew of it then (set by the server).
    coverage?: 'unseen' | 'unjudged' | 'filtered' | 'passed' | 'lead' };

export type Application = {
    id: string;
    postingId?: string;
    leadKey?: string;
    role: string;
    url?: string;
    appliedOn: string;
    approx?: boolean;
    outcome: Outcome;
    outcomeOn?: string;
    stage?: 'screening' | 'interviewing' | 'offer';
    stageOn?: string;
    next?: { text: string; on?: string };
    sendTo?: string;
    reason?: string;
    seenGone?: string;
};

// One row of data/postings.jsonl (lib/postingsFile.js blankPosting, plus what the posting check adds).
export type Posting = {
    id: string;
    companyKey: string;
    leadKey: string;
    role: string;
    url: string;
    pay: string;
    payEstimate?: unknown;
    modelSays: 'lead' | 'pass' | ''; // '' = found by the board sweep, no verdict yet
    wasLead: boolean;
    verdicts: Record<string, string>;
    disputed?: boolean; // runs before 2026-11-20
    location?: string; // from the board sweep
    fit?: number; // 1-5, the model's fit score (runs from 2026-11-20 on)
    filteredBy?: number; // the sweep filter version that passed on it (data/sweep-filter.json)
    filterReason?: string;
    triage?: { by: string; at: string; keep: boolean; fit?: number; reason: string }; // title triage (lib/triage.js); a drop is a pass shown with Filtered
    firstRun: string;
    lastRun: string;
    runs?: string[];
    posted: 'yes' | 'no' | 'unknown';
    postedCheckedAt: string;
    goneAt?: string;
    source: string;
    claude?: Verdict | null;
    codex?: Verdict | null;
    assessment?: unknown;
    questions?: string[];
    rescore?: { at: string; by: string; fitFrom: number | null; fitTo: number | null; fingerprintFrom?: number | null; fingerprintTo?: number | null; why: string };
};

// A saved job as New groups it (lib/newQueue.js savedGroups).
export type SavedRole = { postingId: string; role: string; fit: number | null; move: 'up' | 'down' | null; gone: boolean; flagged: boolean; hasPosting: boolean; postingRowId: string | null };
export type SavedGroup = { company: string; key: string; best: number | null; roles: SavedRole[] };

// A fact the owner supplied outside master-resume.md (lib/supplement.js).
export type SupplementEntry = { id: string; text: string; question?: string; kit?: string; at: string; status: 'open' | 'merging' | 'merged' | 'dismissed'; section?: string; error?: string };

export type HistoryLine = { companyKey: string; heading: string; text: string };
export type KitMeta = { company?: string; role?: string; url?: string; pieces?: string; drafter?: string; postingId?: string };

export type Event = { date: string; run?: string; text: string };

export type Proposal = { id: string; by: string; at: string; text: string; base: Record<string, unknown>; changes: Record<string, unknown> };


// One row of data/companies.jsonl (lib/companies.js blankCompany).
export type Company = {
    key: string;
    name: string;
    fillRequested?: string;
    sweepOff?: boolean;
    aliases: string[];
    distinctFrom: string[];
    stance: Stance;
    stanceBy?: string; // the model that set the stance; absent once the owner sets one
    newFromRun?: boolean;
    verdict: string;
    passedSeen?: string; // the verdict the owner marked read on the Passed page
    fingerprint: string;
    domain: string;
    awards: string;
    reason: string;
    recheckTrigger: string;
    website: string;
    size: string;
    founded?: string; // year founded; records from before this field have none
    careersUrl?: string;
    jobsUrl?: string;
    funding: string;
    stability?: string; // labeled instability signals; older records have none
    culture?: string; // labeled culture evidence (Glassdoor etc.); older records have none
    facts: string;
    note?: string; // the owner's note, old form
    notes?: Note[]; // the owner's dated notes, oldest first
    jobNotes?: Record<string, string | Note[]>; // the owner's notes by posting id
    flag?: { at: string }; // flagged to come back to
    jobFlags?: Record<string, { at: string; role: string; leadKey: string; url?: string }>;
    lastChecked: string;
    rolesSkipped: string[];
    jobs: Record<string, JobEntry>;
    applications: Application[];
    proposals: Proposal[];
    ruleOutSuggested?: { by: string; reason: string }; // a model suggests ruling it out; the owner confirms on Passed
    events: Event[];
    possibleDuplicateOf?: string;
};

// A row of the Jobs list (lib/newQueue.js jobsList).
export type Job = { posting: Posting; company: Company; entry?: JobEntry };

export type NewItem = {
    kind: 'flagged' | 'applying' | 'lead' | 'unjudged' | 'duplicate' | 'gone' | 'proposal';
    about: 'job' | 'company' | 'both';
    company: string;
    postingId?: string;
    proposalId?: string;
    at?: string; // flagged items: when
};

// A finished run (runs/<run>/report.json). Rows are what the models returned, trimmed by lib/readModelOutput.js.
export type RunLead = { key: string; company: string; role: string; url?: string; pay?: string; foundBy: string; disputed?: boolean; claude?: Verdict | null; codex?: Verdict | null; opinions?: Record<string, Verdict | null>; reviewed?: boolean; questions?: string[]; overview?: string };
export type RunChange = { company: string; before?: Record<string, string> | null; after?: Record<string, string>; fields?: string[] | Record<string, { from: string; to: string }>; by?: string; reason?: string; kept?: boolean };
// One searcher's outcome in a run: ok, failed, auth or limit, with why when it didn't finish ok.
export type ModelRun = { status?: string; reason?: string; review?: string };
export type Report = { workflow: string; topic?: string; models?: Record<string, ModelRun>; reviewers?: string[]; finishedAt: string; ghUrl?: string; durationMs?: number; leads: RunLead[]; nearMisses: RunLead[]; changes: RunChange[]; held?: RunChange[]; refused: RunChange[] };
export type RunSummary = { run: string; workflow?: string; topic?: string; finishedAt?: string; ghUrl?: string; models?: Record<string, ModelRun>; reviewers?: string[]; durationMs?: number; counts?: { leads?: number; nearMisses?: number; changes?: number } };
export type Unfiled = { heading: string; text: string };
