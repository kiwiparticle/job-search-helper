import { Toggle } from '@base-ui/react/toggle';
import { Link, useNavigate } from 'react-router';
import { safeHref } from '../../../lib/safe.js';
import { nowPass } from '../../../lib/newQueue.js';
import { activeApplication, applicationFor, hasActiveLead, jobEntry, pastOutcomes } from '../../../lib/tags.js';
import type { Company, KitMeta, Posting } from '../model';
import { ExtLink, RichText } from '../text';
import { fingerprintScore } from '../format';
import { Tip } from './ui';

const LABEL = { job: 'Job', company: 'Company', both: 'Job + company' };

export const Kind = ({ about }: { about: 'job' | 'company' | 'both' }) => <span className={`kind ${about}`}>{LABEL[about]}</span>;

// A model fact marked "unverified" shows underlined, with a tip saying so. A clean "(unverified)" or a trailing
// ", unverified" is dropped from the text; any other wording stays whole so the sentence never reads cut off.
export function FactText({ text }: { text: string }) {
    if (!/unverified/i.test(text)) return <span><RichText text={text} /></span>;
    const short = text.replace(/\s*\(unverified\)|\s*[,;]\s*unverified\s*$/gi, '').trim();
    return <Tip text="Unverified"><span className="unverified" tabIndex={0}><RichText text={/unverified/i.test(short) ? text : short} /></span></Tip>;
}

// The company's fingerprint score in the header facts line; the tip holds the full write-up.
export function FingerprintFact({ company }: { company: Company }) {
    if (!company.fingerprint) return null;
    const score = fingerprintScore(company.fingerprint);
    return <Tip text={company.fingerprint}><span className="unverified" tabIndex={0}>Fingerprint {score === null ? 'unscored' : `${score}/5`}</span></Tip>;
}

export function SiteLink({ company, text = 'Website' }: { company: Company; text?: string }) {
    return safeHref(company.website) ? <ExtLink href={company.website} className="site">{text}</ExtLink> : null;
}

// A table row that opens a record when clicked anywhere. Links, buttons and form fields inside keep their own behaviour,
// and the real link on the name is what keyboard users use.
export function LinkRow({ to, children }: { to: string; children: React.ReactNode }) {
    const navigate = useNavigate();
    return <tr className="link-row" onClick={(e) => { if (!(e.target as HTMLElement).closest('a,button,input,textarea,select,label')) navigate(to); }}>{children}</tr>;
}

export function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
    return <Toggle className="chip" pressed={on} onPressedChange={() => onClick()}>{children}</Toggle>;
}

export const Tag = ({ children, tone = 'plain' }: { children: React.ReactNode; tone?: 'applied' | 'plain' }) => <span className={tone === 'applied' ? 'tag applied' : 'tag'}>{children}</span>;
const ActiveApplication = () => <a className="tag applied" href="#/applications">Applied</a>;

const POSTED = { no: 'no longer posted', unknown: "can't check automatically" };

// Muted note for a posting that is not plainly still posted; nothing when it is.
export const PostedNote = ({ posting }: { posting: Posting }) => posting.posted === 'yes' ? null : <span className="meta small">{POSTED[posting.posted]}</span>;

// What the records say about a company, shown beside its name.
// A fill run takes about 2 minutes; after 30 the tag is dropped so a failed run doesn't leave it forever.
const lookingUp = (c: Company) => Boolean(c.fillRequested) && Date.now() - Date.parse(c.fillRequested!) < 30 * 60_000;

export function CompanyTags({ company, postings }: { company: Company; postings: Posting[] }) {
    return (
        <>
            {activeApplication(company) && <ActiveApplication />}
            {pastOutcomes(company).map((o: string) => <Tag key={o}>{o}</Tag>)}
            {hasActiveLead(company, postings) && <Tag>Active lead</Tag>}
            {lookingUp(company) && <Tag>Looking up facts</Tag>}
        </>
    );
}

// What the records say about one job.
export function JobTags({ company, posting, kits }: { company: Company; posting: Posting; kits: { name: string; meta: KitMeta }[] }) {
    const kit = kits.findLast((k) => k.meta.postingId === posting.id);
    return (
        <>
            {applicationFor(company, posting)?.outcome === 'applied' && <ActiveApplication />}
            {jobEntry(company, posting)?.state === 'saved' && <Tag>Saved</Tag>}
            {jobEntry(company, posting)?.state === 'applying' && <Tag>Applying</Tag>}
            {kit && <Tag><Link to={`/kits/${kit.name}`}>Kit started</Link></Tag>}
            {nowPass(posting) && <Tag>Models now say pass</Tag>}
        </>
    );
}
