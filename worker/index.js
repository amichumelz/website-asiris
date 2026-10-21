/**
 * Standalone Cloudflare Worker for Stripe Checkout
 * Deployable via Wrangler or directly in the Cloudflare Workers Dashboard.
 */

function toStripeParams(obj, prefix = '') {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(obj)) {
    if (value === undefined || value === null) continue;
    const paramKey = prefix ? `${prefix}[${key}]` : key;
    if (typeof value === 'object' && !Array.isArray(value)) {
      const nested = toStripeParams(value, paramKey);
      for (const [k, v] of nested.entries()) params.append(k, v);
    } else if (Array.isArray(value)) {
      value.forEach((item, index) => {
        if (typeof item === 'object') {
          const nested = toStripeParams(item, `${paramKey}[${index}]`);
          for (const [k, v] of nested.entries()) params.append(k, v);
        } else {
          params.append(`${paramKey}[${index}]`, item);
        }
      });
    } else {
      params.append(paramKey, value);
    }
  }
  return params;
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }

    const url = new URL(request.url);
    const stripeSecretKey = env.STRIPE_SECRET_KEY;

    if (!stripeSecretKey) {
      return new Response(
        JSON.stringify({
          error:
            'STRIPE_SECRET_KEY environment variable is missing. Set it in your Cloudflare dashboard under Variables and Secrets.',
        }),
        {
          status: 500,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        }
      );
    }

    // Route: Create Checkout Session
    if (url.pathname === '/api/create-checkout-session' && request.method === 'POST') {
      try {
        const data = await request.json();
        const { bookingId, customer, items, total, returnUrl } = data;

        if (!bookingId || !total) {
          return new Response(
            JSON.stringify({ error: 'Missing bookingId or total amount.' }),
            {
              status: 400,
              headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
            }
          );
        }

        const baseUrl = returnUrl || url.origin;
        const sep = baseUrl.includes('?') ? '&' : '?';
        const successUrl = `${baseUrl}${sep}session_id={CHECKOUT_SESSION_ID}&booking=${encodeURIComponent(
          bookingId
        )}&status=success`;
        const cancelUrl = `${baseUrl}${sep}booking=${encodeURIComponent(
          bookingId
        )}&status=cancelled`;

        let lineItems = [];
        if (Array.isArray(items) && items.length > 0) {
          lineItems = items.map((i) => ({
            price_data: {
              currency: 'myr',
              unit_amount: Math.round(Number(i.amount) * 100),
              product_data: {
                name: i.name || 'Transfer / Tour Package',
                description: i.details || 'Aairis Langkawi Ventures',
              },
            },
            quantity: i.quantity || 1,
          }));
        } else {
          lineItems = [
            {
              price_data: {
                currency: 'myr',
                unit_amount: Math.round(Number(total) * 100),
                product_data: {
                  name: `Aairis Langkawi Booking (${bookingId})`,
                  description: 'Private transfer & tour in Langkawi',
                },
              },
              quantity: 1,
            },
          ];
        }

        const payload = {
          mode: 'payment',
          client_reference_id: bookingId,
          customer_email: customer?.email || undefined,
          success_url: successUrl,
          cancel_url: cancelUrl,
          automatic_payment_methods: {
            enabled: 'true',
          },
          line_items: lineItems,
          metadata: {
            booking_id: bookingId,
            customer_name: customer?.name || '',
            customer_phone: customer?.phone || '',
            customer_email: customer?.email || '',
          },
        };

        const stripeParams = toStripeParams(payload);

        const stripeResponse = await fetch(
          'https://api.stripe.com/v1/checkout/sessions',
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${stripeSecretKey.trim()}`,
              'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: stripeParams.toString(),
          }
        );

        const stripeData = await stripeResponse.json();

        if (!stripeResponse.ok) {
          return new Response(
            JSON.stringify({
              error:
                stripeData.error?.message ||
                'Failed to create Stripe Checkout session.',
            }),
            {
              status: stripeResponse.status,
              headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
            }
          );
        }

        return new Response(
          JSON.stringify({
            url: stripeData.url,
            sessionId: stripeData.id,
          }),
          {
            status: 200,
            headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
          }
        );
      } catch (err) {
        return new Response(
          JSON.stringify({ error: err.message || 'Unexpected server error.' }),
          {
            status: 500,
            headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
          }
        );
      }
    }

    // Route: Verify Checkout Session
    if (url.pathname === '/api/verify-session' && request.method === 'GET') {
      const sessionId = url.searchParams.get('session_id');

      if (!sessionId) {
        return new Response(
          JSON.stringify({ error: 'Missing session_id parameter.' }),
          {
            status: 400,
            headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
          }
        );
      }

      try {
        const res = await fetch(
          `https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}`,
          {
            headers: {
              Authorization: `Bearer ${stripeSecretKey.trim()}`,
            },
          }
        );

        const session = await res.json();

        if (!res.ok) {
          return new Response(
            JSON.stringify({
              error: session.error?.message || 'Failed to retrieve session from Stripe.',
            }),
            {
              status: res.status,
              headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
            }
          );
        }

        const isPaid = session.payment_status === 'paid';

        return new Response(
          JSON.stringify({
            paid: isPaid,
            status: session.status,
            paymentStatus: session.payment_status,
            amountTotal: session.amount_total ? session.amount_total / 100 : 0,
            currency: session.currency,
            customerDetails: session.customer_details,
            metadata: session.metadata,
            clientReferenceId: session.client_reference_id,
            transactionRef: session.payment_intent || session.id,
          }),
          {
            status: 200,
            headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
          }
        );
      } catch (err) {
        return new Response(
          JSON.stringify({ error: err.message || 'Server error verifying session.' }),
          {
            status: 500,
            headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
          }
        );
      }
    }

    // Health check endpoint
    if (url.pathname === '/api/health' || url.pathname === '/') {
      return new Response(
        JSON.stringify({
          service: 'Aairis Langkawi Stripe Checkout Worker',
          status: 'ok',
          timestamp: new Date().toISOString(),
        }),
        {
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        }
      );
    }

    return new Response(JSON.stringify({ error: 'Not found' }), {
      status: 404,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  },
};
