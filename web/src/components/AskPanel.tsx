import { Fold } from './ui';
import { OpenAction } from './OpenAction';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ASK } from '../actions';
import { useWorking } from '../data';
import { RichText } from '../text';
import { useToast } from '../toast';
import { useModels } from '../models';

type Message = { by: string; text: string; failed?: boolean };

async function getThread(company: string): Promise<Message[]> {
    const res = await fetch(`/api/thread?company=${encodeURIComponent(company)}`);
    if (!res.ok) throw new Error(`Couldn't load the conversation (${res.status}).`);
    return (await res.json()).messages;
}

// The per-company conversation: thread, proposals, and the Ask button. `open` drops the fold (the job pane's Ask tab holds nothing else).
export function AskPanel({ company, open }: { company: string; open?: boolean }) {
    const toast = useToast();
    const client = useQueryClient();
    const [messages, setMessages] = useState<Message[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    const asking = useWorking(company).some((l) => l.startsWith('Answering a question'));
    const { label } = useModels();
    const count = useRef<number | null>(null); // null until the thread has loaded
    count.current = messages ? messages.length : null;

    const refresh = useCallback(async () => {
        try { setMessages(await getThread(company)); setError(null); } catch (e) { setError((e as Error).message); }
    }, [company]);
    const was = useRef(false);
    useEffect(() => { was.current = false; setMessages(null); setError(null); refresh(); }, [refresh]);

    // The ask run ends: re-fetch, and say so only when an answer actually arrived.
    useEffect(() => {
        let live = true; // company changed (or unmounted) while the fetch was in flight: drop its result
        if (was.current && !asking) {
            const before = count.current;
            getThread(company).then((t) => {
                if (!live) return;
                setMessages(t);
                setError(null);
                if (before !== null && t.length > before) { toast(`Answer in for ${company}.`); client.invalidateQueries({ queryKey: ['companies'] }); }
            }).catch(() => {});
        }
        was.current = asking;
        return () => { live = false; };
    }, [asking, company, toast, client]);

    const body = (
        <>
            <div className="thread">
                {error ? <p className="meta">{error}</p>
                    : !messages ? <p className="meta">Loading…</p>
                        : !messages.length ? <p className="meta">No questions about {company} yet. Ask one below.</p>
                            : messages.map((m, i) => (
                                <div key={i} className={`msg msg-${m.by}${m.failed ? ' msg-failed' : ''}`}>
                                    <p className={`msg-by${m.by === 'owner' ? '' : ` mark ${m.by}`}`}>{label(m.by)}</p>
                                    <p className="msg-text"><RichText text={m.text} /></p>
                                </div>
                            ))}
            </div>
            <OpenAction def={ASK} ctx={{ company }} className="primary">Ask a question</OpenAction>
        </>
    );
    if (open) return <section className="ask" aria-label={`Questions about ${company}`}>{body}</section>;
    return <Fold className="ask" heading="h3" label={`Questions about ${company}`} title={`Conversation${messages?.length ? ` (${messages.length})` : ''}`}>{body}</Fold>;
}
