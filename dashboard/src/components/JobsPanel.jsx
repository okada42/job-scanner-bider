import { memo, useMemo } from "react";
import { useLiveClock } from "../lib/clock";
import { PAGE_SIZES, needsClock } from "../lib/jobs";
import { JobRow } from "./JobRow";

export const JobsPanel = memo(function JobsPanel({
  jobs,
  total,
  expired = 0,
  page,
  pageSize,
  loaded,
  reportingJobId,
  onReport,
  onPage,
  onPageSize,
}) {
  const now = useLiveClock(needsClock(jobs));
  const pageCount = Math.max(1, Math.ceil((total || 0) / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);

  const rows = useMemo(
    () =>
      jobs.map((job) => (
        <JobRow
          key={job.id}
          job={job}
          now={now}
          reporting={reportingJobId === job.id}
          onReport={onReport}
        />
      )),
    [jobs, now, reportingJobId, onReport]
  );

  return (
    <article className="card grow jobs-panel">
      <div className="panel-head">
        <div>
          <h2>Jobs</h2>
          <p className="muted">
            Today&apos;s new listings (Japan time) plus manually added URLs. Earlier days and baseline jobs
            stay hidden
            {expired > 0 ? ` (${expired} expired today).` : "."}
          </p>
        </div>
        <div className="pager-sizes" role="group" aria-label="Rows per page">
          {PAGE_SIZES.map((size) => (
            <button
              key={size}
              type="button"
              className={pageSize === size ? "active" : ""}
              onClick={() => onPageSize(size)}
            >
              {size}
            </button>
          ))}
          <span className="muted">rows</span>
        </div>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Status</th>
              <th>Platform</th>
              <th>Title</th>
              <th>Budget</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {!loaded ? (
              <tr>
                <td colSpan={5} className="empty">
                  Loading jobs…
                </td>
              </tr>
            ) : jobs.length === 0 ? (
              <tr>
                <td colSpan={5} className="empty">
                  No new jobs today yet. Earlier days, and the first-crawl baseline, stay hidden here.
                </td>
              </tr>
            ) : (
              rows
            )}
          </tbody>
        </table>
      </div>
      <div className="pager">
        <span className="pager-count">
          {total ? `${from}–${to} of ${total}` : "0 jobs"}
        </span>
        <div className="pager-nav">
          <button type="button" disabled={page <= 1} onClick={() => onPage(page - 1)}>
            Prev
          </button>
          <span>
            Page {Math.min(page, pageCount)} of {pageCount}
          </span>
          <button type="button" disabled={page >= pageCount} onClick={() => onPage(page + 1)}>
            Next
          </button>
        </div>
      </div>
    </article>
  );
});
