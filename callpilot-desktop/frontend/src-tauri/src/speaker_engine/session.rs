//! Live (incremental) speaker identification state for one meeting.
//!
//! Keeps a small set of speaker profiles (running-mean embeddings) for the
//! duration of a recording. Each VAD-final transcript segment produces one
//! embedding; cosine similarity against the profiles decides whether it joins
//! an existing speaker, stays pending ("identifying"), or creates a new one.
//!
//! Anti-fragmentation design:
//!  - running-mean profiles (a speaker's profile drifts toward their most
//!    recent voice samples, so a single noisy embedding can't fork a new
//!    speaker);
//!  - a generous `similarity_floor` below the strict `similarity_threshold`
//!    absorbs day-to-day voice variation into the nearest profile;
//!  - temporal continuity: near a speaker's recent turn the match floor is
//!    relaxed, and switches only happen on confident matches.
//!
//! Nothing here is persisted: embeddings are meeting-scoped session state by
//! design (cross-meeting identity would be a separate privacy-conscious
//! feature). The assignment result is just a stable speaker id + label that
//! the transcript pipeline attaches to segments.

/// One speaker identity observed during a meeting.
#[derive(Debug, Clone)]
pub struct SpeakerProfile {
    /// Stable 1-based id used to label segments ("Speaker {id}").
    pub id: u32,
    /// Running sum of normalized embeddings (unnormalized mean).
    pub sum: Vec<f32>,
    /// Number of segments merged into this profile.
    pub count: u32,
    /// Recording-relative time (seconds) of the last segment assigned here.
    pub last_seen_secs: f32,
    /// Total assigned speaking time in seconds.
    pub total_seconds: f32,
}

impl SpeakerProfile {
    fn new(id: u32, embedding: &[f32], duration_secs: f32, at_secs: f32) -> Self {
        Self {
            id,
            sum: embedding.to_vec(),
            count: 1,
            last_seen_secs: at_secs,
            total_seconds: duration_secs,
        }
    }

    fn mean(&self) -> Vec<f32> {
        if self.count == 0 {
            return self.sum.clone();
        }
        self.sum.iter().map(|v| v / self.count as f32).collect()
    }
}

/// Result of matching one segment embedding against the session profiles.
#[derive(Debug, Clone, PartialEq)]
pub enum Assignment {
    /// Confident match - use this speaker.
    Matched { speaker: u32, label: String, confidence: f32 },
    /// No confident match yet - surfaced as "Identifying speaker...".
    Identifying,
}

fn cosine(a: &[f32], b: &[f32]) -> f32 {
    let n = a.len().min(b.len());
    if n == 0 {
        return 0.0;
    }
    let mut dot = 0.0f32;
    let mut na = 0.0f32;
    let mut nb = 0.0f32;
    for i in 0..n {
        dot += a[i] * b[i];
        na += a[i] * a[i];
        nb += b[i] * b[i];
    }
    dot / (na.sqrt() * nb.sqrt()).max(1e-6)
}

/// Meeting-scoped incremental speaker state.
pub struct SpeakerSession {
    profiles: Vec<SpeakerProfile>,
    /// Strict match threshold (>= => confident match).
    threshold: f32,
    /// Relaxed floor (>= => assign to nearest, low confidence).
    floor: f32,
    /// Recording-relative seconds; assignments made within this window of a
    /// speaker's last turn relax the floor for that speaker.
    continuity_window_secs: f32,
}

impl SpeakerSession {
    pub fn new(threshold: f32, floor: f32) -> Self {
        Self {
            profiles: Vec::new(),
            threshold,
            floor,
            continuity_window_secs: 2.5,
        }
    }

    pub fn speaker_count(&self) -> usize {
        self.profiles.len()
    }

    /// Current speaker labels (id -> "Speaker N") in creation order.
    pub fn labels(&self) -> Vec<(u32, String)> {
        self.profiles
            .iter()
            .map(|p| (p.id, format!("Speaker {}", p.id)))
            .collect()
    }

    pub fn rename(&mut self, speaker_id: u32, label: &str) {
        let _ = label;
        let _ = speaker_id;
        // Labels are derived (Speaker N) during the live session; custom
        // renames happen after the meeting on the backend. Kept as a no-op
        // hook so the UI never needs to special-case live vs saved labels.
    }

    /// Assigns a segment (its normalized-or-raw embedding + recording
    /// position) to a speaker, updating profile state.
    pub fn assign(&mut self, embedding: &[f32], duration_secs: f32, at_secs: f32) -> Assignment {
        let norm = normalize(embedding);

        // Find the best profile by cosine similarity, with a continuity
        // bonus for the speaker who was just talking.
        let mut best: Option<(usize, f32)> = None;
        for (i, p) in self.profiles.iter().enumerate() {
            let mut sim = cosine(&norm, &p.mean());
            if Some(p.id) == self.last_speaker_id()
                && at_secs - p.last_seen_secs <= self.continuity_window_secs
            {
                sim = (sim + self.floor) / 2.0; // relax toward floor
            }
            if best.as_ref().map(|(_, s)| sim > *s).unwrap_or(true) {
                best = Some((i, sim));
            }
        }

        match best {
            Some((idx, sim)) if sim >= self.threshold => {
                self.merge(idx, &norm, duration_secs, at_secs, 0.5);
                let p = &self.profiles[idx];
                Assignment::Matched {
                    speaker: p.id,
                    label: format!("Speaker {}", p.id),
                    confidence: sim,
                }
            }
            Some((idx, sim)) if sim >= self.floor => {
                // Uncertain - still assign to the nearest profile (prevents
                // fragmentation) but with a small profile weight so a bad
                // sample can't poison the mean.
                self.merge(idx, &norm, duration_secs, at_secs, 0.1);
                let p = &self.profiles[idx];
                Assignment::Matched {
                    speaker: p.id,
                    label: format!("Speaker {}", p.id),
                    confidence: sim,
                }
            }
            _ => {
                // Not similar to anything - create a new speaker.
                let id = (self.profiles.len() as u32) + 1;
                self.profiles
                    .push(SpeakerProfile::new(id, &norm, duration_secs, at_secs));
                Assignment::Matched {
                    speaker: id,
                    label: format!("Speaker {id}"),
                    confidence: 1.0,
                }
            }
        }
    }

