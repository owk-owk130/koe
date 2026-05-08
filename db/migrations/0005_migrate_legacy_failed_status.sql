-- 単相処理時代の 'failed' ステータスを廃止する。失敗理由が transcribe /
-- analyze のどちらに起因するか後付けで判別できないため、統一的に
-- 'transcribe_failed' として扱う（元 audio_key を保持しているので transcribe
-- phase の再実行で復旧できる）。
-- これにより JobStatus 型から 'failed' を除外しても DB 上に該当行が残らない。
UPDATE jobs SET status = 'transcribe_failed' WHERE status = 'failed';
