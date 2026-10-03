import OpenAI from 'openai';
import dotenv from 'dotenv';

import { supabase } from './db.js';

dotenv.config();

const openai = new OpenAI();

// IMPORTANT: this must be the SAME model that generate-embeddings.js uses
// to create the stored embeddings, or the search results will be wrong.
const EMBEDDING_MODEL =
    process.env.EMBEDDING_MODEL || 'text-embedding-3-small';

const MAX_RESULTS = 5;
const BUDGET_TOLERANCE = 1.15; // allow up to 15% over the stated budget

async function embedQuery(text) {
    const response = await openai.embeddings.create({
        model: EMBEDDING_MODEL,
        input: text
    });

    return response.data[0].embedding;
}

async function runMatch(embedding, businessId, count, propertyType, maxPrice) {
    const { data, error } = await supabase.rpc('match_properties_v2', {
        query_embedding: embedding,
        match_business_id: businessId,
        match_count: count,
        filter_property_type: propertyType,
        max_price: maxPrice
    });

    if (error) {
        console.error('❌ match_properties_v2 error:', error.message);
        return [];
    }

    return data || [];
}

/**
 * Search properties for ONE business only.
 *
 * Pass 1 (strict): properties that match the customer's property type and budget.
 * Pass 2 (loose): the closest properties for this business with no filters,
 * so the bot can honestly say "no villa there, but here is the closest option".
 * Strict matches always come first.
 */
export async function searchKnowledge(
    query,
    { businessId, propertyType = null, budget = null } = {}
) {
    if (!businessId) {
        // Never search without a business: that would mix clients' data.
        throw new Error('searchKnowledge requires a businessId');
    }

    const embedding = await embedQuery(query);

    const budgetNumber = Number(budget);
    const maxPrice =
        Number.isFinite(budgetNumber) && budgetNumber > 0
            ? budgetNumber * BUDGET_TOLERANCE
            : null;

    const strict =
        propertyType || maxPrice
            ? await runMatch(embedding, businessId, MAX_RESULTS, propertyType, maxPrice)
            : [];

    const loose = await runMatch(embedding, businessId, MAX_RESULTS, null, null);

    const seen = new Set();
    const merged = [];

    for (const property of [...strict, ...loose]) {
        if (!seen.has(property.id)) {
            seen.add(property.id);
            merged.push(property);
        }
    }

    return merged.slice(0, MAX_RESULTS);
}