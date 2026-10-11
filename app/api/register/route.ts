import { NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { normalize, idTypeFor, validate, restrictionMessage, CONDITIONS_ERROR } from '@/lib/validation';
import { parsePhone } from '@/lib/phone';
import { sendOutboxRow } from '@/lib/mailer';

// Nodemailer needs Node, not the edge runtime.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** What register_visitor returns when a rule says no. */
interface RpcResult {
  ok: boolean;
  code?: string;
  outboxId?: string;
  error?: string;
  field?: string;
  tourName?: string;
  restricted?: string[];
  tourDate?: string;
  idType?: string;
}

/** The typed errors from the RPC, in the wording the form has always shown. */
function describe(r: RpcResult): { status: number; field?: string; message: string } {
  switch (r.error) {
    case 'tour_missing':
      return { status: 404, field: 'tourId', message: 'This tour no longer exists. Choose another tour.' };
    case 'tour_closed':
      return { status: 409, field: 'tourId', message: 'Registration for this tour is closed. Choose another tour.' };
    case 'tour_full':
      return { status: 409, field: 'tourId', message: 'This tour is full. Choose another tour.' };
    case 'nationality_restricted':
      return {
        status: 409, field: 'nationality',
        message: restrictionMessage({ name: r.tourName, restrictedNationalities: r.restricted ?? [] }),
      };
    case 'conditions_required':
      return { status: 400, field: 'acceptedConditions', message: CONDITIONS_ERROR };
    case 'wrong_date':
      return { status: 409, field: 'tourDate', message: `This tour runs on ${r.tourDate}. Choose that date.` };
    case 'duplicate_id': {
      const what = r.idType === 'national_id' ? 'National ID' : 'passport';
      return { status: 409, field: 'idNumber', message: `This ${what} is already registered for this tour on this date.` };
    }
    default:
      return { status: 500, message: 'Registration could not be saved. Try again in a moment.' };
  }
}

export async function POST(req: Request) {
  // A short id ties the visitor's error message to the server log, without leaking
  // anything about what actually went wrong.
  const errorId = randomUUID().slice(0, 8);

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object')
    return NextResponse.json({ message: 'The form could not be read. Reload the page and try again.' }, { status: 400 });

  const input = normalize(body);
  const errors = validate(input);
  if (Object.keys(errors).length) return NextResponse.json({ errors }, { status: 400 });

  // The server decides which document was asked for; the client's claim is ignored.
  const idType = idTypeFor(input.nationality);
  // validate() already proved this parses.
  const phone = parsePhone(input.phone, input.phoneCountry)!;

  try {
    const db = supabaseAdmin();

    // One transaction inside Postgres: the tour row is locked, every rule is checked,
    // the seat is taken and the confirmation is queued. Two people can't take the
    // last seat because the lock serialises them.
    const { data, error } = await db.rpc('register_visitor' as never, {
      p_name: input.name,
      p_email: input.email,
      p_phone: phone.e164,
      p_phone_country: phone.country,
      p_id_type: idType,
      p_id_number: input.idNumber,
      p_nationality: input.nationality,
      p_tour_id: input.tourId,
      p_tour_date: input.tourDate,
      p_accepted_conditions: input.acceptedConditions,
    } as never);

    if (error) throw error;

    const result = data as unknown as RpcResult;
    if (!result?.ok) {
      const { status, field, message } = describe(result ?? {});
      if (status === 500) console.error(`[register ${errorId}] unexpected RPC result`, result);
      const payload = field ? { message, errors: { [field]: message } } : { message, errorId };
      return NextResponse.json(payload, { status });
    }

    // Delivery is deliberately outside the transaction: a booking must not fail
    // because an SMTP server is down. The outbox row is already committed, so
    // /api/outbox/retry can pick it up later.
    if (result.outboxId) {
      try {
        const outcome = await sendOutboxRow(result.outboxId);
        if (outcome.status === 'failed') {
          console.warn(`[register ${errorId}] confirmation not sent for ${result.code}: ${outcome.error}`);
        }
      } catch (mailErr) {
        console.warn(`[register ${errorId}] confirmation threw for ${result.code}`, mailErr);
      }
    }

    return NextResponse.json({ code: result.code }, { status: 201 });
  } catch (e) {
    // Full detail to the server log, an id to the visitor. This is what was missing
    // when a quota error made every registration fail with no trace.
    console.error(`[register ${errorId}] failed`, e);
    return NextResponse.json(
      {
        message: 'Registration could not be saved. Try again in a moment.',
        errorId,
      },
      { status: 500 }
    );
  }
}
