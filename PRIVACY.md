# Privacy: Colitu VPN browser extension

This page describes what the extension itself does with data. The Colitu
service as a whole is covered by the privacy policy at
<https://colitu.com/legal/privacy>.

## What the extension stores in your browser

- your session (access and refresh token), the e-mail address of the account
  and the id of this browser as a device on your account;
- a random device key generated at installation (it identifies this browser
  installation to your account, nothing else);
- the server list, measured pings, your plan details (when it ends, the
  next plan, the number of devices);
- the current proxy ticket, in the browser's session memory only (never on
  disk; it is gone when the browser closes and a new one is fetched);
- your settings (WebRTC protection, Russian sites, site lists, language).

Nothing is synchronised to other browsers. Signing out removes the session,
the ticket and the server list, and removes this browser from your account's
devices.

## What is sent to Colitu

- **Sign-in:** your e-mail and password (or the device-link code you confirm
  on colitu.com) go to `api.colitu.com` over HTTPS; with two-step
  verification on, so does the code from your authenticator app or a
  recovery code.
- **Device registration:** a device name such as “Chrome · Windows”, the
  platform (`chrome` or `firefox`), the extension version and the operating
  system name.
- **Browsing traffic:** while connected, the browser's traffic goes through the
  Colitu server you chose. HTTPS sites stay encrypted end to end; the server
  sees which host names you connect to, as any VPN or proxy does. Servers keep
  no activity logs. The traffic volume per device is counted for the plan
  limit (the free plan has 10 GB a month).

- **Anonymous connection statistics (setting “Anonymous connection statistics”):**
  connection events (server id, success or failure, a failure reason such as
  timeout, and times in milliseconds) are queued and sent at most once an hour,
  with a signed code for your network's country and provider. The events
  contain no account, device, IP address or visited sites. Like every request
  to the API, the report is sent signed in (that only keeps strangers from
  writing); the server adds the events to day totals and keeps nothing that
  links them to your account or device. On Chrome the setting is on by default; on
  Firefox it is off until you turn it on (it is the optional
  “technicalAndInteraction” data permission). Turning it off deletes the queue.
- **Survey and invite card:** once a day the extension asks whether a short
  satisfaction question should be shown (your answer is sent with your
  account, like a support reply); the invite link comes from your account.

## What the extension does not do

- no third-party analytics, crash reporting, advertising or SDKs (the optional anonymous connection statistics below go to Colitu only);
- no access to page content: no content scripts, no reading or changing pages;
- no browsing history: requests are routed, not recorded;
- no remote code: everything the extension runs is in the package.

## Contact

privacy@colitu.com
