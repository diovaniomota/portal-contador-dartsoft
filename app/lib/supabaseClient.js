
import { createBrowserClient } from '@supabase/ssr';

let _supabase = null;

function getSupabase() {
  if (_supabase) return _supabase;

  // Se as variáveis de ambiente não estiverem configuradas (ex: durante o build na nuvem),
  // usamos placeholders para evitar crash de compilação.
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co';
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder-anon-key';

  _supabase = createBrowserClient(supabaseUrl, supabaseAnonKey);
  return _supabase;
}

// Lazy proxy: o client só é criado quando acessado em runtime (nunca no build).
export const supabase = new Proxy({}, {
  get(_target, prop) {
    const client = getSupabase();
    const value = client[prop];
    if (typeof value === 'function') {
      return value.bind(client);
    }
    return value;
  },
});
