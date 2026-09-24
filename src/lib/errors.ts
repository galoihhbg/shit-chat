/**
 * Turn a Supabase/PostgREST failure into something that tells you what to
 * actually do about it.
 */

/** PostgREST codes that mean "the schema was never applied". */
const MISSING_SCHEMA = ['PGRST202', 'PGRST205', '42P01', '42883'];

export type BackendProblem = {
  message: string;
  /** True when the fix is "go run supabase/schema.sql". */
  schemaMissing: boolean;
};

export function describeBackendError(err: unknown): BackendProblem {
  const code = (err as { code?: string } | null)?.code;

  if (code && MISSING_SCHEMA.includes(code)) {
    return {
      schemaMissing: true,
      message:
        'Your Supabase project is reachable, but the tables do not exist yet.\n\n' +
        'Open the Supabase SQL Editor, paste all of supabase/schema.sql, and run it.',
    };
  }

  if (code === '42501' || code === 'PGRST301') {
    return {
      schemaMissing: false,
      message:
        'Supabase refused the request (row level security). Re-run the policy section at ' +
        'the bottom of supabase/schema.sql.',
    };
  }

  if (code === 'PGRST401' || (err as { status?: number } | null)?.status === 401) {
    return {
      schemaMissing: false,
      message: 'Supabase rejected your key. Check EXPO_PUBLIC_SUPABASE_ANON_KEY in .env.',
    };
  }

  return {
    schemaMissing: false,
    message: 'Could not reach Supabase. Check your connection and the URL in .env.',
  };
}
