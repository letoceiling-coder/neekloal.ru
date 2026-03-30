-- Embedding metadata per chunk (model + dimension at ingest time)
ALTER TABLE "knowledge_chunks" ADD COLUMN "embedding_model" TEXT NOT NULL DEFAULT '';
ALTER TABLE "knowledge_chunks" ADD COLUMN "embedding_dim" INTEGER NOT NULL DEFAULT 0;
