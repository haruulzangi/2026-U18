import { Fragment } from "react";
import { REGS, type Snapshot } from "@ctf-rop/shared";

export function RegisterView({
  snap,
  prev,
}: {
  snap: Snapshot | null;
  prev: Snapshot | null;
}) {
  return (
    <div className="panel-section">
      <h3>Registers</h3>
      <div className="reg-grid">
        {REGS.map(r => {
          const v = snap?.registers[r] ?? "0x0";
          const changed = prev && prev.registers[r] !== v;
          return (
            <Fragment key={r}>
              <div className="rname">{r}</div>
              <div className={`rval${changed ? " changed" : ""}`}>{v}</div>
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}
