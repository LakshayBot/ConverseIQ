"""Render the Secure Meters sales call script into a two-voice audio file.

Pipeline:
  1. Parse samples/sales-call-script-secure.txt into ordered (speaker, text) turns.
  2. Render each turn to a per-turn AIFF with macOS `say` using two distinct voices
     (Daniel for the seller Raj, Samantha for the buyer Priya).
  3. Concatenate the per-turn clips with a short silence gap between turns
     and encode the result to mp3 via ffmpeg, ready for the transcription pipeline.

Output:
  samples/audio_files_samples/sales_call_turns/turn_NN_<speaker>.aiff
  samples/audio_files_samples/sales-call-secure.mp3
"""

from __future__ import annotations

import re
import shutil
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

SCRIPT_PATH = Path(__file__).resolve().parent / "sales-call-script-secure.txt"
TURN_DIR = Path(__file__).resolve().parent / "audio_files_samples" / "sales_call_turns"
OUTPUT_MP3 = Path(__file__).resolve().parent / "audio_files_samples" / "sales-call-secure.mp3"

# Voice pairing — keep them clearly distinguishable so the STT diarization step
# has a fair shot at separating Raj (seller) from Priya (buyer).
SELLER_VOICE = "Daniel"     # en_GB — male
BUYER_VOICE = "Samantha"    # en_US — female
RATE = 185                  # words per minute; slightly slower than default for clarity
GAP_SECONDS = 0.45          # silence between turns


@dataclass
class Turn:
    speaker: str  # "SELLER" or "BUYER"
    text: str


def parse_script(path: Path) -> list[Turn]:
    """Walk the script and emit one Turn per non-empty paragraph.

    Paragraphs beginning with SELLER: / BUYER: are speaker turns; everything
    else (header, dividers, blank lines) is dropped.
    """
    raw = path.read_text(encoding="utf-8")
    turns: list[Turn] = []
    for block in re.split(r"\n\s*\n", raw):
        block = block.strip()
        if not block:
            continue
        first_line, _, rest = block.partition("\n")
        first_line = first_line.strip()
        if first_line.startswith("SELLER"):
            speaker = "SELLER"
            text = rest.strip() or first_line.split(":", 1)[1].strip()
        elif first_line.startswith("BUYER"):
            speaker = "BUYER"
            text = rest.strip() or first_line.split(":", 1)[1].strip()
        else:
            # Header / metadata block — skip
            continue
        # Collapse internal whitespace so `say` doesn't pause weirdly on newlines.
        text = re.sub(r"\s+", " ", text).strip()
        if text:
            turns.append(Turn(speaker=speaker, text=text))
    return turns


def voice_for(speaker: str) -> str:
    return SELLER_VOICE if speaker == "SELLER" else BUYER_VOICE


def render_turns(turns: list[Turn], out_dir: Path) -> list[Path]:
    """Invoke `say` once per turn, writing AIFF files in the out_dir."""
    out_dir.mkdir(parents=True, exist_ok=True)
    rendered: list[Path] = []
    for idx, turn in enumerate(turns, start=1):
        aiff = out_dir / f"turn_{idx:02d}_{turn.speaker.lower()}.aiff"
        cmd = [
            "say",
            "-v", voice_for(turn.speaker),
            "-r", str(RATE),
            "-o", str(aiff),
            "--file-format=AIFF",
            turn.text,
        ]
        subprocess.run(cmd, check=True)
        rendered.append(aiff)
    return rendered


def make_silence(out_path: Path, gap_seconds: float) -> Path:
    """Render a short silent AIFF to use as an inter-turn gap.

    The concat *demuxer* can't trim a `lavfi` source on the fly, so we materialize
    one gap file and reuse it between every turn.
    """
    cmd = [
        "ffmpeg", "-y", "-loglevel", "error",
        "-f", "lavfi", "-i", "anullsrc=cl=mono:r=22050",
        "-t", f"{gap_seconds:.3f}",
        str(out_path),
    ]
    subprocess.run(cmd, check=True)
    return out_path


def build_concat_list(clips: list[Path], silence: Path, list_file: Path) -> None:
    """Write an ffmpeg concat demuxer list interleaving clips and the gap file."""
    lines: list[str] = []
    for i, clip in enumerate(clips):
        lines.append(f"file '{clip.as_posix()}'")
        if i != len(clips) - 1:
            lines.append(f"file '{silence.as_posix()}'")
    list_file.write_text("\n".join(lines) + "\n", encoding="utf-8")


def stitch_mp3(clips: list[Path], mp3_out: Path, gap_seconds: float) -> None:
    """Concatenate clips (with silent gaps) and encode to mp3 at 44.1 kHz mono."""
    if shutil.which("ffmpeg") is None:
        sys.exit("ffmpeg is required but not on PATH")
    silence = mp3_out.with_name(f"{mp3_out.stem}.gap.aiff")
    make_silence(silence, gap_seconds)
    list_file = mp3_out.with_suffix(".concat.txt")
    build_concat_list(clips, silence, list_file)
    cmd = [
        "ffmpeg", "-y", "-loglevel", "error",
        "-f", "concat", "-safe", "0", "-i", str(list_file),
        "-ar", "44100", "-ac", "1",
        "-codec:a", "libmp3lame", "-q:a", "4",
        str(mp3_out),
    ]
    subprocess.run(cmd, check=True)


def main() -> int:
    if not SCRIPT_PATH.exists():
        sys.exit(f"Script not found: {SCRIPT_PATH}")
    turns = parse_script(SCRIPT_PATH)
    print(f"Parsed {len(turns)} turns from {SCRIPT_PATH.name}")
    clips = render_turns(turns, TURN_DIR)
    print(f"Rendered {len(clips)} per-turn AIFF files into {TURN_DIR}")
    stitch_mp3(clips, OUTPUT_MP3, GAP_SECONDS)
    print(f"Wrote final mp3: {OUTPUT_MP3}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
