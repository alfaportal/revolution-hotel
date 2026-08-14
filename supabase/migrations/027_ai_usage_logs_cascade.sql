-- Siguro CASCADE kur fshihet klienti (fix për DB ku FK u krijua pa CASCADE)

ALTER TABLE ai_usage_logs
  DROP CONSTRAINT IF EXISTS ai_usage_logs_restaurant_id_fkey;

ALTER TABLE ai_usage_logs
  ADD CONSTRAINT ai_usage_logs_restaurant_id_fkey
  FOREIGN KEY (restaurant_id) REFERENCES clients(id) ON DELETE CASCADE;
