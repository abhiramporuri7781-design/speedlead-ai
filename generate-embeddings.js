import OpenAI from 'openai';
import dotenv from 'dotenv';
import { supabase } from './db.js';

dotenv.config();

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

async function generateEmbeddings() {
    console.log('🔍 Finding properties without embeddings...');

    const { data: properties, error } = await supabase
        .from('properties')
        .select('*')
        .is('embedding', null);

    if (error) {
        console.error('❌ Failed to fetch properties:', error.message);
        return;
    }

    if (!properties || properties.length === 0) {
        console.log('✅ No properties need embeddings.');
        return;
    }

    console.log(`📋 Found ${properties.length} properties.`);

    for (const property of properties) {
        const text = `
Title: ${property.title || ''}
Description: ${property.description || ''}
Property Type: ${property.property_type || ''}
Price: ${property.price || ''}
Location: ${property.location || ''}
BHK: ${property.bhk || ''}
Possession Status: ${property.possession_status || ''}
`.trim();

        console.log(`\n🧠 Generating embedding for: ${property.title}`);

        try {
            const response = await openai.embeddings.create({
                model: 'text-embedding-3-small',
                input: text
            });

            const embedding = response.data[0].embedding;

            const { error: updateError } = await supabase
                .from('properties')
                .update({ embedding })
                .eq('id', property.id);

            if (updateError) {
                console.error(
                    `❌ Failed to save embedding for ${property.title}:`,
                    updateError.message
                );
                continue;
            }

            console.log(`✅ Saved embedding for: ${property.title}`);
        } catch (error) {
            console.error(
                `❌ Error generating embedding for ${property.title}:`,
                error.message
            );
        }
    }

    console.log('\n🎉 Done generating embeddings.');
}

generateEmbeddings();