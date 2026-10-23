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
  const { bookingId, customer, items, total, subtotal, fee, transactionRef, notes } = data;
  const custName = escapeHtml(customer?.name || 'Valued Customer');
  const custPhone = escapeHtml(customer?.phone || '-');
  const custEmail = escapeHtml(customer?.email || '-');
  const ref = escapeHtml(transactionRef || '-');
  const invoiceDate = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  const subtotalVal = subtotal ? Number(subtotal) : (Number(total) - Number(fee || 0));
  const feeVal = fee ? Number(fee) : (Number(total) - subtotalVal);
  const totalVal = Number(total || 0);
  const subtotalFmt = 'RM' + (Number.isInteger(subtotalVal) ? subtotalVal.toFixed(0) : subtotalVal.toFixed(2));
  const feeFmt = 'RM' + (Number.isInteger(feeVal) ? feeVal.toFixed(0) : feeVal.toFixed(2));
  const totalFmt = 'RM' + (Number.isInteger(totalVal) ? totalVal.toFixed(0) : totalVal.toFixed(2));

  const itemsRows = (items || []).map((item, idx) => {
    const detailsList = Array.isArray(item.details)
      ? item.details.map((d) => `<div style="font-size:12px;color:#64748b;line-height:1.45">• ${escapeHtml(d)}</div>`).join('')
      : (item.details ? `<div style="font-size:12px;color:#64748b;line-height:1.45">${escapeHtml(item.details)}</div>` : '');
    const itemAmount = Number(item.total || item.amount || 0);
    const itemAmountFmt = 'RM' + (Number.isInteger(itemAmount) ? itemAmount.toFixed(0) : itemAmount.toFixed(2));

    return `
      <tr>
        <td style="padding:12px 14px;border-bottom:1px solid #e2e8f0;font-size:13px;color:#475569;text-align:center;vertical-align:top;width:35px">${idx + 1}</td>
        <td style="padding:12px 14px;border-bottom:1px solid #e2e8f0;vertical-align:top">
          <strong style="font-size:14px;color:#0f172a;display:block;margin-bottom:3px">${escapeHtml(item.name || 'Service')}</strong>
          ${detailsList}
        </td>
        <td style="padding:12px 14px;border-bottom:1px solid #e2e8f0;font-size:13px;color:#475569;text-align:center;vertical-align:top;width:45px">${item.quantity || 1}</td>
        <td style="padding:12px 14px;border-bottom:1px solid #e2e8f0;font-size:14px;font-weight:700;color:#0f172a;text-align:right;vertical-align:top;width:95px">${itemAmountFmt}</td>
      </tr>
    `;
  }).join('');

  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Official Receipt #${escapeHtml(bookingId)} – Aairis Langkawi</title>
    </head>
    <body style="margin:0;padding:24px 12px;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1e293b">
      <div style="max-width:640px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.06);border:1px solid #e2e8f0">
        
        <!-- Top Green Accent Line -->
        <div style="height:6px;background:linear-gradient(90deg, #00B14F 0%, #00873C 100%)"></div>

        <div style="padding:32px 28px 24px">
          <!-- Header: Company & Receipt Meta -->
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

          <!-- 4-Column Metadata Block -->
          <table style="width:100%;border-collapse:collapse;background:#f8fafc;border-radius:8px;border:1px solid #e2e8f0;margin-bottom:24px">
            <tr>
              <td style="padding:10px 12px;border-right:1px solid #e2e8f0;width:25%">
                <div style="font-size:10.5px;text-transform:uppercase;color:#64748b;font-weight:700;letter-spacing:0.5px">Receipt No.</div>
                <div style="font-size:13.5px;font-weight:800;color:#0f172a;margin-top:3px">${escapeHtml(bookingId)}</div>
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
                <div style="font-size:11.5px;font-weight:600;color:#0f172a;margin-top:3px;word-break:break-all">${escapeHtml(ref)}</div>
              </td>
            </tr>
          </table>

          <!-- Billed To / Merchant Info -->
          <table style="width:100%;border-collapse:collapse;margin-bottom:22px">
            <tr>
              <td style="width:50%;vertical-align:top;padding-right:12px">
                <div style="font-size:11px;text-transform:uppercase;color:#94a3b8;font-weight:800;letter-spacing:0.5px;margin-bottom:4px">Billed To (Pelanggan)</div>
                <div style="font-size:14.5px;font-weight:700;color:#0f172a">${custName}</div>
                <div style="font-size:12.5px;color:#475569;margin-top:2px">No. Tel: <strong>${custPhone}</strong></div>
                <div style="font-size:12.5px;color:#475569;margin-top:2px">Emel: <strong>${custEmail}</strong></div>
              </td>
              <td style="width:50%;vertical-align:top;padding-left:12px">
                <div style="font-size:11px;text-transform:uppercase;color:#94a3b8;font-weight:800;letter-spacing:0.5px;margin-bottom:4px">Dikeluarkan Oleh</div>
                <div style="font-size:14px;font-weight:700;color:#0f172a">Aairis Langkawi Ventures</div>
                <div style="font-size:12px;color:#475569;margin-top:2px">Pengangkutan Airport &amp; Pakej Tour Langkawi</div>
                <div style="font-size:12px;color:#475569;margin-top:2px">Waktu Operasi: 07:00 AM – 11:00 PM Setiap Hari</div>
              </td>
            </tr>
          </table>

          <!-- Itemized Table -->
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

          <!-- Calculations & Total Summary -->
          <table style="width:100%;border-collapse:collapse;margin-bottom:22px">
            <tr>
              <td style="width:52%;vertical-align:top;padding-right:16px">
                ${notes ? `
                <div style="background:#FFFBEB;border:1px solid #FDE68A;border-radius:8px;padding:12px;font-size:12px;color:#92400E">
                  <strong style="display:block;margin-bottom:2px">Nota Khas / Permintaan:</strong>
                  ${escapeHtml(notes)}
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

          <!-- WhatsApp Action Box -->
          <div style="background:#f0fdf4;border:1.5px dashed #86efac;border-radius:10px;padding:16px 20px;text-align:center;margin-bottom:22px">
            <div style="font-size:13px;font-weight:700;color:#166534;margin-bottom:4px">Perlukan Bantuan Segera / Update Masa Pickup?</div>
            <p style="margin:0 0 10px;font-size:12px;color:#475569">
              Klik butang di bawah untuk berhubung terus dengan meja operasi Aairis Langkawi:
            </p>
            <a href="https://wa.me/60174669712?text=Hi%20Aairis%2C%20pengesahan%20tempahan%20saya%20${encodeURIComponent(bookingId)}" target="_blank" style="display:inline-block;background:#25D366;color:#ffffff;font-size:13px;font-weight:700;padding:10px 22px;border-radius:8px;text-decoration:none;box-shadow:0 2px 6px rgba(37,211,102,0.3)">
              WhatsApp Operations (+60 17-466 9712)
            </a>
          </div>

          <!-- Legal & Computer Generated Footer -->
          <div style="border-top:1px solid #e2e8f0;padding-top:16px;text-align:center;font-size:11.5px;color:#94a3b8;line-height:1.6">
            <div><strong>Aairis Langkawi Ventures</strong> &middot; No. Pendaftaran SSM: LA0067158-H</div>
            <div>Ini adalah resit rasmi dan invois cukai berkomputer yang sah. Tiada tandatangan fizikal diperlukan.</div>
            <div style="margin-top:4px">Emel ini dihantar secara automatik kepada <strong>${custEmail}</strong> dan pihak pengurusan di <strong>${escapeHtml(ownerEmail)}</strong>.</div>
          </div>

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
    const { bookingId, customer, items, total, subtotal, fee, transactionRef, notes, textSummary, ownerEmail: clientOwnerEmail } = data;

    if (!bookingId || !customer?.email) {
      return new Response(
        JSON.stringify({ error: 'Missing bookingId or customer email.' }),
        { status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
      );
    }

    const ownerEmail = env.OWNER_EMAIL || clientOwnerEmail || 'muhammadasyrafmusa93@gmail.com';
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
