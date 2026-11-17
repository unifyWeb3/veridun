import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  getDashboardSummary,
  getHealth,
  getProofs,
  getReceipt,
  getTask,
  getTasks,
  probeReceiptEndpoint,
  probeUnsignedAgentRequest,
} from './api';
import {
  DecisionBadge,
  DetailItem,
  DetailList,
  Duration,
  EmptyState,
  ErrorState,
  LifecycleBadge,
  LoadingState,
  Metric,
  PageHeader,
  Pagination,
  ProofStageBadges,
  StatusBadge,
  Timestamp,
  type Tone,
} from './components';
import { AppLink } from './navigation';
import { navigate, parseRoute, type Route } from './router';
import type {
  DashboardSummary,
  Decision,
  HealthStatus,
  ProofRecord,
  TaskDetail,
  TaskRecord,
} from './types';

interface LiveState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  reload(): void;
}

function useLiveData<T>(
  loader: (signal: AbortSignal) => Promise<T>,
  dependencies: readonly unknown[],
): LiveState<T> {
  const [revision, setRevision] = useState(0);
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setLoading(true);
    setError(null);

    loader(controller.signal)
      .then((value) => {
        if (!active) return;
        setData(value);
        setError(null);
      })
      .catch((reason: unknown) => {
        if (!active || controller.signal.aborted) return;
        setError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
      controller.abort();
    };
    // The caller controls the dependency values used to reload this query.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...dependencies, revision]);

  return {
    data,
    error,
    loading,
    reload: useCallback(() => setRevision((value) => value + 1), []),
  };
}

function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.pathname));

  useEffect(() => {
    const update = () => setRoute(parseRoute(window.location.pathname));
    window.addEventListener('veridun:navigate', update);
    window.addEventListener('popstate', update);
    return () => {
      window.removeEventListener('veridun:navigate', update);
      window.removeEventListener('popstate', update);
    };
  }, []);

  return route;
}

function reasonLabel(value: string | null): string {
  if (!value) return 'Not reported';
  return value
    .toLowerCase()
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function shortHash(value: string | null, size = 12): string {
  if (!value) return 'Not reported';
  if (value.length <= size * 2 + 3) return value;
  return `${value.slice(0, size)}…${value.slice(-size)}`;
}

function CopyButton({ value, label = 'Copy' }: { value: string | null; label?: string }) {
  const [copied, setCopied] = useState(false);
  if (!value) return null;
  const hash = value;

  async function copy() {
    await navigator.clipboard.writeText(hash);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1_500);
  }

  return (
    <button className="copy-button" type="button" onClick={() => void copy()}>
      {copied ? 'Copied' : label}
    </button>
  );
}

