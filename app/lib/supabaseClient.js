
import { createBrowserClient } from '@supabase/ssr';

let _supabase = null;

function getSupabase() {
  if (_supabase) return _supabase;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
      'NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_ANON_KEY precisam estar configuradas.'
    );
  }

  _supabase = createBrowserClient(supabaseUrl, supabaseAnonKey);
  return _supabase;
}

// Lazy proxy: o client só é criado quando acessado em runtime (nunca no build).
export const supabase = new Proxy({}, {
  get(_target, prop) {
    return getSupabase()[prop];
  },
});
