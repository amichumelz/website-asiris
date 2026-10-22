/**
 * Cloudflare Pages Function: /api/send-confirmation
 * Sends booking confirmation email to BOTH the customer and the owner.
 * Supports Resend API (recommended) and Web3Forms.
 */

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export async function onRequestOptions() {
  return new Response(null, { headers: CORS_HEADERS });
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildHtmlEmail(data, ownerEmail) {
  const { bookingId, customer, items, total, transactionRef, notes } = data;
  const custName = escapeHtml(customer?.name || 'Valued Customer');
  const custPhone = escapeHtml(customer?.phone || '-');
  const custEmail = escapeHtml(customer?.email || '-');
  const ref = escapeHtml(transactionRef || '-');
  const totalFmt = 'RM' + Number(total || 0).toFixed(0);

  const itemsHtml = (items || [])
    .map((item, idx) => {
      const detailsList = Array.isArray(item.details)
        ? item.details.map((d) => `<li style="margin:2px 0;color:#555;font-size:13px">${escapeHtml(d)}</li>`).join('')
        : `<li style="margin:2px 0;color:#555;font-size:13px">${escapeHtml(item.details || '')}</li>`;

      return `
        <div style="border:1px solid #e5e7eb;border-radius:10px;padding:14px;margin-bottom:12px;background:#ffffff">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
            <b style="font-size:15px;color:#111827">${idx + 1}. ${escapeHtml(item.name || 'Service')}</b>
            <span style="font-weight:700;color:#00873C;font-size:15px">RM${Number(item.total || item.amount || 0).toFixed(0)}</span>
          </div>
          <ul style="margin:4px 0 0;padding-left:18px">
            ${detailsList}
          </ul>
        </div>
      `;
    })
    .join('');

  return `
    <!DOCTYPE html>
    <html>
    <head><meta charset="utf-8"></head>
    <body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;background:#f3f4f6;margin:0;padding:24px;color:#1f2937">
      <div style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 16px rgba(0,0,0,0.06)">
        <div style="background:#00B14F;padding:28px 24px;text-align:center;color:#ffffff">
          <h1 style="margin:0;font-size:22px;letter-spacing:-0.5px">Aairis Langkawi Ventures</h1>
          <p style="margin:6px 0 0;font-size:13px;opacity:0.9">Transfers &amp; Tours in Langkawi</p>
        </div>

        <div style="padding:24px">
          <div style="text-align:center;margin-bottom:20px">
            <span style="display:inline-block;background:#E5F7ED;color:#00873C;font-weight:700;font-size:12px;padding:5px 12px;border-radius:99px;text-transform:uppercase;letter-spacing:0.5px">Paid &amp; Confirmed</span>
            <h2 style="margin:10px 0 4px;font-size:20px;color:#111827">Booking Confirmation</h2>
            <p style="margin:0;font-size:14px;color:#6b7280">Reference: <strong style="color:#111827">${escapeHtml(bookingId)}</strong></p>
          </div>

          <div style="background:#f9fafb;border-radius:12px;padding:16px;margin-bottom:20px;font-size:13px">
            <table style="width:100%;border-collapse:collapse">
              <tr>
                <td style="padding:4px 0;color:#6b7280">Customer Name:</td>
                <td style="padding:4px 0;text-align:right;font-weight:600;color:#111827">${custName}</td>
              </tr>
              <tr>
                <td style="padding:4px 0;color:#6b7280">Phone / WhatsApp:</td>
                <td style="padding:4px 0;text-align:right;font-weight:600;color:#111827">${custPhone}</td>
              </tr>
              <tr>
                <td style="padding:4px 0;color:#6b7280">Email:</td>
                <td style="padding:4px 0;text-align:right;font-weight:600;color:#111827">${custEmail}</td>
              </tr>
              <tr>
                <td style="padding:4px 0;color:#6b7280">Payment Method:</td>
                <td style="padding:4px 0;text-align:right;font-weight:600;color:#00873C">Stripe Online (Paid)</td>
              </tr>
              <tr>
                <td style="padding:4px 0;color:#6b7280">Stripe Ref:</td>
                <td style="padding:4px 0;text-align:right;font-weight:600;color:#111827">${ref}</td>
              </tr>
              <tr>
                <td style="padding:4px 0;color:#6b7280;font-size:15px;font-weight:700">Total Paid:</td>
                <td style="padding:4px 0;text-align:right;font-size:17px;font-weight:800;color:#00873C">${totalFmt}</td>
              </tr>
            </table>
          </div>

          <h3 style="font-size:15px;margin:16px 0 10px;color:#111827">Booked Services</h3>
          ${itemsHtml}

          ${
            notes
              ? `<div style="background:#FFFBEB;border:1px solid #FDE68A;border-radius:10px;padding:12px;margin:16px 0;font-size:13px;color:#92400E">
                  <b>Special Notes:</b> ${escapeHtml(notes)}
                </div>`
              : ''
          }

          <div style="text-align:center;margin-top:24px;padding-top:20px;border-top:1px solid #e5e7eb">
            <p style="margin:0 0 12px;font-size:13px;color:#6b7280">
              Need to coordinate pickup or make changes? Connect directly with our Langkawi operations desk on WhatsApp:
            </p>
            <a href="https://wa.me/60174669712?text=Hi%2C%20enquiry%20about%20booking%20${encodeURIComponent(bookingId)}" style="display:inline-block;background:#25D366;color:#ffffff;font-weight:700;font-size:14px;padding:12px 24px;border-radius:10px;text-decoration:none">
              WhatsApp Operations (+60 17-466 9712)
            </a>
          </div>
        </div>

        <div style="background:#f9fafb;padding:16px;text-align:center;font-size:12px;color:#9ca3af;border-top:1px solid #e5e7eb">
          Aairis Langkawi Ventures &middot; Langkawi, Kedah, Malaysia<br>
          This is an automated confirmation sent to ${custEmail} and ${escapeHtml(ownerEmail)}.
        </div>
      </div>
    </body>
    </html>
  `;
}

export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    const data = await request.json();
    const { bookingId, customer, items, total, transactionRef, notes, textSummary } = data;

    if (!bookingId || !customer?.email) {
      return new Response(
        JSON.stringify({ error: 'Missing bookingId or customer email.' }),
        { status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
      );
    }

    const ownerEmail = env.OWNER_EMAIL || 'aairisventure@gmail.com';
    const emailResults = { customer: false, owner: false, provider: null };

    // Method 1: Resend API (Sends rich HTML email directly to customer AND owner in one request)
    const resendApiKey = env.RESEND_API_KEY;
    if (resendApiKey) {
      const htmlContent = buildHtmlEmail(data, ownerEmail);
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
          html: htmlContent,
        }),
      });

      const resendData = await resendRes.json();
      if (resendRes.ok) {
        emailResults.customer = true;
        emailResults.owner = true;
        emailResults.provider = 'resend';
      } else {
        console.warn('Resend send failed:', resendData);
      }
    }

    // Method 2: Web3Forms (Backup / notification to owner)
    const web3formsKey = env.WEB3FORMS_KEY || data.web3formsKey;
    if (web3formsKey) {
      const summary = textSummary || `NEW PAID BOOKING ${bookingId}\nAmount: RM${total}\nCustomer: ${customer.name}\nPhone: ${customer.phone}\nEmail: ${customer.email}\nStripe Ref: ${transactionRef}\n\n${JSON.stringify(items, null, 2)}`;
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
      } catch (err) {
        console.warn('Web3Forms send failed:', err);
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        sent: emailResults,
        message: 'Confirmation processing complete.',
      }),
      { status: 200, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message || 'Server error processing confirmation.' }),
      { status: 500, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
    );
  }
}