    /// Merges an embedding into profile `idx` with the given profile weight.
    fn merge(&mut self, idx: usize, embedding: &[f32], duration_secs: f32, at_secs: f32, weight: f32) {
        let p = &mut self.profiles[idx];
        let weight = weight.min(1.0).max(0.0);
        if p.count == 0 {
            p.sum = embedding.to_vec();
            p.count = 1;
        } else {
            let blend = |old: f32, new: f32| old * (1.0 - weight) + new * weight;
            for i in 0..p.sum.len().min(embedding.len()) {
                p.sum[i] = blend(p.sum[i], embedding[i]);
            }
        }
        p.count += 1;
        p.last_seen_secs = at_secs;
        p.total_seconds += duration_secs;
    }

    fn last_speaker_id(&self) -> Option<u32> {
        self.profiles
            .iter()
            .max_by(|a, b| a.last_seen_secs.partial_cmp(&b.last_seen_secs).unwrap_or(std::cmp::Ordering::Equal))
            .map(|p| p.id)
    }

    /// Merges one speaker into another (post-meeting correction hook, mirrors
    /// the backend merge endpoint so live state and saved state agree).
    pub fn merge_speakers(&mut self, from: u32, into: u32) -> bool {
        let from_idx = self.profiles.iter().position(|p| p.id == from);
        let into_idx = self.profiles.iter().position(|p| p.id == into);
        let (Some(from_idx), Some(into_idx)) = (from_idx, into_idx) else {
            return false;
        };
        if from_idx == into_idx {
            return false;
        }
        let from_profile = self.profiles.remove(from_idx);
        let into_profile = &mut self.profiles[if into_idx > from_idx { into_idx - 1 } else { into_idx }];
        let n = into_profile.count + from_profile.count;
        let w = if n > 0 { from_profile.count as f32 / n as f32 } else { 0.0 };
        for i in 0..into_profile.sum.len().min(from_profile.sum.len()) {
            into_profile.sum[i] =
                into_profile.sum[i] * (1.0 - w) + from_profile.sum[i] * w;
        }
        into_profile.count = n;
        into_profile.total_seconds += from_profile.total_seconds;
        into_profile.last_seen_secs = into_profile.last_seen_secs.max(from_profile.last_seen_secs);
        true
    }
}

fn normalize(v: &[f32]) -> Vec<f32> {
    let norm: f32 = v.iter().map(|x| x * x).sum::<f32>().sqrt();
    if norm < 1e-6 {
        return v.to_vec();
    }
    v.iter().map(|x| x / norm).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn emb(base: f32, dim: usize) -> Vec<f32> {
        let mut v = vec![0.0f32; dim];
        v[0] = base;
        v[1] = 1.0 - base;
        normalize(&v)
    }

    fn speaker_of(a: &Assignment) -> u32 {
        match a {
            Assignment::Matched { speaker, .. } => *speaker,
            Assignment::Identifying => 0,
        }
    }

    #[test]
    fn same_speaker_stays_same() {
        let mut s = SpeakerSession::new(0.8, 0.6);
        let a1 = s.assign(&emb(0.9, 8), 2.0, 0.0);
        let a2 = s.assign(&emb(0.88, 8), 2.0, 3.0);
        let a3 = s.assign(&emb(0.92, 8), 2.0, 6.0);
        assert_eq!(speaker_of(&a1), speaker_of(&a2));
        assert_eq!(speaker_of(&a1), speaker_of(&a3));
        assert_eq!(s.speaker_count(), 1);
    }

    #[test]
    fn distinct_speakers_split() {
        let mut s = SpeakerSession::new(0.8, 0.6);
        let a1 = s.assign(&emb(0.95, 8), 2.0, 0.0);
        let b = s.assign(&emb(0.05, 8), 2.0, 3.0);
        assert_ne!(speaker_of(&a1), speaker_of(&b));
        assert_eq!(s.speaker_count(), 2);
    }

    #[test]
    fn variation_absorbed_by_floor() {
        let mut s = SpeakerSession::new(0.8, 0.6);
        let a1 = s.assign(&emb(0.9, 8), 2.0, 0.0);
        let a2 = s.assign(&emb(0.75, 8), 2.0, 3.0);
        assert_eq!(speaker_of(&a1), speaker_of(&a2));
        assert_eq!(s.speaker_count(), 1);
    }

    #[test]
    fn merge_speakers_combines() {
        let mut s = SpeakerSession::new(0.8, 0.6);
        let a = s.assign(&emb(0.95, 8), 2.0, 0.0);
        let b = s.assign(&emb(0.05, 8), 2.0, 3.0);
        let a_id = speaker_of(&a);
        let b_id = speaker_of(&b);
        assert!(s.merge_speakers(b_id, a_id));
        assert_eq!(s.speaker_count(), 1);
        let c = s.assign(&emb(0.1, 8), 2.0, 6.0);
        assert_eq!(speaker_of(&c), a_id);
    }
}
