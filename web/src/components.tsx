import type { ReactNode } from 'react';
import type { Decision, ProofEvidence } from './types';

export type Tone = 'neutral' | 'positive' | 'warning' | 'critical' | 'info';

export function StatusBadge({
  children,
  tone = 'neutral',
  label,
}: {
  children: ReactNode;
  tone?: Tone;
  label?: string;
}) {
  return (
    <span className={`status-badge status-badge--${tone}`}>
      <span className="status-badge__mark" aria-hidden="true" />
      <span>{label ?? children}</span>
    </span>
  );
}

export function DecisionBadge({ decision }: { decision: Decision | null }) {
  if (!decision) {
    return <StatusBadge tone="neutral">Decision not reported</StatusBadge>;
  }

  return (
    <StatusBadge tone={decision === 'APPROVE' ? 'positive' : 'critical'}>
      {decision === 'APPROVE' ? 'Approved' : 'Rejected'}
    </StatusBadge>
  );
}

function lifecycleTone(status: string | null): Tone {
  if (!status) return 'neutral';
  const normalized = status.toUpperCase();
  if (['FAILED', 'ERROR'].includes(normalized)) return 'critical';
  if (['PROCESSING', 'PENDING', 'DECIDED', 'PROOF_READY'].includes(normalized)) return 'warning';
  if (['FINALIZED', 'COMPLETED', 'SUBMITTED'].includes(normalized)) return 'info';
  return 'neutral';
}

export function LifecycleBadge({ status }: { status: string | null }) {
  return (
    <StatusBadge tone={lifecycleTone(status)}>
      {status ? status.replace(/[_-]/g, ' ') : 'Status not reported'}
    </StatusBadge>
  );
}

function stageLabel(reported: boolean | null, affirmative: string, negative: string): string {
  if (reported === true) return affirmative;
  if (reported === false) return negative;
  return 'Not reported';
}

export function ProofStageBadges({ proof }: { proof: ProofEvidence | null }) {
  if (!proof) {
    return <StatusBadge tone="neutral">No proof evidence</StatusBadge>;
  }

  return (
    <div className="stage-list" aria-label="Proof evidence stages">
      <StatusBadge
        tone={proof.localVerified === true ? 'positive' : proof.localVerified === false ? 'critical' : 'neutral'}
      >
        {stageLabel(proof.localVerified, 'Local verified', 'Not locally verified')}
      </StatusBadge>
      <StatusBadge tone={proof.submitted === true ? 'warning' : proof.submitted === false ? 'neutral' : 'neutral'}>
        {stageLabel(proof.submitted, 'Submitted', 'Not submitted')}
      </StatusBadge>
      <StatusBadge tone={proof.finalized === true ? 'info' : proof.finalized === false ? 'neutral' : 'neutral'}>
        {stageLabel(proof.finalized, 'Finalized', 'Not finalized')}
      </StatusBadge>
    </div>
  );
}

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow: string;
  title: string;
  description: string;
  actions?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div className="page-header__copy">
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p className="page-header__description">{description}</p>
      </div>
      {actions ? <div className="page-header__actions">{actions}</div> : null}
    </header>
  );
}

export function LoadingState({ label = 'Loading live data…' }: { label?: string }) {
  return (
    <div className="state-panel state-panel--loading" role="status" aria-live="polite">
      <span className="loading-mark" aria-hidden="true" />
      <div>
        <strong>{label}</strong>
        <p>Waiting for the Veridun API. No placeholder values are shown.</p>
      </div>
    </div>
  );
}

export function ErrorState({
  title = 'Live data could not be loaded',
  message,
  onRetry,
}: {
  title?: string;
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div className="state-panel state-panel--error" role="alert">
      <span className="state-panel__signal" aria-hidden="true">!</span>
      <div>
        <strong>{title}</strong>
        <p>{message}</p>
        {onRetry ? (
          <button className="button button--secondary" type="button" onClick={onRetry}>
            Retry request
          </button>
        ) : null}
      </div>
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="state-panel state-panel--empty">
      <span className="empty-rule" aria-hidden="true" />
      <div>
        <strong>{title}</strong>
        <p>{description}</p>
        {action}
      </div>
    </div>
  );
}

export function Metric({
  label,
  value,
  detail,
  tone = 'neutral',
}: {
  label: string;
  value: number | string | null;
  detail?: string;
  tone?: Tone;
}) {
  const display =
    value === null || value === undefined
      ? '—'
      : typeof value === 'number'
        ? value.toLocaleString()
        : value;

  return (
    <div className={`metric metric--${tone}`}>
      <span className="metric__label">{label}</span>
      <strong className="metric__value">{display}</strong>
      {detail ? <span className="metric__detail">{detail}</span> : null}
    </div>
  );
}

export function Timestamp({ value, fallback = 'Not reported' }: { value: string | null; fallback?: string }) {
  if (!value) return <span className="muted">{fallback}</span>;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return (
      <time dateTime={value} title={value}>
        {value}
      </time>
    );
  }
  return (
    <time dateTime={value} title={parsed.toISOString()}>
      {parsed.toLocaleString(undefined, {
        year: 'numeric',
        month: 'short',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      })}
    </time>
  );
}

export function Duration({ milliseconds }: { milliseconds: number | null }) {
  if (milliseconds === null) return <span className="muted">Not reported</span>;
  if (milliseconds < 1000) return <span>{milliseconds.toLocaleString()} ms</span>;
  return <span>{(milliseconds / 1000).toFixed(milliseconds >= 10_000 ? 1 : 2)} s</span>;
}

export function DetailList({ children }: { children: ReactNode }) {
  return <dl className="detail-list">{children}</dl>;
}

export function DetailItem({
  term,
  children,
  wide = false,
}: {
  term: string;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <div className={wide ? 'detail-list__item detail-list__item--wide' : 'detail-list__item'}>
      <dt>{term}</dt>
      <dd>{children}</dd>
    </div>
  );
}

export function Pagination({
  offset,
  limit,
  count,
  total,
  onOffsetChange,
}: {
  offset: number;
  limit: number;
  count: number;
  total: number | null;
  onOffsetChange: (offset: number) => void;
}) {
  const first = count === 0 ? 0 : offset + 1;
  const last = offset + count;
  const canPrevious = offset > 0;
  const canNext = total !== null ? last < total : count === limit;

  return (
    <nav className="pagination" aria-label="Pagination">
      <p>
        {count === 0 ? 'No records on this page' : `Showing ${first.toLocaleString()}–${last.toLocaleString()}`}
        {total !== null ? ` of ${total.toLocaleString()} records` : ' records'}
      </p>
      <div className="pagination__controls">
        <button
          className="button button--quiet"
          type="button"
          disabled={!canPrevious}
          onClick={() => onOffsetChange(Math.max(0, offset - limit))}
        >
          Previous
        </button>
        <button
          className="button button--quiet"
          type="button"
          disabled={!canNext}
          onClick={() => onOffsetChange(offset + limit)}
        >
          Next
        </button>
      </div>
    </nav>
  );
}
