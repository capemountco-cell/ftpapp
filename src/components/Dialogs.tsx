import { useState } from "react";

import { modeFrom, permsFrom } from "../lib/format";
import type { Entry, NativeError } from "../lib/native";
import { Check, Lock, Shield, Warning } from "./Icons";
import { Dialog } from "./ui";

/** First contact with a server, or a certificate the system doesn't trust. */
export function TrustDialog({ error, onTrust, onClose }: { error: NativeError; onTrust: () => void; onClose: () => void }) {
  if (error.kind === "hostKeyChanged") {
    return (
      <Dialog onClose={onClose} label="Server identity changed">
        <div className="dialog-body">
          <h2>
            <Warning className="i" style={{ color: "var(--bad)" }} /> {error.host} has a different identity
          </h2>
          <p>Teap stopped before sending your password. The server's key doesn't match the one you trusted.</p>
          <div className="callout">
            <Warning />
            <span>
              If the server was just reinstalled, this is expected: remove its old entry from ~/.ssh/known_hosts (or ask whoever runs it to confirm the new
              fingerprint). Otherwise someone may be intercepting the connection.
            </span>
          </div>
          <div className="fingerprint">
            <span className="label">Key it sent now</span>
            {error.fingerprint}
            <span className="label" style={{ marginTop: 8 }}>
              Expected
            </span>
            {error.expected}
          </div>
        </div>
        <div className="dialog-foot">
          <button className="btn primary big" onClick={onClose} autoFocus>
            OK
          </button>
        </div>
      </Dialog>
    );
  }
  if (error.kind !== "unknownHost" && error.kind !== "untrustedCertificate") return null;
  const tls = error.kind === "untrustedCertificate";
  return (
    <Dialog onClose={onClose} label="Trust this server?">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onClose();
          onTrust();
        }}
      >
        <div className="dialog-body">
          <h2>
            <Shield className="i" style={{ color: "var(--c-indigo)" }} /> Trust {error.host}?
          </h2>
          {tls ? (
            <p>The server's certificate isn't trusted by this Mac because {error.reason}. That's common on shared hosting. If you trust this server, Teap will remember this exact certificate.</p>
          ) : (
            <p>This is the first time Teap has connected to this server. Check the fingerprint with whoever runs it, or with <span className="code">ssh-keygen -lf</span> on the server, if you can.</p>
          )}
          <div className="fingerprint">
            <span className="label">{tls ? "Certificate SHA-256" : `${error.keyType} key fingerprint`}</span>
            {error.fingerprint}
          </div>
        </div>
        <div className="dialog-foot">
          <button type="button" className="btn ghost big" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn primary big" autoFocus>
            Trust and connect
          </button>
        </div>
      </form>
    </Dialog>
  );
}

/** chmod, as a grid of checkboxes with the octal kept in sync. */
export function PermissionsDialog({ entry, onSave, onClose }: { entry: Entry; onSave: (mode: number) => void; onClose: () => void }) {
  const [mode, setMode] = useState(modeFrom(entry.permissions) & 0o777);
  const [octal, setOctal] = useState(mode.toString(8).padStart(3, "0"));
  const setBoth = (m: number) => {
    setMode(m);
    setOctal(m.toString(8).padStart(3, "0"));
  };
  const bit = (who: number, what: number) => 1 << (8 - (who * 3 + what));
  return (
    <Dialog onClose={onClose} label="Permissions">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onClose();
          onSave(mode);
        }}
      >
        <div className="dialog-body">
          <h2>
            <Lock className="i" /> Permissions for “{entry.name}”
          </h2>
          <div className="perm-grid">
            <span />
            <span className="h">Read</span>
            <span className="h">Write</span>
            <span className="h">Execute</span>
            {["Owner", "Group", "Everyone"].map((who, w) => (
              <span key={who} style={{ display: "contents" }}>
                <span className="who">{who}</span>
                {[0, 1, 2].map((what) => {
                  const on = (mode & bit(w, what)) !== 0;
                  return (
                    <button type="button" key={what} className={`check${on ? " on" : ""}`} role="checkbox" aria-checked={on} aria-label={`${who} ${["read", "write", "execute"][what]}`} onClick={() => setBoth(mode ^ bit(w, what))}>
                      {on && <Check />}
                    </button>
                  );
                })}
              </span>
            ))}
          </div>
          <div className="field" style={{ marginTop: 16, flexDirection: "row", alignItems: "center", gap: 12 }}>
            <span className="label">Numeric</span>
            <div className="input" style={{ width: 80 }}>
              <input
                className="code"
                value={octal}
                maxLength={3}
                onChange={(e) => {
                  const v = e.target.value.replace(/[^0-7]/g, "");
                  setOctal(v);
                  if (v.length === 3) setMode(parseInt(v, 8));
                }}
              />
            </div>
            <span className="code faint">{permsFrom(mode)}</span>
          </div>
        </div>
        <div className="dialog-foot">
          <button type="button" className="btn ghost big" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn primary big">
            Apply
          </button>
        </div>
      </form>
    </Dialog>
  );
}
