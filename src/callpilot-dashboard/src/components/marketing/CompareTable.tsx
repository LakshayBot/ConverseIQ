// CompareTable — plain factual comparison, no library component.
// Rows are limited to claims CallPilot can stand behind; competitor
// status that isn't publicly verifiable is marked "—".

import { Check } from "lucide-react";

const ROWS: { feature: string; values: (boolean | null)[] }[] = [
  { feature: "Real-time in-call cards", values: [true, true, true, true] },
  { feature: "Local / on-device transcription", values: [true, null, null, null] },
  { feature: "Bring-your-own-LLM", values: [true, null, null, null] },
  { feature: "Self-hosted knowledge bank", values: [true, null, null, null] },
  { feature: "Open source", values: [true, null, null, null] },
];

const COLUMNS = ["CallPilot", "Gong", "Wingman", "Salesken"];

export function CompareTable() {
  return (
    <section id="compare" className="section">
      <div className="landing-container">
        <div className="section-head">
          <p className="section-eyebrow">06 — How it compares</p>
          <h2 className="section-title">Measured, not marketed</h2>
          <p className="section-sub">
            The features we list are ones we can actually stand behind. Where a
            competitor&rsquo;s status isn&rsquo;t publicly verifiable, we leave
            it blank rather than guess.
          </p>
        </div>

        <div className="compare-wrap">
          <table className="compare-table">
            <thead>
              <tr>
                <th scope="col" aria-label="Feature" />
                {COLUMNS.map((col, i) => (
                  <th key={col} scope="col" className={i === 0 ? "callpilot-col" : ""}>
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ROWS.map((row) => (
                <tr key={row.feature}>
                  <th scope="row">{row.feature}</th>
                  {row.values.map((v, i) => (
                    <td key={i} className={i === 0 ? "callpilot-col" : ""}>
                      {v === true ? (
                        <span className="check">
                          <Check className="inline h-4 w-4" strokeWidth={2.5} aria-label="Supported" />
                        </span>
                      ) : (
                        <span className="na" aria-label="Not verified">—</span>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="compare-disclaimer">
          Comparison based on publicly available information as of August 2026;
          may not reflect recent changes.
        </p>
      </div>
    </section>
  );
}
