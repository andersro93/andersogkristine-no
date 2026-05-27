import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { secureCompare, generateSessionCookie, checkRateLimit, recordFailedAttempt, resetRateLimit } from '../../services/pin';

export const POST: APIRoute = async (context) => {
  const ip = context.clientAddress || 'unknown-ip';
  const kv = env?.WEDDING_CACHE;

  try {
    // 1. Check rate limit
    const limitStatus = await checkRateLimit(ip, kv);
    if (!limitStatus.allowed) {
      const remainingTime = Math.ceil((limitStatus.lockedUntil - Date.now()) / 1000 / 60);
      return new Response(
        JSON.stringify({
          error: `For mange forsøk. Prøv igjen om ${remainingTime} minutter.`,
          locked: true,
          lockedUntil: limitStatus.lockedUntil,
        }),
        {
          status: 429,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    // 2. Parse request body
    const body = await context.request.json();
    const { pin } = body;

    if (!pin || typeof pin !== 'string') {
      return new Response(
        JSON.stringify({ error: 'PIN-kode mangler.' }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    // 3. Compare with correct PIN
    const expectedPin = env?.SITE_PIN || process.env.SITE_PIN || '1234';
    const isCorrect = secureCompare(pin.trim(), expectedPin.trim());

    if (isCorrect) {
      // Clear rate limiting on success
      await resetRateLimit(ip, kv);

      // Generate signed session cookie
      const cookieValue = generateSessionCookie(env);

      // Set cookie in Astro context
      context.cookies.set('wedding_access', cookieValue, {
        path: '/',
        httpOnly: true,
        secure: true,
        sameSite: 'strict',
        maxAge: 30 * 24 * 60 * 60, // 30 days
      });

      return new Response(
        JSON.stringify({ success: true }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    } else {
      // 4. Handle failure
      const failStatus = await recordFailedAttempt(ip, kv);
      
      // Calculate delay based on failed attempts to slow down brute force (exponential backoff)
      const failedAttempts = 5 - failStatus.attemptsRemaining;
      const delayMs = Math.min(1000 * Math.pow(2, failedAttempts), 8000);
      
      // Wait to delay responses (exponential backoff)
      await new Promise((resolve) => setTimeout(resolve, delayMs));

      if (!failStatus.allowed) {
        return new Response(
          JSON.stringify({
            error: 'Feil PIN. Du har blitt midlertidig blokkert i 15 minutter.',
            locked: true,
            attemptsRemaining: 0,
          }),
          {
            status: 403,
            headers: { 'Content-Type': 'application/json' },
          }
        );
      }

      return new Response(
        JSON.stringify({
          error: `Feil PIN-kode. Du har ${failStatus.attemptsRemaining} forsøk igjen.`,
          locked: false,
          attemptsRemaining: failStatus.attemptsRemaining,
        }),
        {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }
  } catch (error) {
    console.error('Error validating PIN:', error);
    return new Response(
      JSON.stringify({ error: 'Det oppstod en intern feil.' }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
};
