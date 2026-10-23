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
        const { bookingId, customer, items, total, fee, subtotal, returnUrl, paymentMethod } = data;

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
                unit_amount: Math.round(Number(subtotal || total) * 100),
                product_data: {
                  name: `Aairis Langkawi Booking (${bookingId})`,
                  description: 'Private transfer & tour in Langkawi',
                },
              },
              quantity: 1,
            },
          ];
        }

        // Add Stripe Payment Gateway Fee & Tax line item
        if (fee && Number(fee) > 0) {
          lineItems.push({
            price_data: {
              currency: 'myr',
              unit_amount: Math.round(Number(fee) * 100),
              product_data: {
                name: 'Payment Gateway Fee & Tax (Stripe 3% + RM1)',
                description: 'Online payment transaction fee & tax',
              },
            },
            quantity: 1,
          });
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
            subtotal: String(subtotal || ''),
            fee: String(fee || ''),
            total: String(total || ''),
          },
        };

        if (paymentMethod === 'fpx') {
          payload.payment_method_types = ['fpx', 'card'];
        } else {
          payload.payment_method_types = ['card'];
        }

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
              'Stripe-Version': '2023-10-16',
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

    // Route: Send Booking Confirmation Email to Customer and Owner
    if (url.pathname === '/api/send-confirmation' && request.method === 'POST') {
      try {
        const data = await request.json();
        const { bookingId, customer, items, total, subtotal, fee, transactionRef, notes, textSummary, ownerEmail: clientOwnerEmail } = data;

        if (!bookingId || !customer?.email) {
          return new Response(
            JSON.stringify({ error: 'Missing bookingId or customer email.' }),
            { status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
          );
        }

        const ownerEmail = env.OWNER_EMAIL || clientOwnerEmail || 'muhammadasyrafmusa93@gmail.com';
        const emailResults = { customer: false, owner: false, provider: null };

        // Method 1: Resend API
        const resendApiKey = env.RESEND_API_KEY;
        if (resendApiKey) {
          const itemsList = (items || []).map((it, idx) => `
            <div style="border:1px solid #e5e7eb;border-radius:10px;padding:12px;margin-bottom:10px;background:#fff">
              <b style="color:#111827">${idx+1}. ${it.name || 'Service'} - RM${Number(it.total||it.amount||0).toFixed(0)}</b>
              <p style="color:#6b7280;font-size:13px;margin:4px 0 0">${Array.isArray(it.details)?it.details.join(' · '):(it.details||'')}</p>
            </div>
          `).join('');

          const htmlBody = `
            <div style="font-family:sans-serif;max-width:600px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 16px rgba(0,0,0,0.06)">
              <div style="background:#00B14F;padding:24px;text-align:center;color:#fff">
                <h1 style="margin:0;font-size:22px">Aairis Langkawi Ventures</h1>
                <p style="margin:4px 0 0;font-size:13px;opacity:0.9">Booking Confirmation</p>
              </div>
              <div style="padding:24px">
                <p style="font-size:16px">Thank you, <b>${customer.name}</b>! Your booking <b>#${bookingId}</b> has been received and confirmed.</p>
                <div style="background:#f9fafb;border-radius:12px;padding:14px;margin:16px 0;font-size:14px">
                  ${subtotal ? `<p style="margin:4px 0"><b>Subtotal:</b> RM${Number(subtotal).toFixed(2)}</p>` : ''}
                  ${fee ? `<p style="margin:4px 0"><b>Gateway Fee &amp; Tax:</b> RM${Number(fee).toFixed(2)}</p>` : ''}
                  <p style="margin:4px 0"><b>Total Paid:</b> RM${Number(total||0).toFixed(2)} (via Stripe)</p>
                  <p style="margin:4px 0"><b>Stripe Ref:</b> ${transactionRef || '-'}</p>
                  <p style="margin:4px 0"><b>Customer Phone:</b> ${customer.phone || '-'}</p>
                  <p style="margin:4px 0"><b>Customer Email:</b> ${customer.email}</p>
                </div>
                <h3>Booked Services</h3>
                ${itemsList}
                ${notes ? `<p style="background:#FFFBEB;padding:12px;border-radius:8px"><b>Notes:</b> ${notes}</p>` : ''}
                <div style="text-align:center;margin-top:20px;padding-top:16px;border-top:1px solid #eee">
                  <a href="https://wa.me/60174669712?text=Hi%2C%20enquiry%20about%20booking%20${encodeURIComponent(bookingId)}" style="display:inline-block;background:#25D366;color:#fff;font-weight:700;font-size:14px;padding:12px 20px;border-radius:10px;text-decoration:none">
                    WhatsApp Operations (+60 17-466 9712)
                  </a>
                </div>
              </div>
            </div>
          `;

          const resendRes = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${resendApiKey.trim()}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              from: env.EMAIL_FROM || 'Aairis Langkawi <onboarding@resend.dev>',
              to: [customer.email],
              bcc: [ownerEmail],
              subject: `Booking Confirmed #${bookingId} – Aairis Langkawi Venture`,
              html: htmlBody,
            }),
          });
          if (resendRes.ok) {
            emailResults.customer = true;
            emailResults.owner = true;
            emailResults.provider = 'resend';
          }
        }

        // Method 2: Web3Forms
        const web3formsKey = env.WEB3FORMS_KEY || data.web3formsKey;
        if (web3formsKey) {
          const summary = textSummary || `NEW PAID BOOKING ${bookingId}\nAmount: RM${total}\nCustomer: ${customer.name}\nPhone: ${customer.phone}\nEmail: ${customer.email}\nStripe Ref: ${transactionRef}`;
          try {
            const wRes = await fetch('https://api.web3forms.com/submit', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
              body: JSON.stringify({
                access_key: web3formsKey,
                subject: `New Paid Booking ${bookingId} – RM${total} (Stripe)`,
                from_name: 'Aairis Langkawi Website',
                name: customer.name,
                email: customer.email,
                replyto: customer.email,
                message: summary,
              }),
            });
            const wData = await wRes.json();
            if (wData.success) {
              emailResults.owner = true;
              if (!emailResults.provider) emailResults.provider = 'web3forms';
            }
          } catch (err) {}
        }

        return new Response(
          JSON.stringify({ success: true, sent: emailResults }),
          { status: 200, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
        );
      } catch (err) {
        return new Response(
          JSON.stringify({ error: err.message || 'Server error.' }),
          { status: 500, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
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
