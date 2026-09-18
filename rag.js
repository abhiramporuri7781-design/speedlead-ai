import OpenAI from 'openai';
import dotenv from 'dotenv';
import { supabase } from './db.js';

dotenv.config();

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

export async function searchKnowledge(question) {
    try {
        // 1. Convert the customer's question into an embedding
        const embeddingResponse = await openai.embeddings.create({
            model: 'text-embedding-3-small',
            input: question
        });

        const queryEmbedding = embeddingResponse.data[0].embedding;

        // 2. Search Supabase
        const { data: properties, error } = await supabase.rpc(
            'match_properties',
            {
                query_embedding: queryEmbedding,
                match_threshold: 0.45,
                match_count: 4
            }
        );

        if (error) {
            console.error('❌ RAG search failed:', error.message);
            return [];
        }

        return properties || [];

    } catch (error) {
        console.error('❌ RAG error:', error.message);
        return [];
    }
}