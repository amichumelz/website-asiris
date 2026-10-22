/**
 * Cloudflare Pages Function: /api/create-checkout-session
 * Handles Stripe Checkout session creation securely using the STRIPE_SECRET_KEY environment variable.
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

export async function onRequestOptions() {
  return new Response(null, { headers: CORS_HEADERS });
}

export async function onRequestPost(context) {
  const { request, env } = context;

  // Retrieve Stripe Secret Key from Cloudflare Pages Environment Variables
  const stripeSecretKey = env.STRIPE_SECRET_KEY;
  if (!stripeSecretKey) {
    return new Response(
      JSON.stringify({
        error:
          'STRIPE_SECRET_KEY is missing. Please configure it in your Cloudflare Pages Dashboard -> Settings -> Environment Variables.',
      }),
      {
        status: 500,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      }
    );
  }

  try {
    const data = await request.json();
    const { bookingId, customer, items, total, returnUrl, paymentMethod } = data;

    if (!bookingId || !total) {
      return new Response(
        JSON.stringify({ error: 'Missing bookingId or total amount.' }),
        {
          status: 400,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        }
      );
    }

    const requestOrigin = new URL(request.url).origin;
    const baseUrl = returnUrl || requestOrigin;
    const sep = baseUrl.includes('?') ? '&' : '?';
    const successUrl = `${baseUrl}${sep}session_id={CHECKOUT_SESSION_ID}&booking=${encodeURIComponent(
      bookingId
    )}&status=success`;
    const cancelUrl = `${baseUrl}${sep}booking=${encodeURIComponent(
      bookingId
    )}&status=cancelled`;

    // Map cart items into Stripe line_items format
    let lineItems = [];
    if (Array.isArray(items) && items.length > 0) {
      lineItems = items.map((i) => ({
        price_data: {
          currency: 'myr',
          unit_amount: Math.round(Number(i.amount) * 100), // convert RM to sen
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
      payment_intent_data: customer?.email ? {
        receipt_email: customer.email,
        description: `Aairis Langkawi Booking ${bookingId}`,
      } : undefined,
      success_url: successUrl,
      cancel_url: cancelUrl,
      line_items: lineItems,
      metadata: {
        booking_id: bookingId,
        customer_name: customer?.name || '',
        customer_phone: customer?.phone || '',
        customer_email: customer?.email || '',
        selected_method: paymentMethod || 'any',
      },
    };

    if (paymentMethod === 'fpx') {
      payload.payment_method_types = ['fpx', 'card'];
    } else {
      payload.payment_method_types = ['card'];
    }

    // Call Stripe Checkout Sessions API
    let stripeResponse = await fetch(
      'https://api.stripe.com/v1/checkout/sessions',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${stripeSecretKey.trim()}`,
          'Stripe-Version': '2023-10-16',
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: toStripeParams(payload).toString(),
      }
    );

    let stripeData = await stripeResponse.json();

    // Fallback: If FPX is not activated in the merchant's Stripe Dashboard, retry with card
    if (!stripeResponse.ok && paymentMethod === 'fpx' && (stripeData.error?.message?.toLowerCase().includes('fpx') || stripeData.error?.message?.includes('payment_method_types'))) {
      payload.payment_method_types = ['card'];
      stripeResponse = await fetch(
        'https://api.stripe.com/v1/checkout/sessions',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${stripeSecretKey.trim()}`,
            'Stripe-Version': '2023-10-16',
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: toStripeParams(payload).toString(),
        }
      );
      stripeData = await stripeResponse.json();
    }

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
      JSON.stringify({
        error: err.message || 'An unexpected server error occurred.',
      }),
      {
        status: 500,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      }
    );
  }
}
