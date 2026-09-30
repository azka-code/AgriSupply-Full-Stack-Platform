# AgriSupply frontend

This ZIP contains the static AgriSupply website frontend: landing page, login/demo screen, dashboard, styles, scripts, and the original image assets.

## Run locally

Serve this folder over HTTP (recommended so the weather request can run), then open `index.html`:

```bash
python3 -m http.server 8000
```

Open `http://localhost:8000`. The site has no build step or package dependencies.

## WhatsApp button

The floating WhatsApp button and contact link are configured for the provided Pakistan number, `+92 307 9729471`. To change the business number, update the `data-whatsapp-phone` attribute on `<body>` in `index.html`, `login.html`, and `dashboard.html`, using the international number as digits only (8–15 digits), for example:

```html
<body data-whatsapp-phone="923001234567">
```

Replace the example with the new business number. Do not use the placeholder number from the original page.

## Demo limitations

This is a static frontend, not the full-stack application described in the attached prompt. Login, signup, dashboard records, charts, and sensor readings are browser-side demo behavior; there is no server, database, secure server-side authentication, real-time backend, or persistent contact-form delivery. Do not use this demo authentication for real accounts or sensitive data.