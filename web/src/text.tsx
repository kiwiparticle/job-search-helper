import type { ReactNode } from 'react';
import { safeHref } from '../../lib/safe.js';

export function ExtLink({ href, className, children }: { href: string; className?: string; children: ReactNode }) {
    return <a href={safeHref(href) ?? undefined} className={className ? `ext ${className}` : 'ext'} target="_blank" rel="noopener noreferrer">{children} ↗</a>;
}

// The posting link shown on every row tied to a position; nothing when there's no link.
export function PostingLink({ url, text = 'Posting' }: { url?: string; text?: string }) {
    return url ? <ExtLink href={url} className="posting">{text}</ExtLink> : null;
}

// Light Markdown for model text: [label](url), bare URLs and **bold**. React escapes everything else.
const INLINE = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s)<>"']*[^\s)<>"'.,;:!?])|\*\*([^*]+)\*\*/g;
// A bare URL shows as its host name, like builtin.com.
const host = (url: string) => URL.parse(url)?.hostname.replace(/^www\./, '') || url;

export function RichText({ text }: { text?: string }) {
    const s = String(text ?? '');
    const out: ReactNode[] = [];
    let last = 0;
    for (const m of s.matchAll(INLINE)) {
        out.push(s.slice(last, m.index));
        const key = m.index;
        if (m[2]) out.push(<ExtLink key={key} href={m[2]} className="inline">{m[1]}</ExtLink>);
        else if (m[3]) out.push(<ExtLink key={key} href={m[3]} className="inline">{host(m[3])}</ExtLink>);
        else out.push(<strong key={key}>{m[4]}</strong>);
        last = m.index + m[0].length;
    }
    out.push(s.slice(last));
    return <>{out}</>;
}
