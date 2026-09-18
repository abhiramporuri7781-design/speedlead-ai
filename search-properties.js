import OpenAI from 'openai';
import dotenv from 'dotenv';
import { supabase } from './db.js';

dotenv.config();

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

async function searchProperties() {
    const question = "Tell me about the property in Gachibowli";

    console.log(`🔎 Customer question: ${question}`);

    // 1. Convert customer question into an embedding
    const embeddingResponse = await openai.embeddings.create({
        model: 'text-embedding-3-small',
        input: question
    });

    const queryEmbedding = embeddingResponse.data[0].embedding;

    console.log('🧠 Query embedding generated.');

    // 2. Retrieve relevant properties from Supabase
    const { data: properties, error } = await supabase.rpc(
        'match_properties',
        {
            query_embedding: queryEmbedding,
            match_threshold: 0.0,
            match_count: 4
        }
    );

    if (error) {
        console.error('❌ Property search failed:', error.message);
        return;
    }

    console.log(`🏠 Retrieved ${properties.length} properties.`);

    // 3. Give the retrieved information to GPT
    const context = properties
        .map(property => `
Property:
Title: ${property.title}
Description: ${property.description}
Type: ${property.property_type}
Price: ₹${property.price}
Location: ${property.location}
BHK: ${property.bhk}
Possession: ${property.possession_status}
`)
        .join('\n');

    const completion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        temperature: 0.2,
        messages: [
            {
                role: 'system',
                content: `
You are a helpful real-estate sales assistant.

Answer the customer's question using ONLY the property information provided below.

If the information is not available, say that you don't have that information.

Do not invent prices, locations, amenities, or other property details.

Keep the response natural and concise.
`
            },
            {
                role: 'user',
                content: `
Customer question:
${question}

Available property information:
${context}

Answer the customer.
`
            }
        ]
    });

    const answer = completion.choices[0].message.content;

    console.log('\n🤖 GPT RESPONSE:\n');
    console.log(answer);
}

searchProperties();