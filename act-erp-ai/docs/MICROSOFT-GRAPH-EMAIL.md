# Microsoft Graph login-code delivery

ACT ERP can send login codes through a dedicated Microsoft 365 mailbox. Only
the sender mailbox and Entra application require setup; employee recipient
addresses do not need to be verified.

## Microsoft 365 setup

1. Create or choose a dedicated mailbox, for example
   `noreply@americancompletiontools.com`. A shared mailbox is suitable when it
   is licensed/configured according to the organization's Microsoft 365 plan.
2. In **Microsoft Entra admin center → App registrations**, create an app named
   `ACT ERP Login Email` for this organization only.
3. Copy the **Directory (tenant) ID** and **Application (client) ID**.
4. Under **Certificates & secrets**, create a client secret with the shortest
   practical expiry. Copy its value immediately and store it as a production
   secret; Microsoft will not display it again.
5. Under **API permissions**, add **Microsoft Graph → Application permissions
   → Mail.Send**, then select **Grant admin consent**.
6. In Exchange Online, create an application access policy or App RBAC role
   that limits this application's `Mail.Send` access to only the dedicated
   sender mailbox. Do not leave app-only `Mail.Send` unrestricted across every
   company mailbox.

## Lightsail environment

Set these values in `apps/web/.env.prod` on Lightsail:

```env
EMAIL_PROVIDER=microsoft-graph
MICROSOFT_TENANT_ID=<Directory tenant ID>
MICROSOFT_CLIENT_ID=<Application client ID>
MICROSOFT_CLIENT_SECRET=<client secret value>
MICROSOFT_SENDER_USER=noreply@americancompletiontools.com
```

Recreate the web container so it receives the new environment:

```bash
cd /home/ubuntu/act-erp-ai/act-erp-ai/infra
docker compose -f docker-compose.prod-lite.yml up -d --build web
docker compose -f docker-compose.prod-lite.yml logs --tail=100 web
```

Test with a real employee login. A successful Graph `sendMail` call returns
HTTP 202; the application still shows only a generic delivery error to avoid
leaking provider details.
