import { PreviewCard } from '@base-ui/react/preview-card';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { companyAge, fingerprintScore, isOutstanding, hasRecentAwards } from '../format';
import type { Company } from '../model';
import { RichText } from '../text';

// A star after the name of an outstanding company (format.ts isOutstanding). Text, so it also works inside a row button.
export const OutstandingMark = () => <span className="co-star" role="img" aria-label="Outstanding company">★</span>;

// A link to the company page with an at-a-glance card on hover or focus. It only shows what the
// company record already holds; touch screens just follow the link. `plain` shows the card on hover but stays
// text, for places already inside a button (New's rows), where a link can't nest.
export function CompanyLink({ company, className, children, plain }: { company: Company; className?: string; children?: ReactNode; plain?: boolean }) {
    const age = companyAge(company.founded);
    const score = fingerprintScore(company.fingerprint);
    const facts = [company.size, age].filter(Boolean).join(' · ');
    return (
        <PreviewCard.Root>
            <PreviewCard.Trigger render={plain ? <span className={className} /> : <Link className={className} to={`/companies/${company.key}`} />}>{children ?? company.name}{isOutstanding(company) && <OutstandingMark />}</PreviewCard.Trigger>
            <PreviewCard.Portal>
                <PreviewCard.Positioner sideOffset={6} className="pop-pos">
                    <PreviewCard.Popup className="hover-card">
                        <span><strong>{company.name}</strong>{isOutstanding(company) && <> <span className="tag">Outstanding</span></>}{hasRecentAwards(company.awards) && <> <span className="tag">Recent awards</span></>}</span>
                        <span className="muted small">{company.stance || 'No stance'}{company.verdict && ` · ${company.verdict}`}</span>
                        {company.domain && <span><RichText text={company.domain} /></span>}
                        {facts && <span className="small">{facts}</span>}
                        {score !== null && <span className="small"><b>Fingerprint</b> {score}/5</span>}
                        {company.awards && <span className="small clamp"><b>Awards</b> <RichText text={company.awards} /></span>}
                        {company.stability && <span className="small clamp"><b>Stability</b> <RichText text={company.stability} /></span>}
                        {company.culture && <span className="small clamp"><b>Culture</b> <RichText text={company.culture} /></span>}
                    </PreviewCard.Popup>
                </PreviewCard.Positioner>
            </PreviewCard.Portal>
        </PreviewCard.Root>
    );
}
