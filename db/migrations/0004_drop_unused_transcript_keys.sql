-- chunks/topics の transcript_key は設計初期の遺物で、現在の実装では書き込みも
-- 読み出しも行われていない。job-level transcript の R2 参照は jobs.transcript_key
-- が現役で担うため、こちらは drop する。
ALTER TABLE chunks DROP COLUMN transcript_key;
ALTER TABLE topics DROP COLUMN transcript_key;
