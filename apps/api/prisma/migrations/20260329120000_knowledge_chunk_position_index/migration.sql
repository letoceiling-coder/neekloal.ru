-- RAG: index for ordered chunk reads per knowledge document
CREATE INDEX "knowledge_chunks_knowledge_id_position_idx" ON "knowledge_chunks"("knowledge_id", "position");
