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
        const resendApiKey = env.RESEND_API_KEY || data.resendKey;
        if (resendApiKey) {
          const invoiceDate = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
          const subtotalVal = subtotal ? Number(subtotal) : (Number(total) - Number(fee || 0));
          const feeVal = fee ? Number(fee) : (Number(total) - subtotalVal);
          const totalVal = Number(total || 0);
          const subtotalFmt = 'RM' + (Number.isInteger(subtotalVal) ? subtotalVal.toFixed(0) : subtotalVal.toFixed(2));
          const feeFmt = 'RM' + (Number.isInteger(feeVal) ? feeVal.toFixed(0) : feeVal.toFixed(2));
          const totalFmt = 'RM' + (Number.isInteger(totalVal) ? totalVal.toFixed(0) : totalVal.toFixed(2));

          const itemsRows = (items || []).map((it, idx) => {
            const detailsList = Array.isArray(it.details)
              ? it.details.map((d) => `<div style="font-size:12px;color:#64748b;line-height:1.45">• ${d}</div>`).join('')
              : (it.details ? `<div style="font-size:12px;color:#64748b;line-height:1.45">${it.details}</div>` : '');
            const itemAmount = Number(it.total || it.amount || 0);
            const itemAmountFmt = 'RM' + (Number.isInteger(itemAmount) ? itemAmount.toFixed(0) : itemAmount.toFixed(2));

            return `
              <tr>
                <td style="padding:12px 14px;border-bottom:1px solid #e2e8f0;font-size:13px;color:#475569;text-align:center;vertical-align:top;width:35px">${idx + 1}</td>
                <td style="padding:12px 14px;border-bottom:1px solid #e2e8f0;vertical-align:top">
                  <strong style="font-size:14px;color:#0f172a;display:block;margin-bottom:3px">${it.name || 'Service'}</strong>
                  ${detailsList}
                </td>
                <td style="padding:12px 14px;border-bottom:1px solid #e2e8f0;font-size:13px;color:#475569;text-align:center;vertical-align:top;width:45px">${it.quantity || 1}</td>
                <td style="padding:12px 14px;border-bottom:1px solid #e2e8f0;font-size:14px;font-weight:700;color:#0f172a;text-align:right;vertical-align:top;width:95px">${itemAmountFmt}</td>
              </tr>
            `;
          }).join('');

          const htmlBody = `
            <!DOCTYPE html>
            <html lang="en">
            <head><meta charset="utf-8"></head>
            <body style="margin:0;padding:24px 12px;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1e293b">
              <div style="max-width:640px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.06);border:1px solid #e2e8f0">
                <div style="height:6px;background:linear-gradient(90deg, #00B14F 0%, #00873C 100%)"></div>
                <div style="padding:32px 28px 24px">
                  <table style="width:100%;border-collapse:collapse;margin-bottom:24px">
                    <tr>
                      <td style="vertical-align:top">
                        <h1 style="margin:0;font-size:20px;font-weight:800;color:#0f172a;letter-spacing:-0.4px">AAIRIS LANGKAWI VENTURES</h1>
                        <div style="font-size:12px;color:#64748b;margin-top:3px;font-weight:600">No. Pendaftaran SSM: <span style="color:#0f172a">LA0067158-H</span></div>
                        <div style="font-size:12px;color:#64748b;margin-top:2px">Pekan Kuah, 07000 Langkawi, Kedah Darul Aman</div>
                        <div style="font-size:12px;color:#64748b;margin-top:2px">Hotline / WhatsApp: <strong style="color:#00873C">+60 17-466 9712</strong></div>
                      </td>
                      <td style="vertical-align:top;text-align:right">
                        <div style="display:inline-block;background:#E5F7ED;color:#00873C;border:1.5px solid #00B14F;font-weight:800;font-size:11.5px;padding:4px 12px;border-radius:6px;text-transform:uppercase;letter-spacing:1px">
                          &#10003; PAID / TELAH DIBAYAR
                        </div>
                        <h2 style="margin:8px 0 2px;font-size:18px;font-weight:800;color:#0f172a">OFFICIAL RECEIPT</h2>
                        <div style="font-size:11px;font-weight:700;color:#94a3b8;letter-spacing:1px;text-transform:uppercase">TAX INVOICE</div>
                      </td>
                    </tr>
                  </table>

                  <table style="width:100%;border-collapse:collapse;background:#f8fafc;border-radius:8px;border:1px solid #e2e8f0;margin-bottom:24px">
                    <tr>
                      <td style="padding:10px 12px;border-right:1px solid #e2e8f0;width:25%">
                        <div style="font-size:10.5px;text-transform:uppercase;color:#64748b;font-weight:700;letter-spacing:0.5px">Receipt No.</div>
                        <div style="font-size:13.5px;font-weight:800;color:#0f172a;margin-top:3px">${bookingId}</div>
                      </td>
                      <td style="padding:10px 12px;border-right:1px solid #e2e8f0;width:25%">
                        <div style="font-size:10.5px;text-transform:uppercase;color:#64748b;font-weight:700;letter-spacing:0.5px">Tarikh Bayaran</div>
                        <div style="font-size:12.5px;font-weight:600;color:#0f172a;margin-top:3px">${invoiceDate}</div>
                      </td>
                      <td style="padding:10px 12px;border-right:1px solid #e2e8f0;width:25%">
                        <div style="font-size:10.5px;text-transform:uppercase;color:#64748b;font-weight:700;letter-spacing:0.5px">Kaedah Bayaran</div>
                        <div style="font-size:12.5px;font-weight:700;color:#00873C;margin-top:3px">Stripe Online</div>
                      </td>
                      <td style="padding:10px 12px;width:25%">
                        <div style="font-size:10.5px;text-transform:uppercase;color:#64748b;font-weight:700;letter-spacing:0.5px">Stripe Ref</div>
                        <div style="font-size:11.5px;font-weight:600;color:#0f172a;margin-top:3px;word-break:break-all">${transactionRef || '-'}</div>
                      </td>
                    </tr>
                  </table>

                  <table style="width:100%;border-collapse:collapse;margin-bottom:22px">
                    <tr>
                      <td style="width:50%;vertical-align:top;padding-right:12px">
                        <div style="font-size:11px;text-transform:uppercase;color:#94a3b8;font-weight:800;letter-spacing:0.5px;margin-bottom:4px">Billed To (Pelanggan)</div>
                        <div style="font-size:14.5px;font-weight:700;color:#0f172a">${customer.name}</div>
                        <div style="font-size:12.5px;color:#475569;margin-top:2px">No. Tel: <strong>${customer.phone || '-'}</strong></div>
                        <div style="font-size:12.5px;color:#475569;margin-top:2px">Emel: <strong>${customer.email}</strong></div>
                      </td>
                      <td style="width:50%;vertical-align:top;padding-left:12px">
                        <div style="font-size:11px;text-transform:uppercase;color:#94a3b8;font-weight:800;letter-spacing:0.5px;margin-bottom:4px">Dikeluarkan Oleh</div>
                        <div style="font-size:14px;font-weight:700;color:#0f172a">Aairis Langkawi Ventures</div>
                        <div style="font-size:12px;color:#475569;margin-top:2px">Pengangkutan Airport &amp; Pakej Tour Langkawi</div>
                        <div style="font-size:12px;color:#475569;margin-top:2px">Waktu Operasi: 07:00 AM – 11:00 PM Setiap Hari</div>
                      </td>
                    </tr>
                  </table>

                  <table style="width:100%;border-collapse:collapse;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;margin-bottom:20px">
                    <thead>
                      <tr style="background:#f8fafc">
                        <th style="padding:10px 14px;border-bottom:2px solid #e2e8f0;font-size:11px;font-weight:700;color:#475569;text-transform:uppercase;text-align:center">No.</th>
                        <th style="padding:10px 14px;border-bottom:2px solid #e2e8f0;font-size:11px;font-weight:700;color:#475569;text-transform:uppercase;text-align:left">Perkhidmatan &amp; Butiran Tempahan</th>
                        <th style="padding:10px 14px;border-bottom:2px solid #e2e8f0;font-size:11px;font-weight:700;color:#475569;text-transform:uppercase;text-align:center">Qty</th>
                        <th style="padding:10px 14px;border-bottom:2px solid #e2e8f0;font-size:11px;font-weight:700;color:#475569;text-transform:uppercase;text-align:right">Jumlah (RM)</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${itemsRows}
                    </tbody>
                  </table>

                  <table style="width:100%;border-collapse:collapse;margin-bottom:22px">
                    <tr>
                      <td style="width:52%;vertical-align:top;padding-right:16px">
                        ${notes ? `
                        <div style="background:#FFFBEB;border:1px solid #FDE68A;border-radius:8px;padding:12px;font-size:12px;color:#92400E">
                          <strong style="display:block;margin-bottom:2px">Nota Khas / Permintaan:</strong>
                          ${notes}
                        </div>
                        ` : `
                        <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:12px;font-size:12px;color:#64748b;line-height:1.5">
                          <strong style="color:#0f172a;display:block;margin-bottom:2px">Koordinasi Pemandu:</strong>
                          Pemandu / penyelaras kami akan berhubung terus dengan anda melalui WhatsApp sebelum waktu servis bermula.
                        </div>
                        `}
                      </td>
                      <td style="width:48%;vertical-align:top">
                        <table style="width:100%;border-collapse:collapse;font-size:13px">
                          <tr>
                            <td style="padding:5px 0;color:#64748b">Subtotal Perkhidmatan:</td>
                            <td style="padding:5px 0;text-align:right;font-weight:600;color:#0f172a">${subtotalFmt}</td>
                          </tr>
                          <tr>
                            <td style="padding:5px 0;color:#64748b">Caj Tempahan Aairis:</td>
                            <td style="padding:5px 0;text-align:right;font-weight:700;color:#00873C">FREE (RM0.00)</td>
                          </tr>
                          <tr>
                            <td style="padding:5px 0;color:#64748b">Payment Gateway Fee &amp; Tax (3% + RM1):</td>
                            <td style="padding:5px 0;text-align:right;font-weight:600;color:#0f172a">${feeFmt}</td>
                          </tr>
                          <tr>
                            <td style="padding:10px 0 4px;border-top:2px solid #0f172a;font-size:14.5px;font-weight:800;color:#0f172a">JUMLAH DIBAYAR:</td>
                            <td style="padding:10px 0 4px;border-top:2px solid #0f172a;text-align:right;font-size:18px;font-weight:800;color:#00873C">${totalFmt}</td>
                          </tr>
                          <tr>
                            <td colspan="2" style="padding-top:2px;text-align:right;font-size:11px;color:#059669;font-weight:700">
                              &#10003; Telah Dibayar Penuh (Stripe Verified)
                            </td>
                          </tr>
                        </table>
                      </td>
                    </tr>
                  </table>

                  <div style="background:#f0fdf4;border:1.5px dashed #86efac;border-radius:10px;padding:16px 20px;text-align:center;margin-bottom:22px">
                    <div style="font-size:13px;font-weight:700;color:#166534;margin-bottom:4px">Perlukan Bantuan Segera / Update Masa Pickup?</div>
                    <p style="margin:0 0 10px;font-size:12px;color:#475569">
                      Klik butang di bawah untuk berhubung terus dengan meja operasi Aairis Langkawi:
                    </p>
                    <a href="https://wa.me/60174669712?text=Hi%20Aairis%2C%20pengesahan%20tempahan%20saya%20${bookingId}" target="_blank" style="display:inline-block;background:#25D366;color:#ffffff;font-size:13px;font-weight:700;padding:10px 22px;border-radius:8px;text-decoration:none;box-shadow:0 2px 6px rgba(37,211,102,0.3)">
                      WhatsApp Operations (+60 17-466 9712)
                    </a>
                  </div>

                  <div style="border-top:1px solid #e2e8f0;padding-top:16px;text-align:center;font-size:11.5px;color:#94a3b8;line-height:1.6">
                    <div><strong>Aairis Langkawi Ventures</strong> &middot; No. Pendaftaran SSM: LA0067158-H</div>
                    <div>Ini adalah resit rasmi dan invois cukai berkomputer yang sah. Tiada tandatangan fizikal diperlukan.</div>
                    <div style="margin-top:4px">Emel ini dihantar secara automatik kepada <strong>${customer.email}</strong> dan pihak pengurusan di <strong>${ownerEmail}</strong>.</div>
                  </div>
                </div>
              </div>
            </body>
            </html>
          `;

          const isSameEmail = customer.email.trim().toLowerCase() === ownerEmail.trim().toLowerCase();
          const emailPayload = {
            from: env.EMAIL_FROM || 'Aairis Langkawi <booking@aairislangkawiventures.com>',
            to: [customer.email.trim()],
            reply_to: ownerEmail,
            subject: `Tax Invoice & Official Receipt #${bookingId} – Aairis Langkawi Ventures`,
            html: htmlBody,
          };
          if (!isSameEmail) {
            emailPayload.bcc = [ownerEmail.trim()];
          }

          const resendRes = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${resendApiKey.trim()}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(emailPayload),
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
