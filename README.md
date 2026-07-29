# SmartRepair Lager Online v4.6

Render-ready inventory app.

## Login

The admin login is compared directly against the Render environment variables:

- `ADMIN_EMAIL`
- `ADMIN_PASSWORD`

This version no longer depends on an old password hash in PostgreSQL.

## Deploy

Upload all files to the root of the GitHub repository and commit. Render auto-deploys the new commit. Wait for **Deploy live**, then hard-refresh the login page with `Ctrl+F5`. The login screen must show **v4.6 Online**.
