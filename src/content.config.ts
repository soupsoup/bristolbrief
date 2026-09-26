import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';
import { SECTIONS, TOWNS } from './site.config';

const sectionSlugs = SECTIONS.map((s) => s.slug) as [string, ...string[]];
const townSlugs = TOWNS.map((t) => t.slug) as [string, ...string[]];

const stories = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/stories' }),
  schema: z.object({
    title: z.string(),
    dek: z.string(),
    date: z.coerce.date(),
    updated: z.coerce.date().optional(),
    author: z.string().default('Bristol Brief Staff'),
    section: z.enum(sectionSlugs),
    towns: z.array(z.enum(townSlugs)).default([]),
    image: z.string().optional(),
    imageAlt: z.string().optional(),
    featured: z.boolean().default(false),
    // Placeholder content shipped with the template. Remove before launch.
    sample: z.boolean().default(false),
    draft: z.boolean().default(false),
  }),
});

const events = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/events' }),
  schema: z.object({
    title: z.string(),
    date: z.coerce.date(),
    time: z.string().optional(),
    town: z.enum(townSlugs),
    venue: z.string(),
    cost: z.string().optional(),
    url: z.string().url().optional(),
    sample: z.boolean().default(false),
  }),
});

export const collections = { stories, events };
