# Stripe Checkout Backend for Aairis Langkawi Ventures

This project supports **two ways** to run your secure Stripe Checkout backend on Cloudflare:

---

### Option 1 (Recommended & Default): Built-in Cloudflare Pages Functions
Because your website is already hosted on **Cloudflare Pages**, you **do not need a separate Worker deployment**!

1. Cloudflare Pages automatically detects the `functions/api/create-checkout-session.js` and `functions/api/verify-session.js` files.
2. Go to your **Cloudflare Dashboard**:
   - Navigate to **Workers & Pages** -> select your Pages project (e.g. `website-asiris`).
   - Click **Settings** -> **Environment variables**.
   - Under **Production** (and Preview if needed), click **Add variable**:
     - **Variable name**: `STRIPE_SECRET_KEY`
     - **Value**: Your Stripe secret key (e.g., `sk_live_...` or test key `sk_test_...`)
     - **Type**: Select **Secret / Encrypted**.
   - Click **Save**.
3. Push your repository to GitHub (`git push origin main`). Cloudflare Pages will automatically redeploy with the active Stripe backend!

---

### Option 2: Standalone Cloudflare Worker
If you prefer running the Stripe endpoint as a separate Worker (e.g. `https://aairis-stripe-worker.yourname.workers.dev`):

1. Open terminal inside the `worker/` directory:
   ```bash
   cd worker
   ```
2. Set your Stripe secret key:
   ```bash
   npx wrangler secret put STRIPE_SECRET_KEY
   # Enter your sk_live_... or sk_test_... when prompted
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
