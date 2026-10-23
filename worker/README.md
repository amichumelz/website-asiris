# Stripe Checkout Backend for Aairis Langkawi Ventures

This project supports **two ways** to run your secure Stripe Checkout backend on Cloudflare:

---

### Option 1 (Recommended & Default): Built-in Cloudflare Pages Functions
Because your website is hosted on **Cloudflare Pages**, you **do not need a separate Worker deployment**!

1. Cloudflare Pages automatically detects the files in `functions/api/`:
   - `functions/api/create-checkout-session.js`
   - `functions/api/verify-session.js`
   - `functions/api/send-confirmation.js`
2. Go to your **Cloudflare Dashboard**:
   - Navigate to **Workers & Pages** -> select your Pages project (`website-asiris`).
   - Click **Settings** -> **Environment variables** (or **Variables and Secrets**).
   - Under **Production**, click **Add variable**:
     - **Name**: `STRIPE_SECRET_KEY`
     - **Value**: Your Stripe secret key (`sk_live_...` or test key `sk_test_...`)
     - **Type**: Select **Secret / Encrypted**.
   - Optional email variables:
     - **Name**: `OWNER_EMAIL` -> **Value**: `muhammadasyrafmusa93@gmail.com`
     - **Name**: `RESEND_API_KEY` -> (optional, from https://resend.com for automated customer & owner HTML emails)
     - **Name**: `WEB3FORMS_KEY` -> (optional, from https://web3forms.com for owner notifications)
   - Click **Save**.
3. Push your repository to GitHub (`git push origin main`). Cloudflare Pages will automatically redeploy!

---

### Stripe Automated Receipts (Zero Extra Setup)
In your **Stripe Dashboard** (`https://dashboard.stripe.com/settings/emails`):
- Turn on **"Email customers for successful payments"**
- Turn on **"Email me for successful payments"**

Because our Checkout API attaches `customer_email` and `receipt_email`, Stripe will automatically email an official payment receipt to the customer and notify you whenever a payment succeeds!

---

### Option 2: Standalone Cloudflare Worker
If you prefer running the Stripe endpoint as a separate Worker:

1. Open terminal inside the `worker/` directory:
   ```bash
   cd worker
   ```
2. Set your Stripe secret key:
   ```bash
   npx wrangler secret put STRIPE_SECRET_KEY
   ```
3. Deploy the worker:
   ```bash
   npx wrangler deploy
   ```
4. Copy the assigned URL (e.g., `https://aairis-stripe-worker.<subdomain>.workers.dev`).
5. In `index.html`, set:
   ```javascript
   CONFIG.stripeWorkerUrl = 'https://aairis-stripe-worker.<subdomain>.workers.dev';
   ```