function EvidenceRail({
  summary,
  health,
}: {
  summary: DashboardSummary | null;
  health: HealthStatus | null;
}) {
  const tasks = summary?.decisions.total ?? 0;
  const proofs = summary?.proofs.total ?? 0;
  const finalized = summary?.proofs.finalized ?? 0;
  const inboundReady = health?.database === 'ready';

  const stages = [
    {
      number: '01',
      label: 'Task admitted',
      value: tasks > 0 ? `${tasks} durable ${tasks === 1 ? 'task' : 'tasks'}` : 'No tasks yet',
      state: tasks > 0 ? 'complete' : 'idle',
      note: 'Signed envelopes and exact responses are retained in PostgreSQL.',
    },
    {
      number: '02',
      label: 'Policy evaluated',
      value: tasks > 0 ? 'Deterministic checks' : 'Waiting for traffic',
      state: tasks > 0 ? 'complete' : 'idle',
      note: 'VK, balance, replay, expiry, recipient, and amount checks run in fixed order.',
    },
    {
      number: '03',
      label: 'Local proof verified',
      value: proofs > 0 ? `${proofs} Groth16 ${proofs === 1 ? 'proof' : 'proofs'}` : 'No proof yet',
      state: proofs > 0 ? 'complete' : 'idle',
      note: 'Every stored proof was checked against the official verification key.',
    },
    {
      number: '04',
      label: 'zkVerify finalized',
      value: finalized > 0 ? `${finalized} finalized` : 'Not observed yet',
      state: finalized > 0 ? 'complete' : 'pending',
      note: 'Kurier finality is reported only after the job reaches Finalized.',
    },
  ];

  return (
    <section className="evidence-rail" aria-labelledby="evidence-heading">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Evidence chain</p>
          <h2 id="evidence-heading">From request to on-chain record</h2>
        </div>
        <StatusBadge tone={inboundReady ? 'positive' : 'critical'}>
          {inboundReady ? 'Database ready' : 'Database unavailable'}
        </StatusBadge>
      </div>
      <ol className="evidence-steps">
        {stages.map((stage) => (
          <li key={stage.number} className={`evidence-step evidence-step--${stage.state}`}>
            <span className="evidence-step__number">{stage.number}</span>
            <div>
              <h3>{stage.label}</h3>
              <strong>{stage.value}</strong>
              <p>{stage.note}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

function OverviewRoute() {
  const summaryState = useLiveData((signal) => getDashboardSummary(signal), []);
  const healthState = useLiveData((signal) => getHealth(signal), []);
  const summary = summaryState.data;

  return (
    <>
      <PageHeader
        eyebrow="Live decision ledger"
        title="Proof gate, at a glance"
        description="Every approval, refusal, proof, and finality record—separated by evidence stage, with no simulated values."
        actions={
          <button
            className="button button--primary"
            type="button"
            onClick={() => {
              summaryState.reload();
              healthState.reload();
            }}
          >
            Refresh evidence
          </button>
        }
      />

      {summaryState.error ? (
        <ErrorState message={summaryState.error} onRetry={summaryState.reload} />
      ) : null}
      {healthState.error ? (
        <ErrorState
          title="Service health could not be confirmed"
          message={healthState.error}
          onRetry={healthState.reload}
        />
      ) : null}
      {summaryState.loading && !summary ? (
        <LoadingState label="Loading the durable decision ledger…" />
      ) : null}

      {summary ? (
        <>
          <section className="metric-grid" aria-label="Decision metrics">
            <Metric
              label="Approvals"
              value={summary.decisions.approved}
              detail={`${summary.decisions.total ?? 0} total tasks`}
              tone="positive"
            />
            <Metric
              label="Rejections"
              value={summary.decisions.rejected}
              detail="Fail-closed decisions"
              tone="critical"
            />
            <Metric
              label="Locally verified proofs"
              value={summary.proofs.localVerified}
              detail={`${summary.proofs.total ?? 0} proof records`}
            />
            <Metric
              label="Kurier finalized"
              value={summary.proofs.finalized}
              detail={`${summary.proofs.submitted ?? 0} submitted`}
              tone="info"
            />
            <Metric
              label="P95 response"
              value={summary.latency.p95Ms === null ? null : `${summary.latency.p95Ms} ms`}
              detail={`${summary.latency.averageMs ?? '—'} ms average`}
            />
            <Metric
              label="Failed tasks"
              value={summary.decisions.failed}
              detail="Requires operator review"
              tone={summary.decisions.failed ? 'warning' : 'neutral'}
            />
          </section>

          <EvidenceRail summary={summary} health={healthState.data} />

          <section className="tour-callout" aria-labelledby="tour-callout-heading">
            <div>
              <p className="eyebrow">Evaluating Veridun</p>
              <h2 id="tour-callout-heading">Take the two-minute judge tour</h2>
              <p>
                Five steps from the live deployment to the evidence: the signed
                protocol, one task producing one stored response, the proof
                attached to each decision, and the offline command that
                re-verifies a decision receipt.
              </p>
            </div>
            <AppLink className="button button--primary" href="/tour">
              Start the tour
            </AppLink>
          </section>

          <section className="split-section" aria-labelledby="reasons-heading">
            <div className="panel">
              <div className="section-heading">
                <div>
                  <p className="eyebrow">Decision reasons</p>
                  <h2 id="reasons-heading">What the gate rejected</h2>
                </div>
              </div>
              {Object.keys(summary.reasons).length ? (
                <div className="reason-list">
                  {Object.entries(summary.reasons)
                    .sort((a, b) => b[1] - a[1])
                    .map(([reason, count]) => (
                      <div className="reason-row" key={reason}>
                        <span>{reasonLabel(reason)}</span>
                        <strong>{count}</strong>
                      </div>
                    ))}
                </div>
              ) : (
                <EmptyState
                  title="No completed decisions yet"
                  description="Reason counts appear after the first signed task is processed."
                />
              )}
            </div>

            <div className="panel">
              <div className="section-heading">
                <div>
                  <p className="eyebrow">Exception queue</p>
                  <h2>Recent failures</h2>
                </div>
                <AppLink className="text-link" href="/tasks">
                  View all tasks
                </AppLink>
              </div>
              {summary.recentFailures.length ? (
                <div className="compact-list">
                  {summary.recentFailures.map((task) => (
                    <AppLink className="compact-row" href={`/tasks/${encodeURIComponent(task.id)}`} key={task.id}>
                      <span>
                        <strong>{task.id}</strong>
                        <small>{task.error ?? 'Failure recorded'}</small>
                      </span>
                      <Timestamp value={task.updatedAt} />
                    </AppLink>
                  ))}
                </div>
              ) : (
                <EmptyState
                  title="No failed tasks"
                  description="The exception queue is empty. Missing evidence remains visible on each task."
                />
              )}
            </div>
          </section>
        </>
      ) : null}
    </>
  );
}

function TasksRoute() {
  const [offset, setOffset] = useState(0);
  const [decision, setDecision] = useState<Decision | ''>('');
  const [reason, setReason] = useState('');
  const limit = 25;
  const state = useLiveData(
    (signal) => getTasks({ limit, offset, decision, reason_code: reason || undefined }, signal),
    [offset, decision, reason],
  );

  const items = state.data?.items ?? [];
  const total = state.data?.total ?? null;

  return (
    <>
      <PageHeader
        eyebrow="Task ledger"
        title="Every gate decision"
        description="Signed envelopes, deterministic outcomes, proof presence, and replay state in one durable sequence."
        actions={
          <button className="button button--primary" type="button" onClick={state.reload}>
            Refresh tasks
          </button>
        }
      />

      <section className="filter-bar" aria-label="Task filters">
        <label>
          <span>Decision</span>
          <select
            value={decision}
            onChange={(event) => {
              setDecision(event.target.value as Decision | '');
              setOffset(0);
            }}
          >
            <option value="">All decisions</option>
            <option value="APPROVE">Approved</option>
            <option value="REJECT">Rejected</option>
          </select>
        </label>
        <label>
          <span>Reason code</span>
          <input
            value={reason}
            onChange={(event) => {
              setReason(event.target.value.trim().toUpperCase());
              setOffset(0);
            }}
            placeholder="e.g. THRESHOLD_MISMATCH"
          />
        </label>
        <button
          className="button button--quiet"
          type="button"
          onClick={() => {
            setDecision('');
            setReason('');
            setOffset(0);
          }}
        >
          Clear filters
        </button>
      </section>

      {state.error ? <ErrorState message={state.error} onRetry={state.reload} /> : null}
      {state.loading && !state.data ? <LoadingState label="Loading task records…" /> : null}

      {state.data ? (
        items.length ? (
          <section className="table-panel" aria-label="Tasks">
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th scope="col">Task</th>
                    <th scope="col">Decision</th>
                    <th scope="col">Reason</th>
                    <th scope="col">Lifecycle</th>
                    <th scope="col">Proof</th>
                    <th scope="col">Duration</th>
                    <th scope="col">Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((task) => (
                    <tr key={task.id}>
                      <td>
                        <AppLink className="table-primary" href={`/tasks/${encodeURIComponent(task.id)}`}>
                          {task.id}
                        </AppLink>
                        <small>{task.mode ?? 'mode not reported'}</small>
                      </td>
                      <td><DecisionBadge decision={task.decision} /></td>
                      <td><span className="reason-code">{reasonLabel(task.reasonCode)}</span></td>
                      <td><LifecycleBadge status={task.status} /></td>
                      <td>{task.proofStatus ? <LifecycleBadge status={task.proofStatus} /> : <span className="muted">Not reported</span>}</td>
                      <td><Duration milliseconds={task.durationMs} /></td>
                      <td><Timestamp value={task.updatedAt} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination
              offset={offset}
              limit={limit}
              count={items.length}
              total={total}
              onOffsetChange={setOffset}
            />
          </section>
        ) : (
          <EmptyState
            title="No tasks match this view"
            description="Clear the filters or wait for the next signed Agent Games delivery."
          />
        )
      ) : null}
    </>
  );
}

function HashValue({ value }: { value: string | null }) {
  if (!value) return <span className="muted">Not reported</span>;
  return (
    <span className="hash-value">
      <code title={value}>{value}</code>
      <CopyButton value={value} />
    </span>
  );
}

function TaskDetailRoute({ taskId }: { taskId: string }) {
  const state = useLiveData((signal) => getTask(taskId, signal), [taskId]);
  const receiptState = useLiveData((signal) => getReceipt(taskId, signal), [taskId]);
  const task = state.data;
  const receipt = receiptState.data;

  return (
    <>
      <button className="back-link" type="button" onClick={() => navigate('/tasks')}>
        ← Task ledger
      </button>
      <PageHeader
        eyebrow="Decision record"
        title={taskId}
        description="The exact checks, evidence stages, and signed response retained for this task."
        actions={
          <button className="button button--primary" type="button" onClick={state.reload}>
            Refresh record
          </button>
        }
      />

      {state.error ? <ErrorState message={state.error} onRetry={state.reload} /> : null}
      {state.loading && !task ? <LoadingState label="Loading the task record…" /> : null}

      {task ? (
        <>
          <section className="decision-band" aria-label="Decision summary">
            <div>
              <p className="eyebrow">Recorded outcome</p>
              <DecisionBadge decision={task.decision} />
              <h2>{reasonLabel(task.reasonCode)}</h2>
            </div>
            <div className="decision-band__meta">
              <span><small>Lifecycle</small><LifecycleBadge status={task.status} /></span>
              <span><small>Mode</small><strong>{task.mode ?? 'Not reported'}</strong></span>
              <span><small>Duration</small><Duration milliseconds={task.durationMs} /></span>
            </div>
          </section>

          <section className="detail-layout" aria-label="Task evidence">
            <div className="panel panel--wide">
              <div className="section-heading">
                <div>
                  <p className="eyebrow">Deterministic policy</p>
                  <h2>Checks in evaluation order</h2>
                </div>
                <span className="muted">{task.checks.filter((check) => check.passed).length}/{task.checks.length} passed</span>
              </div>
              {task.checks.length ? (
                <div className="check-list">
                  {task.checks.map((check, index) => (
                    <div className="check-row" key={check.key ?? `${check.label}-${index}`}>
                      <span className="check-row__index">{String(index + 1).padStart(2, '0')}</span>
                      <span className="check-row__body">
                        <strong>{check.label}</strong>
                        <small>Expected {check.expected ?? '—'} · Observed {check.observed ?? '—'}</small>
                      </span>
                      <StatusBadge tone={check.passed === true ? 'positive' : check.passed === false ? 'critical' : 'neutral'}>
                        {check.passed === true ? 'Passed' : check.passed === false ? 'Failed' : 'Unknown'}
                      </StatusBadge>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState title="Policy checks unavailable" description="The task record contains no check evidence." />
              )}
            </div>

            <aside className="panel">
              <div className="section-heading">
                <div>
                  <p className="eyebrow">Proof stages</p>
                  <h2>Outbound evidence</h2>
                </div>
              </div>
              <ProofStageBadges proof={task.proof} />
              <DetailList>
                <DetailItem term="Public signals">
                  {task.proof?.publicSignals.length ?? 0}
                </DetailItem>
                <DetailItem term="Task proof reference" wide>
                  <HashValue value={task.proofTx} />
                </DetailItem>
                <DetailItem term="Request digest" wide>
                  <HashValue value={task.requestDigest} />
                </DetailItem>
                <DetailItem term="Issued"><Timestamp value={task.issuedAt} /></DetailItem>
                <DetailItem term="Deadline"><Timestamp value={task.deadlineAt} /></DetailItem>
              </DetailList>
            </aside>
          </section>

          <section className="split-section" aria-label="Network evidence">
            <div className="panel">
              <div className="section-heading">
                <div>
                  <p className="eyebrow">Inbound proof</p>
                  <h2>zkVerify verification</h2>
                </div>
                <StatusBadge tone={task.inboundVerification?.verified ? 'positive' : task.inboundVerification ? 'critical' : 'neutral'}>
                  {task.inboundVerification?.verified ? 'Verified' : task.inboundVerification ? 'Not verified' : 'Not checked'}
                </StatusBadge>
              </div>
              {task.inboundVerification ? (
                <DetailList>
                  <DetailItem term="Finalized">{task.inboundVerification.finalized ? 'Yes' : 'No'}</DetailItem>
                  <DetailItem term="VK matches">{task.inboundVerification.vkMatches ? 'Yes' : 'No'}</DetailItem>
                  <DetailItem term="Block">{task.inboundVerification.blockNumber ?? 'Not reported'}</DetailItem>
                  <DetailItem term="Public inputs">{task.inboundVerification.publicInputCount ?? 'Not reported'}</DetailItem>
                  <DetailItem term="Extrinsic" wide><HashValue value={task.inboundVerification.extrinsicHash} /></DetailItem>
                  <DetailItem term="Input digest" wide><HashValue value={task.inboundVerification.publicInputsHash} /></DetailItem>
                  {task.inboundVerification.error ? (
                    <DetailItem term="Verifier note" wide>{task.inboundVerification.error}</DetailItem>
                  ) : null}
                </DetailList>
              ) : (
                <EmptyState title="No inbound proof check" description="This decision did not require inbound finality evidence." />
              )}
            </div>

            <div className="panel">
              <div className="section-heading">
                <div>
                  <p className="eyebrow">Outbound submission</p>
                  <h2>Kurier job</h2>
                </div>
                <StatusBadge tone={task.kurier?.status === 'Finalized' ? 'positive' : task.kurier ? 'warning' : 'neutral'}>
                  {task.kurier?.status ?? 'Not submitted'}
                </StatusBadge>
              </div>
              {task.kurier ? (
                <DetailList>
                  <DetailItem term="Job ID" wide><HashValue value={task.kurier.jobId} /></DetailItem>
                  <DetailItem term="Submitted"><Timestamp value={task.kurier.submittedAt} /></DetailItem>
                  <DetailItem term="Finalized"><Timestamp value={task.kurier.finalizedAt} /></DetailItem>
                  <DetailItem term="Transaction" wide><HashValue value={task.kurier.transactionHash} /></DetailItem>
                  {task.kurier.error ? <DetailItem term="Error" wide>{task.kurier.error}</DetailItem> : null}
                </DetailList>
              ) : (
                <EmptyState title="No Kurier record" description="The proof was not submitted to Kurier, or no submission evidence was retained." />
              )}
            </div>
          </section>

          <section className="panel" aria-labelledby="receipt-heading">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Signed receipt</p>
                <h2 id="receipt-heading">Re-verify this decision</h2>
              </div>
              <StatusBadge tone={receipt?.responseSignature ? 'positive' : 'neutral'}>
                {receipt?.responseSignature ? 'Signed' : 'Not signed'}
              </StatusBadge>
            </div>
            {receiptState.error ? (
              <ErrorState message={receiptState.error} onRetry={receiptState.reload} />
            ) : receipt?.responseBody ? (
              <DetailList>
                <DetailItem term="Response bytes" wide>
                  <span className="hash-value">
                    <code title={receipt.responseBody}>
                      {receipt.responseBody.length > 120
                        ? `${receipt.responseBody.slice(0, 117)}…`
                        : receipt.responseBody}
                    </code>
                    <CopyButton value={receipt.responseBody} />
                  </span>
                </DetailItem>
                <DetailItem term="Signature" wide><HashValue value={receipt.responseSignature} /></DetailItem>
                <DetailItem term="Signature scheme">{receipt.responseSignatureAlgorithm ?? 'Not reported'}</DetailItem>
                <DetailItem term="Proof scheme">{receipt.proofScheme ?? 'Not reported'}</DetailItem>
                <DetailItem term="Verification key" wide>{receipt.verificationKeySource ?? 'Not reported'}</DetailItem>
                {receipt.counterfactual ? (
                  <DetailItem term="Value at risk" wide>
                    {receipt.counterfactual.note ?? 'Not reported'}
                    {receipt.counterfactual.wouldHaveApprovedIf
                      ? ` Would have approved if ${receipt.counterfactual.wouldHaveApprovedIf}.`
                      : ''}
                  </DetailItem>
                ) : null}
                <DetailItem term="Reproduce" wide>
                  <span className="hash-value"><code>{receipt.reproduce ?? 'npm run receipt:verify -- <receipt-file>'}</code></span>
                </DetailItem>
              </DetailList>
            ) : (
              <EmptyState
                title="No signed response retained"
                description="This task has no stored response bytes yet, so there is nothing to re-verify."
              />
            )}
          </section>

          <section className="panel" aria-labelledby="timeline-heading">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Processing record</p>
                <h2 id="timeline-heading">Evidence timeline</h2>
              </div>
            </div>            {task.attempts.length ? (
              <ol className="timeline">
                {task.attempts.map((attempt) => (
                  <li key={attempt.id ?? `${attempt.type}-${attempt.occurredAt}`}>
                    <span className="timeline__dot" aria-hidden="true" />
                    <div>
                      <strong>{reasonLabel(attempt.type)}</strong>
                      <p>{attempt.detail ?? attempt.error ?? 'No additional detail recorded.'}</p>
                    </div>
                    <StatusBadge tone={attempt.status === 'failed' ? 'critical' : attempt.status === 'verified' || attempt.status === 'finalized' ? 'positive' : 'neutral'}>
                      {reasonLabel(attempt.status)}
                    </StatusBadge>
                    <Timestamp value={attempt.occurredAt} />
                  </li>
                ))}
              </ol>
            ) : (
              <EmptyState title="No timeline entries" description="Processing-stage telemetry is not available for this record." />
            )}
          </section>
        </>
      ) : null}
    </>
  );
}

function ProofsRoute() {
  const [offset, setOffset] = useState(0);
  const limit = 25;
  const state = useLiveData((signal) => getProofs({ limit, offset }, signal), [offset]);
  const items = state.data?.items ?? [];

  return (
    <>
      <PageHeader
        eyebrow="Proof ledger"
        title="Local proofs and chain evidence"
        description="A proof is locally verified before storage; submitted and finalized are separate, observable stages."
        actions={
          <button className="button button--primary" type="button" onClick={state.reload}>
            Refresh proofs
          </button>
        }
      />

      {state.error ? <ErrorState message={state.error} onRetry={state.reload} /> : null}
      {state.loading && !state.data ? <LoadingState label="Loading proof records…" /> : null}

      {state.data ? (
        items.length ? (
          <section className="table-panel" aria-label="Proof records">
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th scope="col">Task</th>
                    <th scope="col">Decision</th>
                    <th scope="col">Local</th>
                    <th scope="col">Inbound</th>
                    <th scope="col">Submitted</th>
                    <th scope="col">Finalized</th>
                    <th scope="col">Signals</th>
                    <th scope="col">Transaction</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((proof: ProofRecord) => (
                    <tr key={proof.id ?? proof.taskId}>
                      <td>
                        {proof.taskId ? (
                          <AppLink className="table-primary" href={`/tasks/${encodeURIComponent(proof.taskId)}`}>
                            {proof.taskId}
                          </AppLink>
                        ) : <span className="muted">Not reported</span>}
                      </td>
                      <td><DecisionBadge decision={proof.decision} /></td>
                      <td><EvidenceMark value={proof.localVerified} positive="Verified" negative="Not verified" /></td>
                      <td><EvidenceMark value={proof.inboundVerified} positive="Verified" negative="Not verified" /></td>
                      <td><EvidenceMark value={proof.submitted} positive="Submitted" negative="Not submitted" /></td>
                      <td><EvidenceMark value={proof.finalized} positive="Finalized" negative="Not finalized" /></td>
                      <td>{proof.publicSignalCount ?? '—'}</td>
                      <td><span className="hash-value"><code title={proof.transactionHash ?? undefined}>{shortHash(proof.transactionHash, 7)}</code></span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination
              offset={offset}
              limit={limit}
              count={items.length}
              total={state.data.total}
              onOffsetChange={setOffset}
            />
          </section>
        ) : (
          <EmptyState
            title="No proof records yet"
            description="A locally verified Groth16 proof appears here after the first provable task."
          />
        )
      ) : null}
    </>
  );
}

function EvidenceMark({
  value,
  positive,
  negative,
}: {
  value: boolean | null;
  positive: string;
  negative: string;
}) {
  if (value === true) return <StatusBadge tone="positive">{positive}</StatusBadge>;
  if (value === false) return <StatusBadge tone="critical">{negative}</StatusBadge>;
  return <StatusBadge tone="neutral">Not reported</StatusBadge>;
}

interface TourStep {
  number: string;
  title: string;
  proves: string;
  observation: string;
  tone: Tone;
  route?: { href: string; label: string };
  command?: { label: string; value: string };
}

function CommandBlock({ label, value }: { label: string; value: string }) {
  return (
    <div className="command-block">
      <div className="command-block__head">
        <span className="command-block__label">{label}</span>
        <CopyButton value={value} label="Copy" />
      </div>
      <code className="command-block__code">{value}</code>
    </div>
  );
}

function TourStepCard({ step }: { step: TourStep }) {
  return (
    <li className="tour-step">
      <span className="tour-step__number" aria-hidden="true">{step.number}</span>
      <div className="tour-step__body">
        <div className="tour-step__head">
          <h3>{step.title}</h3>
          <StatusBadge tone={step.tone}>{step.observation}</StatusBadge>
        </div>
        <p className="tour-step__proves">{step.proves}</p>
        <div className="tour-step__actions">
          {step.route ? (
            <AppLink className="button button--secondary" href={step.route.href}>
              {step.route.label}
            </AppLink>
          ) : null}
          {step.command ? (
            <span className="tour-step__command">
              <code>{step.command.value}</code>
              <CopyButton value={step.command.value} label="Copy" />
            </span>
          ) : null}
        </div>
      </div>
    </li>
  );
}

function TourRoute() {
  const healthState = useLiveData((signal) => getHealth(signal), []);
  const summaryState = useLiveData((signal) => getDashboardSummary(signal), []);
  const tasksState = useLiveData((signal) => getTasks({ limit: 1, offset: 0 }, signal), []);
  const unsignedState = useLiveData((signal) => probeUnsignedAgentRequest(signal), []);
  const receiptState = useLiveData((signal) => probeReceiptEndpoint(signal), []);

  const origin = window.location.origin;
  const health = healthState.data;
  const summary = summaryState.data;
  const taskCount = summary?.decisions.total ?? 0;
  const proofCount = summary?.proofs.total ?? 0;
  const verifiedProofs = summary?.proofs.localVerified ?? 0;
  const firstTask = tasksState.data?.items[0] ?? null;

  const healthReady = health?.ok === true && health.database === 'ready';
  const unsigned = unsignedState.data;
  const receiptProbe = receiptState.data;

  const steps: TourStep[] = [
    {
      number: '01',
      title: 'The service is live and its ledger is durable',
      proves:
        'The deployed agent answers unauthenticated probes, and every value on this page comes from the PostgreSQL ledger rather than a fixture.',
      observation: healthReady
        ? `Database ready · proof submission ${health?.proofSubmission ?? 'unknown'}`
        : healthState.loading
          ? 'Checking the service'
          : 'Service not confirmed',
      tone: healthReady ? 'positive' : healthState.loading ? 'neutral' : 'critical',
      route: { href: '/', label: 'Open the overview' },
      command: { label: 'Health probe', value: `curl ${origin}/health` },
    },
    {
      number: '02',
      title: 'Unsigned requests are refused before parsing',
      proves:
        'The HMAC is verified over the exact request bytes before JSON.parse runs, so an unsigned or tampered body never reaches the policy engine or the database. The response is still signed.',
      observation: unsigned
        ? `HTTP ${unsigned.status} ${unsigned.error ?? ''} · response signed: ${unsigned.signed ? 'yes' : 'no'}`
        : unsignedState.loading
          ? 'Probing the endpoint'
          : 'Probe failed',
      tone:
        unsigned && unsigned.status === 401 && unsigned.signed
          ? 'positive'
          : unsignedState.loading
            ? 'neutral'
            : 'critical',
      command: {
        label: 'Live probe',
        value: `curl -i -X POST ${origin}/agent -H 'content-type: application/json' --data '{"type":"agent-games.preflight.v1"}'`,
      },
    },
    {
      number: '03',
      title: 'One task produces one stored response',
      proves:
        'Concurrent or retried deliveries of the same task ID are claimed transactionally: the decision is proved once, and every caller receives the identical signed bytes. The benchmark measures this against a real PostgreSQL server.',
      observation:
        taskCount > 0
          ? `${taskCount} task${taskCount === 1 ? '' : 's'} in the ledger`
          : 'No task scored yet',
      tone: taskCount > 0 ? 'positive' : 'neutral',
      route: { href: '/tasks', label: 'Open the task ledger' },
      command: { label: 'Concurrency benchmark', value: 'npm run benchmark' },
    },
    {
      number: '04',
      title: 'Every provable decision carries its own proof',
      proves:
        'A provable task returns a Groth16 proof against the official zkVerify circuit with 13 public signals, verified locally against the exported verification key before it is returned or submitted.',
      observation:
        proofCount > 0
          ? `${verifiedProofs} of ${proofCount} proof records locally verified`
          : 'No proof records yet',
      tone: proofCount > 0 ? (verifiedProofs === proofCount ? 'positive' : 'warning') : 'neutral',
      route: { href: '/proofs', label: 'Open the proof ledger' },
    },
    {
      number: '05',
      title: 'Any decision can be re-verified offline',
      proves:
        'A receipt carries the exact signed response bytes, the signature over them, the envelope, the policy checks, and the proof — enough to re-derive the decision and re-verify the proof without trusting this service.',
      observation: receiptProbe
        ? `Receipt surface answered HTTP ${receiptProbe.status} ${receiptProbe.error ?? ''}`
        : receiptState.loading
          ? 'Probing the receipt surface'
          : 'Probe failed',
      tone: receiptProbe && receiptProbe.status === 404 ? 'positive' : receiptState.loading ? 'neutral' : 'critical',
      route: firstTask
        ? { href: `/tasks/${encodeURIComponent(firstTask.id)}`, label: 'Open a task receipt' }
        : undefined,
      command: {
        label: 'Offline verification',
        value: 'npm run receipt:verify -- docs/samples/sample-receipt.json',
      },
    },
  ];

  const commands = [
    {
      label: 'Re-verify a decision receipt offline',
      value: 'npm run receipt:verify -- docs/samples/sample-receipt.json',
    },
    {
      label: 'Re-run the concurrency and latency benchmark',
      value: 'npm run benchmark',
    },
    {
      label: 'Regenerate the factual registry from the live deployment',
      value: `npm run claims -- --live ${origin}`,
    },
    {
      label: 'Fetch the receipt of a task the service processed',
      value: `curl "${origin}/api/receipt?task_id=<task-id>"`,
    },
  ];

  return (
    <>
      <PageHeader
        eyebrow="Judge tour"
        title="Five steps to the evidence"
        description="About two minutes. Each step states what it proves, what this deployment reports right now, and how to check it yourself."
        actions={
          <button
            className="button button--primary"
            type="button"
            onClick={() => {
              healthState.reload();
              summaryState.reload();
              tasksState.reload();
              unsignedState.reload();
              receiptState.reload();
            }}
          >
            Re-check the deployment
          </button>
        }
      />

      {healthState.error ? (
        <ErrorState message={healthState.error} onRetry={healthState.reload} />
      ) : null}
      {summaryState.error ? (
        <ErrorState message={summaryState.error} onRetry={summaryState.reload} />
      ) : null}

      <ol className="tour-steps">
        {steps.map((step) => (
          <TourStepCard key={step.number} step={step} />
        ))}
      </ol>

      <section className="panel" aria-labelledby="tour-commands-heading">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Run it yourself</p>
            <h2 id="tour-commands-heading">Four commands, no account needed</h2>
          </div>
        </div>
        <div className="command-grid">
          {commands.map((command) => (
            <CommandBlock key={command.label} label={command.label} value={command.value} />
          ))}
        </div>
      </section>

      <section className="panel" aria-labelledby="tour-limits-heading">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Honest limits</p>
            <h2 id="tour-limits-heading">What this tour does not prove</h2>
          </div>
        </div>
        <ul className="tour-limits">
          <li>
            No official practice round has been scored yet, so the ledger totals above are
            zero. The committed sample receipt is produced by the same code path and is
            labelled as a local sample, not as a platform-signed response.
          </li>
          <li>
            A proof is described as <strong>locally verified</strong> until the platform
            confirms it in a scored round. Local verification and platform verification
            are separate claims and are never merged.
          </li>
          <li>
            Kurier finalization evidence appears in the proof ledger once a task has been
            submitted on-chain. Until then the proof stage is shown as submitted or
            finalized only when the chain says so.
          </li>
        </ul>
      </section>
    </>
  );
}

function NotFoundRoute() {
  return (
    <section className="not-found">
      <p className="eyebrow">Route not found</p>
      <h1>This record is outside the Veridun ledger.</h1>
      <p>The requested path does not match an operational view.</p>
      <button className="button button--primary" type="button" onClick={() => navigate('/')}>
        Return to overview
      </button>
    </section>
  );
}

function Navigation({ route }: { route: Route }) {
  const links = [
    { href: '/', label: 'Overview', active: route.name === 'overview' },
    { href: '/tasks', label: 'Tasks', active: route.name === 'tasks' || route.name === 'task-detail' },
    { href: '/proofs', label: 'Proof ledger', active: route.name === 'proofs' },
    { href: '/tour', label: 'Judge tour', active: route.name === 'tour' },
  ];

  return (
    <>
      <a className="skip-link" href="#main-content">Skip to content</a>
      <header className="site-header">
        <AppLink className="brand" href="/" aria-label="Veridun overview">
          <span className="brand__seal" aria-hidden="true"><i /><i /><i /></span>
          <span><strong>Veridun</strong><small>Proof Gatekeeper operations</small></span>
        </AppLink>
        <nav aria-label="Primary navigation">
          {links.map((link) => (
            <AppLink
              className={link.active ? 'nav-link nav-link--active' : 'nav-link'}
              href={link.href}
              key={link.href}
              aria-current={link.active ? 'page' : undefined}
            >
              {link.label}
            </AppLink>
          ))}
        </nav>
        <a className="header-reference" href="https://agentgames.zkverify.io/events/proof-gatekeeper" target="_blank" rel="noreferrer">
          Event record ↗
        </a>
      </header>
    </>
  );
}

export function App() {
  const route = useRoute();
  const content = useMemo<ReactNode>(() => {
    switch (route.name) {
      case 'overview':
        return <OverviewRoute />;
      case 'tasks':
        return <TasksRoute />;
      case 'task-detail':
        return <TaskDetailRoute taskId={route.taskId} />;
      case 'proofs':
        return <ProofsRoute />;
      case 'tour':
        return <TourRoute />;
      case 'not-found':
        return <NotFoundRoute />;
    }
  }, [route]);

  return (
    <div className="app-shell">
      <Navigation route={route} />
      <main id="main-content" className="main-content">{content}</main>
      <footer className="site-footer">
        <span>Veridun / zkVerify Agent Games</span>
        <span>Local verification, chain evidence, and durable decisions remain distinct stages.</span>
      </footer>
    </div>
  );
}
