import { companyKey } from './keys.js';

export const threadPath = (company) => `asks/${companyKey(company)}.json`;

export const contextMessages = (thread) => (thread?.messages ?? []).slice(-20);

const FAILED = {
    limit: 'Didn\'t answer: hit its subscription usage limit. Ask again after it resets.',
    auth: 'Didn\'t answer: its login expired. Log in again on your PC, then ask again.',
    failed: 'Didn\'t answer: the job failed. Ask again, or check it on GitHub.',
};

// One model's reply: text only. Its proposal (if any) lives on the company record in D1, not in the thread.
function buildReply({ model, answer, status = 'ok' }, at) {
    const reply = { by: model, at };
    if (answer?.trim()) {
        reply.text = answer.trim();
    } else {
        reply.text = FAILED[status] ?? FAILED.failed;
        reply.failed = true;
    }
    return reply;
}

// Adds one question and each model's reply to it. A message already there with the same author and `at`
// is skipped, so redoing a finish never doubles it.
export function appendAskMany(thread, { question, replies, at }) {
    const have = new Set(thread.messages.map((m) => `${m.by}|${m.at}`));
    const messages = [{ by: 'owner', text: question, at }, ...replies.map((r) => buildReply(r, at))].filter((m) => !have.has(`${m.by}|${m.at}`));
    return { ...thread, messages: [...thread.messages, ...messages] };
}
