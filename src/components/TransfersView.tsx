import { progress, transferDetail, plural } from "../lib/format";
import { api, errorText, type Transfer } from "../lib/native";
import { useServices } from "../lib/services";
import { ArrowDown, ArrowUp, CheckCircle, Close, External, Folder, Refresh, Stop, Transfers as TransfersIcon, XCircle } from "./Icons";

export function TransfersView({ transfers }: { transfers: Transfer[] }) {
  const services = useServices();
  const active = transfers.filter((t) => t.state === "running" || t.state === "queued");
  const finished = transfers.filter((t) => !(t.state === "running" || t.state === "queued")).sort((a, b) => (b.finished ?? 0) - (a.finished ?? 0));
  const run = (p: Promise<unknown>) => void p.catch((e) => services.toast("bad", errorText(e)));

  return (
    <>
      <header className="header" data-tauri-drag-region>
        <div className="crumbs">
          <span className="crumb root">
            <TransfersIcon /> Transfers
          </span>
        </div>
        <span className="spacer" data-tauri-drag-region />
        {active.length > 0 && (
          <button className="btn ghost" onClick={() => active.forEach((t) => run(api.cancelTransfer(t.id)))}>
            <Stop /> Stop all
          </button>
        )}
        <button className="btn" onClick={() => run(api.clearTransfers())} disabled={finished.length === 0}>
          Clear finished
        </button>
      </header>
      {transfers.length === 0 ? (
        <div className="empty">
          <TransfersIcon className="i empty-icon" />
          <h2>No transfers yet</h2>
          <p>Drop files from Finder onto a folder to upload them. Downloads go to your Downloads folder unless a site says otherwise.</p>
        </div>
      ) : (
        <div className="page">
          {active.length > 0 && (
            <>
              <div className="group-head">
                In progress <span className="count">{active.length}</span>
              </div>
              {active.map((t) => (
                <Row key={t.id} t={t} run={run} />
              ))}
            </>
          )}
          {finished.length > 0 && (
            <>
              <div className="group-head">
                Finished <span className="count">{plural(finished.length, "transfer")}</span>
              </div>
              {finished.map((t) => (
                <Row key={t.id} t={t} run={run} />
              ))}
            </>
          )}
        </div>
      )}
    </>
  );
}

function Row({ t, run }: { t: Transfer; run: (p: Promise<unknown>) => void }) {
  const up = t.direction === "upload";
  const live = t.state === "running" || t.state === "queued";
  const where = up ? t.request.remote : t.request.local.replace(/^\/Users\/[^/]+/, "~");
  return (
    <div className="transfer">
      <span className={`t-icon ${up ? "up" : "down"}`} title={up ? "Upload" : "Download"}>
        {up ? <ArrowUp /> : <ArrowDown />}
      </span>
      <div className="t-title">
        <span>{t.name}</span>
        <span className="t-site">
          {up ? "to" : "from"} {t.siteName} · {where}
        </span>
      </div>
      <div className="t-actions">
        {t.state === "running" && <span className="state-pill running">{t.filesTotal > 1 ? `${t.filesDone}/${t.filesTotal}` : `${Math.round(progress(t) * 100)}%`}</span>}
        {t.state === "queued" && <span className="state-pill">Queued</span>}
        {t.state === "done" && (
          <span className="state-pill done">
            <CheckCircle /> Done
          </span>
        )}
        {t.state === "failed" && (
          <span className="state-pill failed">
            <XCircle /> Failed
          </span>
        )}
        {t.state === "cancelled" && <span className="state-pill">Stopped</span>}
        {live && (
          <button className="icon-btn" title="Stop" onClick={() => run(api.cancelTransfer(t.id))}>
            <Close />
          </button>
        )}
        {(t.state === "failed" || t.state === "cancelled") && (
          <button className="icon-btn" title="Try again" onClick={() => run(api.retryTransfer(t.id))}>
            <Refresh />
          </button>
        )}
        {t.state === "done" && !up && t.result && (
          <>
            <button className="icon-btn" title="Open" onClick={() => run(api.openLocal(t.result!))}>
              <External />
            </button>
            <button className="icon-btn" title="Show in Finder" onClick={() => run(api.reveal(t.result!))}>
              <Folder />
            </button>
          </>
        )}
      </div>
      <div className={`t-detail${t.state === "failed" ? " bad" : ""}`}>
        {t.state === "running" && (
          <div className="bar">
            <div style={{ width: `${progress(t) * 100}%` }} />
          </div>
        )}
        <span className="text">
          {transferDetail(t)}
          {t.state === "running" && t.current && t.filesTotal > 1 ? ` · ${t.current}` : ""}
        </span>
      </div>
    </div>
  );
}
