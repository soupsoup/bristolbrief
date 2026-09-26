import type { APIRoute } from 'astro';
import { checkPassword, createSession } from '../../../lib/admin/auth';

export const prerender = false;

const safeNext = (v: FormDataEntryValue | null) => {
  const s = typeof v === 'string' ? v : '';
  return s.startsWith('/admin') && !s.startsWith('//') ? s : '/admin/';
};

export const POST: APIRoute = async ({ request, cookies, redirect, url }) => {
  const form = await request.formData();
  const next = safeNext(form.get('next'));
  if (!checkPassword(String(form.get('password') ?? ''))) {
    // Slow down guessing.
    await new Promise((r) => setTimeout(r, 800));
    return redirect(`/admin/login/?error=1&next=${encodeURIComponent(next)}`, 303);
  }
  createSession(cookies, url.protocol === 'https:');
  return redirect(next, 303);
};
