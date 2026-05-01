-- Add transcript_key so the two-phase pipeline can persist Whisper output to R2
-- and resume into the analyze phase without recomputing transcription.
ALTER TABLE jobs ADD COLUMN transcript_key TEXT;

-- Migrate any in-flight rows from the old single-phase status to the new
-- transcribe phase so the orchestrator picks them up cleanly. Older 'failed'
-- rows stay as-is — operators triage them manually.
UPDATE jobs SET status = 'transcribing' WHERE status = 'processing';
