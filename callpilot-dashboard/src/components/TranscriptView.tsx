"use client";

interface TranscriptEntry {
  speaker?: string;
  text: string;
  timestamp?: string;
}

export function TranscriptView({
  entries,
}: {
  entries: TranscriptEntry[];
}) {
  return (
    <div>
      {entries.length === 0 && <p>Waiting for audio...</p>}
      {entries.map((entry, i) => (
        <div key={i}>
          <strong>{entry.speaker || "Unknown"}:</strong> {entry.text}
        </div>
      ))}
    </div>
  );
}
